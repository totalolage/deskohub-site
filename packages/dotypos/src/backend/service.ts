import { Data, Effect, Schedule } from "effect";
import { DotyposRuntimeConfig } from "../config";
import { ExternalAPIError, NetworkError, ValidationError } from "../errors";
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
  Schedule.whileInput((error: unknown) => {
    if (error instanceof ValidationError) return false;
    if (error instanceof ExternalAPIError)
      return Boolean(error.statusCode && error.statusCode >= 500);

    return error instanceof NetworkError;
  })
);

export type CustomerLookupField = "email" | "phone";

export type DotyposCustomerLookupData = {
  firstName: string;
  lastName?: string;
  email?: string;
  phone?: string;
};

export type DotyposCustomerDiscount = {
  readonly source: "dotypos-discount-group";
  readonly field: "_discountGroupId";
  readonly discountGroupId: string;
  readonly percent: number;
};

export type FindCustomerOptions = {
  readonly lookupFields?: readonly CustomerLookupField[];
};

export type FindCustomerResult = Data.TaggedEnum<{
  Matched: {
    readonly customer: Customer;
    readonly matches: readonly Customer[];
  };
  NotFound: {
    readonly matches: readonly [];
  };
  Ambiguous: {
    readonly matches: readonly [Customer, Customer, ...Customer[]];
  };
}>;

export const FindCustomerResult = Data.taggedEnum<FindCustomerResult>();

const defaultCustomerLookupFields = [
  "email",
  "phone",
] as const satisfies readonly CustomerLookupField[];

const normalizeCustomerLookupData = (
  customerData: DotyposCustomerLookupData
): DotyposCustomerLookupData => {
  const normalizedPhone = customerData.phone
    ? normalizePhoneNumber(customerData.phone)
    : null;

  return {
    ...customerData,
    phone: normalizedPhone || undefined,
  };
};

const getCustomerLookupLogAnnotations = (
  options?: FindCustomerOptions
): Record<string, unknown> => ({
  lookupFields: options?.lookupFields ?? defaultCustomerLookupFields,
});

const addUniqueCustomer = (customers: Customer[], customer: Customer) => {
  const isDuplicate = customers.find((existing) =>
    customer.id ? existing.id === customer.id : existing === customer
  );

  if (!isDuplicate) {
    customers.push(customer);
  }
};

const parseDiscountPercent = (value: unknown) => {
  const percent =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;

  if (!Number.isFinite(percent)) return undefined;
  if (percent <= 0 || percent > 100) return undefined;

  return percent;
};

