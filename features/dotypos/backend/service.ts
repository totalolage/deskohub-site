/**
 * Dotypos Effect Service
 *
 * This service wraps the generated OpenAPI client with Effect patterns
 * for better error handling and composition.
 */
import { Data, Effect, Layer, Schedule } from "effect";
import { getLocale } from "@/features/i18n";
import type { TableReservationFormData } from "@/features/table-reservation";
import { DotyposConfig } from "@/shared/backend/config/dotypos.config";
import {
  ExternalAPIError,
  type NetworkError,
  ValidationError,
} from "@/shared/backend/errors";
import { normalizePhoneNumber } from "@/shared/utils/phone-formatting";
import type {
  CreateReservationRequest,
  Customer,
  Product,
  UpdateCustomerRequest,
} from "../generated/types.gen";
import { isCategoryDisplayable } from "../utils/category-utils";
import {
  createNoteWithMetadata,
  createStandardMetadata,
} from "../utils/note-metadata";
import { DotyposApi } from "./api";

/**
 * Retry policy with exponential backoff and jitter
 * - Only retries on server errors (500+)
 * - Starts at 100ms, doubles each retry with jitter
 * - Maximum 3 retries
 * - Maximum total time: ~7 seconds
 */
const retryPolicy = Schedule.exponential("100 millis").pipe(
  Schedule.jittered,
  Schedule.intersect(Schedule.recurs(3)), // Use intersect for AND condition, not either
  Schedule.whileInput<ExternalAPIError | NetworkError>((error) => {
    // Only retry on server errors (500+) or network errors
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
      const config = yield* DotyposConfig;
      const api = yield* DotyposApi;

      const createReservation = Effect.fn("createReservation")(
        function* (input: TableReservationFormData) {
          yield* Effect.logInfo("Creating reservation", input);

          // Simple name splitting - just first and rest
          const [firstName = "", ...lastNameParts] = input.name
            .trim()
            .split(/\s+/);
          const lastName = lastNameParts.join(" ") || firstName;

          // Find or create customer (required for reservation)
          const customer = yield* findOrCreateCustomer({
            firstName,
            lastName,
            email: input.email,
            phone: input.phone,
          });

          if (!customer.id) {
            return yield* Effect.fail(
              new ValidationError({
                message: "Failed to create or find customer",
              })
            );
          }

          yield* Effect.logInfo("Customer resolved", {
            customerId: customer.id,
          });

          // Build note once
          const note = buildNote(input);

          const tableId = yield* getTables().pipe(
            Effect.map(
              (tables) =>
                tables.find((t) => ["virtualni", "VIRTUÁL 2"].includes(t.name))
                  ?.id
            ),
            Effect.filterOrFail((table) => table != null)
          );

          // let tableId: string | undefined;
          // if (siteConstants.featureFlags.autoTableSelection) {
          //   // Auto-select table based on preferences
          //   const tables = yield* getTables();
          //   const selection = selectBestTable({
          //     guestCount: input.guestCount,
          //     needsLargerTable: input.needsLargerTable,
          //     needsPrivateSpace: input.needsPrivateSpace,
          //     availableTables: tables,
          //   });
          //
          //   tableId = selection?.selectedTableId;
          //   if (selection) {
          //     yield* Effect.logInfo("Table selected", {
          //       tableId,
          //       tableName: selection.selectedTableName,
          //       seats: selection.seats,
          //     });
          //   }
          // } else {
          //   const tables = yield* getTables();
          //   tableId = tables[0]?.id;
          // }

          // const mockReservation: Reservation = {
          //   _branchId: config.branchId,
          //   _cloudId: config.cloudId,
          //   startDate: input.datetime.toISOString(),
          //   endDate: new Date( input.datetime.getTime() + input.duration * 60 * 60 * 1000 ).toISOString(),
          //   seats: input.guestCount.toString(),
          //   status: "NEW",
          // };
          // return mockReservation;

          // Build request with required customer ID
          const request: CreateReservationRequest = {
            _branchId: config.branchId,
            _cloudId: config.cloudId,
            _customerId: customer.id,
            startDate: input.datetime.getTime(),
            endDate: input.datetime.getTime() + input.duration * 60 * 60 * 1000,
            seats: input.guestCount,
            status: "NEW",
            note,
            flags: 0,
            ...(tableId && { _tableId: tableId }),
            ...(config.employeeId && { _employeeId: config.employeeId }),
          };

          const reservation = yield* api
            .createReservation({
              path: { cloudId: config.cloudId },
              body: request,
            })
            .pipe(
              Effect.withSpan("dotyposService.createReservation"),
              Effect.tap((res) => Effect.logDebug("API call successful", res)),
              Effect.tapError((error) =>
                Effect.logError("API call failed", error)
              ),
              Effect.retry(retryPolicy)
            );

          yield* Effect.logInfo("Reservation created", { id: reservation.id });

          // Email is sent at the action layer (booking.ts) where the email service is available
          return reservation;
        },
        (effect, input) =>
          effect.pipe(
            Effect.annotateLogs({
              operation: "createReservation",
              input,
            })
          )
      );

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

          // Get customer details if available
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

          // Return both reservation and customer
          return { reservation, customer };
        },
        (effect, input) =>
          effect.pipe(
            Effect.annotateLogs({
              operation: "getReservation",
              input,
            })
          )
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
        (effect, input) =>
          effect.pipe(
            Effect.annotateLogs({
              operation: "getCustomer",
              input,
            })
          )
      );

      const findOrCreateCustomer = Effect.fn("findOrCreateCustomer")(
        function* (customerData: {
          firstName: string;
          lastName: string;
          email?: string;
          phone?: string;
        }) {
          yield* Effect.logInfo("Finding or creating customer");

          // Normalize phone number to E.164 format for consistent storage and searching
          const normalizedPhone = customerData.phone
            ? normalizePhoneNumber(customerData.phone)
            : null;

          // Use normalized phone for all operations
          const normalizedCustomerData = {
            ...customerData,
            phone: normalizedPhone || undefined,
          };

          yield* Effect.logDebug("Phone normalization", {
            original: customerData.phone,
            normalized: normalizedPhone,
          });

          // Helper function to search customers by a specific field
          const searchByField = (fieldName: "email" | "phone", value: string) =>
            Effect.gen(function* () {
              const valueSanitized = value.replace(
                "|",
                encodeURIComponent("|")
              );
              const filter = `${fieldName}|like|${valueSanitized}`;
              yield* Effect.logDebug(
                `Searching by ${fieldName} with filter`,
                filter
              );

              return yield* api
                .searchCustomers({
                  path: { cloudId: config.cloudId },
                  query: {
                    limit: 100,
                    filter,
                  },
                })
                .pipe(
                  // Handle 404 as empty result (no customers found)
                  Effect.catchIf(
                    (error) =>
                      error instanceof ExternalAPIError &&
                      error.statusCode === 404,
                    () => Effect.succeed([] as Customer[])
                  ),
                  // Only retry if not a 404
                  Effect.retry(
                    Schedule.exponential("100 millis").pipe(
                      Schedule.jittered,
                      Schedule.intersect(Schedule.recurs(2)), // Use intersect for AND condition
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

          // Search by email if provided
          if (normalizedCustomerData.email) {
            const customersByEmail = yield* searchByField(
              "email",
              normalizedCustomerData.email
            );
            const emailMatch = customersByEmail.find(
              (c) => c.email === normalizedCustomerData.email
            );
            if (emailMatch) {
              matchingCustomers.push(emailMatch);
            }
          }

          // Search by phone if provided (independent of email search)
          if (normalizedCustomerData.phone) {
            const customersByPhone = yield* searchByField(
              "phone",
              normalizedCustomerData.phone
            );
            const phoneMatch = customersByPhone.find(
              (c) => c.phone === normalizedCustomerData.phone
            );
            if (phoneMatch) {
              // Only add if not already found by email (avoid duplicates)
              if (!matchingCustomers.find((c) => c.id === phoneMatch.id)) {
                matchingCustomers.push(phoneMatch);
              }
            }
          }

          // If we found any matching customers, use the first one
          if (matchingCustomers.length > 0) {
            existingCustomer = matchingCustomers[0]!;

            const matchedBy: string[] = [];
            if (existingCustomer.email === normalizedCustomerData.email)
              matchedBy.push("email");
            if (existingCustomer.phone === normalizedCustomerData.phone)
              matchedBy.push("phone");

            yield* Effect.logInfo("Found existing customer", {
              customerId: existingCustomer.id,
              matchedBy: matchedBy.join(" and "),
              totalMatchesFound: matchingCustomers.length,
            });

            if (matchingCustomers.length > 1) {
              yield* Effect.logWarning(
                "Multiple customers found matching criteria",
                {
                  customerIds: matchingCustomers.map((c) => c.id),
                  usingCustomerId: existingCustomer.id,
                }
              );
            }
          }

          // If customer exists, check if it needs updating
          if (existingCustomer) {
            // Check if any fields are missing that we now have
            const needsUpdate =
              (normalizedCustomerData.email && !existingCustomer.email) ||
              (normalizedCustomerData.phone && !existingCustomer.phone) ||
              (normalizedCustomerData.firstName &&
                !existingCustomer.firstName) ||
              (normalizedCustomerData.lastName && !existingCustomer.lastName);

            if (needsUpdate) {
              yield* Effect.logInfo(
                "Updating existing customer with new information",
                {
                  customerId: existingCustomer.id,
                  existingEmail: existingCustomer.email,
                  newEmail: normalizedCustomerData.email,
                  existingPhone: existingCustomer.phone,
                  newPhone: normalizedCustomerData.phone,
                }
              );

              // Build update request with only new/missing fields
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
                  Effect.tap((customer) =>
                    Effect.logInfo("Customer updated successfully", {
                      customerId: customer.id,
                      updatedFields: Object.keys(updateRequest),
                    })
                  ),
                  Effect.retry(retryPolicy),
                  // If update fails, return the existing customer anyway
                  Effect.orElse(() =>
                    Effect.gen(function* () {
                      yield* Effect.logWarning(
                        "Failed to update customer, using existing data",
                        {
                          customerId: existingCustomer!.id,
                        }
                      );
                      return existingCustomer!;
                    })
                  )
                );

              return updatedCustomer;
            }

            return existingCustomer;
          }

          // Create new customer
          yield* Effect.logInfo(
            "Creating new customer",
            normalizedCustomerData
          );

          const newCustomer = yield* api
            .createCustomer({
              path: { cloudId: config.cloudId },
              body: {
                _cloudId: config.cloudId,
                firstName: normalizedCustomerData.firstName,
                lastName: normalizedCustomerData.lastName,
                email: normalizedCustomerData.email || null,
                phone: normalizedCustomerData.phone || null,
                addressLine1: "",
                addressLine2: null,
                city: null,
                zip: "",
                country: null,
                companyName: "",
                vatId: "",
                note: null,
                display: true,
                deleted: false,
                points: 0,
                internalNote: "",
                companyId: "",
                hexColor: "#2196F3",
                headerPrint: "",
                tags: [],
                barcode: "",
                flags: 0,
              },
            })
            .pipe(
              Effect.tap((customer) =>
                Effect.logInfo("Customer created successfully", {
                  customerId: customer.id,
                  name: `${customer.firstName} ${customer.lastName}`,
                })
              ),
              Effect.retry(retryPolicy)
            );

          return newCustomer;
        },
        (effect, input) =>
          effect.pipe(
            Effect.annotateLogs({
              operation: "findOrCreateCustomer",
              input,
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

      const getProducts = Effect.fn("getProducts")(function* (options) {
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
              products.filter((p) => !p.deleted && p.display)
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

      const getMenuItems = Effect.fn("getMenuItems")(function* () {
        // First, fetch all categories (both displayable and non-displayable)
        const categories = yield* getCategories();

        // Fetch products for ALL categories (not just displayable ones) to ensure we get everything
        const productsByCategory = yield* Effect.all(
          categories
            .filter((cat) => cat.id) // Only categories with IDs
            .filter(isCategoryDisplayable) // Only displayable categories
            .map((category) =>
              getProducts({
                categoryId: category.id,
                includeDeleted: false,
              }).pipe(
                Effect.tapError((error) =>
                  Effect.logError(
                    "Failed to fetch products for category",
                    error
                  )
                ),
                Effect.orElseSucceed(() => [])
              )
            ),
          { concurrency: "inherit" }
        );

        // Flatten products from all categories and deduplicate by ID
        const productMap = new Map<string, Product>();
        for (const categoryProducts of productsByCategory) {
          for (const product of categoryProducts) {
            if (product.id && product.display && !product.deleted) {
              productMap.set(product.id, product);
            }
          }
        }
        const products = Array.from(productMap.values());

        yield* Effect.logInfo("Menu items fetched", {
          categoriesCount: categories.length,
          productsCount: products.length,
        });

        return {
          products,
          categories,
        };
      });

      const buildNote = (input: TableReservationFormData): string => {
        // Include special requests and metadata in the note field
        const metadata = createStandardMetadata(getLocale(), "website");
        return createNoteWithMetadata(input.specialRequests, metadata);
      };

      return {
        createReservation,
        getReservation,
        getCustomer,
        findOrCreateCustomer,
        getTables,
        getProducts,
        getCategories,
        getMenuItems,
        buildNote,
      };
    }).pipe(
      Effect.annotateLogs("service", "DotyposService"),
      Effect.withConcurrency(5)
    ),
    dependencies: [
      Layer.provideMerge(DotyposApi.Default, DotyposConfig.Default),
    ],
  }
) {}
