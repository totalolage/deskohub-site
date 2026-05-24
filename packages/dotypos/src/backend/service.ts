import { Data, Effect, Schedule } from "effect";
import { DotyposRuntimeConfig } from "../config";
import {
  ExternalAPIError,
  type NetworkError,
  ValidationError,
} from "../errors";
import type {
  CreateReservationRequest,
  Customer,
  UpdateCustomerRequest,
} from "../generated/types.gen";
import type { CreateDotyposReservationInput } from "../types";
import { normalizePhoneNumber } from "../utils/phone-formatting";
import { DotyposApi } from "./api";

const retryPolicy = Schedule.exponential("100 millis").pipe(
  Schedule.jittered,
  Schedule.intersect(Schedule.recurs(3)),
  Schedule.whileInput<ExternalAPIError | NetworkError>((error) => {
    if (error._tag === "NetworkError") return true;

    if (
      error._tag === "ExternalAPIError" &&
      error.statusCode &&
      error.statusCode >= 500
    ) {
      return true;
    }

    return false;
  })
);

export class DotyposService extends Effect.Service<DotyposService>()(
  "DotyposService",
  {
    effect: Effect.gen(function* () {
      const config = yield* DotyposRuntimeConfig;
      const api = yield* DotyposApi;

      const getReservation = Effect.fn("getReservation")(
        function* (id: string) {
          const reservationResult = yield* api
            .getReservation({
              path: { cloudId: config.cloudId, reservationId: id },
            })
            .pipe(
              Effect.retry(retryPolicy),
              Effect.catchIf(
                (error) => !(error instanceof Data.TaggedError),
                (error) =>
                  new ExternalAPIError({
                    service: "Dotypos",
                    operation: "getReservation",
                    cause: error,
                  })
              )
            );

          const reservation = {
            ...reservationResult,
            id,
          };

          if (!reservation._customerId) {
            return yield* Effect.fail(
              new ValidationError({
                message: `Reservation ${id} has no customer ID`,
              })
            );
          }

          const customerResult = yield* getCustomer(reservation._customerId);
          const customer = {
            ...customerResult,
            id: reservation._customerId,
          };

          return { reservation, customer };
        },
        (effect, reservationId) =>
          effect.pipe(
            Effect.annotateLogs({
              reservationId,
            })
          )
      );

      const createReservation = Effect.fn("createReservation")(
        function* (input: CreateDotyposReservationInput) {
          const customerId = input.customerId.trim();
          const tableId = input.tableId.trim();

          if (!customerId) {
            return yield* Effect.fail(
              new ValidationError({ message: "Customer ID is required" })
            );
          }

          if (!tableId) {
            return yield* Effect.fail(
              new ValidationError({ message: "Table ID is required" })
            );
          }

          if (!Number.isInteger(input.seats) || input.seats <= 0) {
            return yield* Effect.fail(
              new ValidationError({
                message: "Reservation seats must be a positive integer",
              })
            );
          }

          if (
            Number.isNaN(input.startDate.getTime()) ||
            Number.isNaN(input.endDate.getTime())
          ) {
            return yield* Effect.fail(
              new ValidationError({
                message: "Reservation dates must be valid",
              })
            );
          }

          if (input.endDate <= input.startDate) {
            return yield* Effect.fail(
              new ValidationError({
                message: "Reservation end date must be after start date",
              })
            );
          }

          const note = input.note?.trim();
          const request: CreateReservationRequest = {
            _branchId: config.branchId,
            _cloudId: config.cloudId,
            _customerId: customerId,
            _tableId: tableId,
            startDate: input.startDate.getTime(),
            endDate: input.endDate.getTime(),
            seats: input.seats,
            status: input.status,
            flags: 0,
            ...(note && { note }),
            ...(config.employeeId && { _employeeId: config.employeeId }),
          };

          return yield* api
            .createReservation({
              path: { cloudId: config.cloudId },
              body: request,
            })
            .pipe(
              Effect.withSpan("dotyposService.createReservation"),
              Effect.retry(retryPolicy)
            );
        },
        (effect, input) => effect.pipe(Effect.annotateLogs({ ...input }))
      );

      const getCustomer = Effect.fn("getCustomer")(
        function* (id: string) {
          return yield* api
            .getCustomer({
              path: { cloudId: config.cloudId, customerId: id },
            })
            .pipe(
              Effect.retry(retryPolicy),
              Effect.catchIf(
                (error) => !error,
                (error) =>
                  new ExternalAPIError({
                    service: "Dotypos",
                    operation: "getCustomer",
                    cause: `\`${error}' value thrown`,
                  })
              ),
              Effect.catchIf(
                (error) => !(error instanceof Data.TaggedError),
                (error) =>
                  new ExternalAPIError({
                    service: "Dotypos",
                    operation: "getCustomer",
                    cause: error,
                  })
              )
            );
        },
        (effect, customerId) =>
          effect.pipe(
            Effect.annotateLogs({
              customerId,
            })
          )
      );

      const findOrCreateCustomer = Effect.fn("findOrCreateCustomer")(
        function* (customerData: {
          firstName: string;
          lastName?: string;
          email?: string;
          phone?: string;
        }) {
          const normalizedPhone = customerData.phone
            ? normalizePhoneNumber(customerData.phone)
            : null;

          const normalizedCustomerData = {
            ...customerData,
            phone: normalizedPhone || undefined,
          };

          const searchByField = (fieldName: "email" | "phone", value: string) =>
            Effect.gen(function* () {
              const valueSanitized = value.replace(
                "|",
                encodeURIComponent("|")
              );
              const filter = `${fieldName}|like|${valueSanitized}`;

              return yield* api
                .searchCustomers({
                  path: { cloudId: config.cloudId },
                  query: {
                    limit: 100,
                    filter,
                  },
                })
                .pipe(
                  Effect.catchIf(
                    (error) =>
                      error instanceof ExternalAPIError &&
                      error.statusCode === 404,
                    () => Effect.succeed([] as Customer[])
                  ),
                  Effect.retry(
                    Schedule.exponential("100 millis").pipe(
                      Schedule.jittered,
                      Schedule.intersect(Schedule.recurs(2)),
                      Schedule.whileInput(
                        (error) =>
                          !(
                            error instanceof ExternalAPIError &&
                            error.statusCode === 404
                          )
                      )
                    )
                  )
                );
            });

          let existingCustomer: Customer | undefined;
          const matchingCustomers: Customer[] = [];

          if (normalizedCustomerData.email) {
            const customersByEmail = yield* searchByField(
              "email",
              normalizedCustomerData.email
            );
            const emailMatch = customersByEmail.find(
              (customer) => customer.email === normalizedCustomerData.email
            );
            if (emailMatch) {
              matchingCustomers.push(emailMatch);
            }
          }

          if (normalizedCustomerData.phone) {
            const customersByPhone = yield* searchByField(
              "phone",
              normalizedCustomerData.phone
            );
            const phoneMatch = customersByPhone.find(
              (customer) => customer.phone === normalizedCustomerData.phone
            );
            if (
              phoneMatch &&
              !matchingCustomers.find(
                (customer) => customer.id === phoneMatch.id
              )
            ) {
              matchingCustomers.push(phoneMatch);
            }
          }

          if (matchingCustomers.length > 0) {
            existingCustomer = matchingCustomers[0];
          }

          if (existingCustomer) {
            const needsUpdate =
              (normalizedCustomerData.email && !existingCustomer.email) ||
              (normalizedCustomerData.phone && !existingCustomer.phone) ||
              (normalizedCustomerData.firstName &&
                !existingCustomer.firstName) ||
              (normalizedCustomerData.lastName && !existingCustomer.lastName);

            if (needsUpdate) {
              const updateRequest: UpdateCustomerRequest = {};

              if (normalizedCustomerData.email && !existingCustomer.email) {
                updateRequest.email = normalizedCustomerData.email;
              }
              if (normalizedCustomerData.phone && !existingCustomer.phone) {
                updateRequest.phone = normalizedCustomerData.phone;
              }
              if (
                normalizedCustomerData.firstName &&
                !existingCustomer.firstName
              ) {
                updateRequest.firstName = normalizedCustomerData.firstName;
              }
              if (
                normalizedCustomerData.lastName &&
                !existingCustomer.lastName
              ) {
                updateRequest.lastName = normalizedCustomerData.lastName;
              }

              const updatedCustomer = yield* api
                .updateCustomer({
                  path: {
                    cloudId: config.cloudId,
                    customerId: existingCustomer.id!,
                  },
                  body: updateRequest,
                })
                .pipe(
                  Effect.retry(retryPolicy),
                  Effect.orElse(() => Effect.succeed(existingCustomer!))
                );

              return updatedCustomer;
            }

            return existingCustomer;
          }

          return yield* api
            .createCustomer({
              path: { cloudId: config.cloudId },
              body: {
                _cloudId: config.cloudId,
                firstName: normalizedCustomerData.firstName,
                lastName: normalizedCustomerData.lastName,
                email: normalizedCustomerData.email || null,
                phone: normalizedCustomerData.phone || null,
                expireDate: Date.now() + 365 * 24 * 60 * 60 * 1000,
              },
            })
            .pipe(Effect.retry(retryPolicy));
        },
        (effect, input) => effect.pipe(Effect.annotateLogs(input))
      );

      const getTables = Effect.fn("getTables")(function* () {
        return yield* api
          .getTables({
            path: { cloudId: config.cloudId },
          })
          .pipe(
            Effect.retry(retryPolicy),
            Effect.catchIf(
              (error) => !(error instanceof Data.TaggedError),
              (error) =>
                new ExternalAPIError({
                  service: "Dotypos",
                  operation: "getTables",
                  cause: error,
                })
            )
          );
      });

      const getProducts = Effect.fn("getProducts")(function* (options: {
        categoryId?: string;
        includeDeleted?: boolean;
      }) {
        return yield* api
          .getProducts({
            path: { cloudId: config.cloudId },
            query: {
              limit: 100,
              ...(options?.categoryId && {
                filter: `_categoryId|eq|${options.categoryId}`,
              }),
            },
          })
          .pipe(
            Effect.map((products) =>
              options?.includeDeleted
                ? products
                : products.filter((product) => !product.deleted)
            ),
            Effect.retry(retryPolicy),
            Effect.catchIf(
              (error) => !(error instanceof Data.TaggedError),
              (error) =>
                new ExternalAPIError({
                  service: "Dotypos",
                  operation: "getProducts",
                  cause: error,
                })
            )
          );
      });

      const getCategories = Effect.fn("getCategories")(function* () {
        return yield* api
          .getCategories({
            path: { cloudId: config.cloudId },
            query: { limit: 100 },
          })
          .pipe(Effect.retry(retryPolicy));
      });

      return {
        createReservation,
        getReservation,
        getCustomer,
        findOrCreateCustomer,
        getTables,
        getProducts,
        getCategories,
      };
    }).pipe(
      Effect.annotateLogs("service", "DotyposService"),
      Effect.withConcurrency(5)
    ),
    dependencies: [DotyposApi.Default],
  }
) {}