const hasAtLeastTwoCustomers = (
  customers: readonly Customer[]
): customers is readonly [Customer, Customer, ...Customer[]] =>
  customers.length >= 2;

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

      const cancelReservation = Effect.fn("cancelReservation")(
        function* (reservationId: string) {
          const id = reservationId.trim();

          if (!id) {
            return yield* Effect.fail(
              new ValidationError({ message: "Reservation ID is required" })
            );
          }

          yield* api
            .cancelReservation({
              path: { cloudId: config.cloudId, reservationId: id },
            })
            .pipe(Effect.withSpan("dotyposService.cancelReservation"));
        },
        (effect, reservationId) =>
          effect.pipe(Effect.annotateLogs({ reservationId }))
      );

      const confirmReservation = Effect.fn("confirmReservation")(
        function* (reservationId: string) {
          const id = reservationId.trim();

          if (!id) {
            return yield* Effect.fail(
              new ValidationError({ message: "Reservation ID is required" })
            );
          }

          return yield* api
            .updateReservation({
              path: { cloudId: config.cloudId, reservationId: id },
              body: { status: "CONFIRMED" },
            })
            .pipe(
              Effect.withSpan("dotyposService.confirmReservation"),
              Effect.retry(retryPolicy)
            );
        },
        (effect, reservationId) =>
          effect.pipe(Effect.annotateLogs({ reservationId }))
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

      const lookupCustomer = Effect.fn("lookupCustomer")(
        function* (
          customerData: DotyposCustomerLookupData,
          options?: FindCustomerOptions
        ) {
          const normalizedCustomerData =
            normalizeCustomerLookupData(customerData);

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
                    () => Effect.succeed<Customer[]>([])
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

          const lookupFields =
            options?.lookupFields ?? defaultCustomerLookupFields;
          const shouldLookupBy = (field: CustomerLookupField) =>
            lookupFields.includes(field);

          const matchingCustomers: Customer[] = [];

          if (shouldLookupBy("email") && normalizedCustomerData.email) {
            const customersByEmail = yield* searchByField(
              "email",
              normalizedCustomerData.email
            );
            for (const customer of customersByEmail) {
              if (customer.email === normalizedCustomerData.email) {
                addUniqueCustomer(matchingCustomers, customer);
              }
            }
          }

          if (shouldLookupBy("phone") && normalizedCustomerData.phone) {
            const customersByPhone = yield* searchByField(
              "phone",
              normalizedCustomerData.phone
            );
            for (const customer of customersByPhone) {
              if (customer.phone === normalizedCustomerData.phone) {
                addUniqueCustomer(matchingCustomers, customer);
              }
            }
          }

          if (matchingCustomers.length === 0) {
            return {
              _tag: "NotFound" as const,
              matches: [],
              normalizedCustomerData,
            };
          }

          if (matchingCustomers.length > 1) {
            const [firstCustomer, secondCustomer, ...remainingCustomers] =
              matchingCustomers;

            if (!firstCustomer || !secondCustomer) {
              return {
                _tag: "NotFound" as const,
                matches: [],
                normalizedCustomerData,
              };
            }

            return {
              _tag: "Ambiguous" as const,
              matches: [firstCustomer, secondCustomer, ...remainingCustomers],
              normalizedCustomerData,
            };
          }

          const matchedCustomer = matchingCustomers[0];

          if (!matchedCustomer) {
            return {
              _tag: "NotFound" as const,
              matches: [],
              normalizedCustomerData,
            };
          }

          return {
            _tag: "Matched" as const,
            customer: matchedCustomer,
            matches: matchingCustomers,
            normalizedCustomerData,
          };
        },
        (effect, _input, options) =>
          effect.pipe(
            Effect.annotateLogs(getCustomerLookupLogAnnotations(options))
          )
      );

      const findCustomer = Effect.fn("findCustomer")(
        function* (
          customerData: DotyposCustomerLookupData,
          options?: FindCustomerOptions
        ) {
          const { normalizedCustomerData: _, ...result } =
            yield* lookupCustomer(customerData, options);

          switch (result._tag) {
            case "Matched":
              return FindCustomerResult.Matched({
                customer: result.customer,
                matches: result.matches,
              });
            case "Ambiguous":
              return hasAtLeastTwoCustomers(result.matches)
                ? FindCustomerResult.Ambiguous({ matches: result.matches })
                : FindCustomerResult.NotFound({ matches: [] });
            case "NotFound":
              return FindCustomerResult.NotFound({ matches: [] });
          }
        },
        (effect, _input, options) =>
          effect.pipe(
            Effect.annotateLogs(getCustomerLookupLogAnnotations(options))
          )
      );

      const findOrCreateCustomer = Effect.fn("findOrCreateCustomer")(
        function* (
          customerData: DotyposCustomerLookupData,
          options?: FindCustomerOptions
        ) {
          const lookup = yield* lookupCustomer(customerData, options);
          const normalizedCustomerData = lookup.normalizedCustomerData;
          const existingCustomer = lookup.matches[0];

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

          if (!normalizedCustomerData.email) {
            return yield* Effect.fail(
              new ValidationError({ message: "Customer email is required" })
            );
          }

          if (!normalizedCustomerData.phone) {
            return yield* Effect.fail(
              new ValidationError({ message: "Customer phone is required" })
            );
          }

          return yield* api
            .createCustomer({
              path: { cloudId: config.cloudId },
              body: {
                _cloudId: config.cloudId,
                firstName: normalizedCustomerData.firstName,
                lastName: normalizedCustomerData.lastName,
                email: normalizedCustomerData.email,
                phone: normalizedCustomerData.phone,
                expireDate: Date.now() + 365 * 24 * 60 * 60 * 1000,
              },
            })
            .pipe(Effect.retry(retryPolicy));
        },
        (effect, _input, options) =>
          effect.pipe(
            Effect.annotateLogs(getCustomerLookupLogAnnotations(options))
          )
      );

      const getCustomerDiscount = Effect.fn("getCustomerDiscount")(
        function* (customer: Customer) {
          const discountGroupId = customer._discountGroupId?.toString().trim();
          if (!discountGroupId) return undefined;

          const discountGroup = yield* api
            .getDiscountGroup({
              path: { cloudId: config.cloudId, discountGroupId },
            })
            .pipe(Effect.retry(retryPolicy));
          const percent = parseDiscountPercent(discountGroup.discountPercent);

          if (percent === undefined) return undefined;

          return {
            source: "dotypos-discount-group",
            field: "_discountGroupId",
            discountGroupId,
            percent,
          } satisfies DotyposCustomerDiscount;
        },
        (effect, customer) =>
          effect.pipe(
            Effect.annotateLogs({
              discountGroupId: customer._discountGroupId?.toString().trim(),
            })
          )
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

      const listReservations = Effect.fn("listReservations")(function* () {
        return yield* api
          .listReservations({
            path: { cloudId: config.cloudId },
            query: { limit: 100 },
          })
          .pipe(
            Effect.retry(retryPolicy),
            Effect.catchIf(
              (error) => !(error instanceof Data.TaggedError),
              (error) =>
                new ExternalAPIError({
                  service: "Dotypos",
                  operation: "listReservations",
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
        cancelReservation,
        confirmReservation,
        getReservation,
        getCustomer,
        getCustomerDiscount,
        findCustomer,
        findOrCreateCustomer,
        getTables,
        listReservations,
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
