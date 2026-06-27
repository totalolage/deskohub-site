import {
  Context,
  Data,
  Effect,
  Layer,
  Match,
  Option,
  Predicate,
  Schedule,
  Schema,
} from "effect";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import { DotyposRuntimeConfig } from "../config";
import { ExternalAPIError, NetworkError, ValidationError } from "../errors";
import type {
  CreateCustomerRequest,
  CreateReservationRequest,
  Customer,
  UpdateCustomerRequest,
} from "../generated/effect.gen";
import type { CreateDotyposReservationInput } from "../types";
import { normalizePhoneNumber } from "../utils/phone-formatting";
import {
  DotyposAccessToken,
  DotyposGeneratedClient,
  getDiscountGroup,
  mapDotyposClientError,
} from "./api";

type DotyposError = ValidationError | ExternalAPIError | NetworkError;

const isDotyposError = (error: unknown): error is DotyposError =>
  Predicate.isTagged(error, "ValidationError") ||
  Predicate.isTagged(error, "ExternalAPIError") ||
  Predicate.isTagged(error, "NetworkError");

const isRetryableDotyposError = (error: DotyposError) =>
  Match.value(error).pipe(
    Match.tag("NetworkError", () => true),
    Match.tag("ExternalAPIError", (apiError) =>
      Boolean(apiError.statusCode && apiError.statusCode >= 500)
    ),
    Match.orElse(() => false)
  );

const retryPolicy = {
  schedule: Schedule.exponential("100 millis").pipe(
    Schedule.jittered,
    Schedule.both(Schedule.recurs(3))
  ),
  while: isRetryableDotyposError,
};

const catchUnexpectedDotyposError = (operation: string) =>
  Effect.catch((error: unknown) =>
    isDotyposError(error)
      ? Effect.fail(error)
      : Effect.fail(
          new ExternalAPIError({
            service: "Dotypos",
            operation,
            cause: error,
          })
        )
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

const defaultCustomerLookupFields: readonly CustomerLookupField[] = [
  "email",
  "phone",
];

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

const presentCustomerInputFields = (customerData: DotyposCustomerLookupData) =>
  (["firstName", "lastName", "email", "phone"] as const).filter(
    (field) => customerData[field]
  );

const presentCreateCustomerRequestFields = (request: CreateCustomerRequest) =>
  (
    [
      "_cloudId",
      "addressLine1",
      "barcode",
      "companyId",
      "companyName",
      "deleted",
      "display",
      "firstName",
      "flags",
      "headerPrint",
      "hexColor",
      "internalNote",
      "lastName",
      "email",
      "phone",
      "points",
      "tags",
      "vatId",
      "zip",
      "expireDate",
    ] as const satisfies readonly (keyof CreateCustomerRequest)[]
  ).filter((field) => request[field] !== undefined);

const addUniqueCustomer = (customers: Customer[], customer: Customer) => {
  const isDuplicate = customers.find((existing) =>
    customer.id ? existing.id === customer.id : existing === customer
  );

  if (!isDuplicate) {
    customers.push(customer);
  }
};

const DiscountPercentSchema = Schema.Union([
  Schema.Finite,
  Schema.FiniteFromString,
]).check(Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(100));

const parseDiscountPercent = (value: unknown) =>
  Option.getOrUndefined(
    Schema.decodeUnknownOption(DiscountPercentSchema)(value)
  );

const hasAtLeastTwoCustomers = (
  customers: readonly Customer[]
): customers is readonly [Customer, Customer, ...Customer[]] =>
  customers.length >= 2;

const makeDotyposService = Effect.gen(function* () {
  const config = yield* DotyposRuntimeConfig;
  const { client, httpClient } = yield* DotyposGeneratedClient;

  const runDotyposRequest = <A, E>(
    effect: Effect.Effect<A, E>,
    operation: string
  ) =>
    effect.pipe(
      Effect.mapError((error) =>
        mapDotyposClientError(error, operation, config.apiUrl)
      ),
      Effect.timeoutOrElse({
        duration: config.apiTimeout,
        orElse: () =>
          Effect.fail(
            new NetworkError({
              message: "Failed to connect to Dotypos",
              url: config.apiUrl,
            })
          ),
      })
    );

  const firstOrExternalError = <A>(items: readonly A[], operation: string) => {
    const item = items[0];
    return item
      ? Effect.succeed(item)
      : Effect.fail(
          new ExternalAPIError({
            service: "Dotypos",
            operation,
            message: "Dotypos returned an empty array.",
            statusCode: 502,
          })
        );
  };

  const getReservation = Effect.fn("getReservation")(
    function* (id: string) {
      const reservationResult = yield* runDotyposRequest(
        client.getReservation(config.cloudId, id, undefined),
        "getReservation"
      ).pipe(
        Effect.retry(retryPolicy),
        catchUnexpectedDotyposError("getReservation")
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
      yield* Effect.annotateLogsScoped({ input });
      yield* Effect.logInfo("Dotypos reservation request build started");

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

      yield* Effect.annotateLogsScoped({ requestBody: request });
      yield* Effect.logInfo("Dotypos reservation API call started");

      const reservation = yield* runDotyposRequest(
        client
          .createReservation(config.cloudId, { payload: [request] })
          .pipe(
            Effect.flatMap((reservations) =>
              firstOrExternalError(reservations, "createReservation")
            )
          ),
        "createReservation"
      ).pipe(
        Effect.withSpan("dotyposService.createReservation"),
        Effect.retry(retryPolicy),
        Effect.tapError((error) =>
          Effect.logError("Dotypos reservation creation failed", {
            error,
          })
        )
      );

      yield* Effect.annotateLogsScoped({ reservation });
      yield* Effect.logInfo("Dotypos reservation created successfully");

      return reservation;
    },
    (effect, input) =>
      effect.pipe(
        Effect.annotateLogs({
          customerId: input.customerId,
          tableId: input.tableId,
          status: input.status,
          seats: input.seats,
        }),
        Effect.scoped
      )
  );

  const cancelReservation = Effect.fn("cancelReservation")(
    function* (reservationId: string) {
      yield* Effect.annotateLogsScoped({ reservationId });
      const id = reservationId.trim();

      if (!id) {
        return yield* Effect.fail(
          new ValidationError({ message: "Reservation ID is required" })
        );
      }

      yield* Effect.logInfo("Dotypos reservation cancellation started");

      yield* runDotyposRequest(
        client.cancelReservation(config.cloudId, id, undefined),
        "cancelReservation"
      ).pipe(
        Effect.withSpan("dotyposService.cancelReservation"),
        Effect.tapError((error) =>
          Effect.logError("Dotypos reservation cancellation failed", {
            error,
          })
        )
      );

      yield* Effect.logInfo("Dotypos reservation cancellation succeeded");
    },
    (effect, reservationId) =>
      effect.pipe(Effect.annotateLogs({ reservationId }), Effect.scoped)
  );

  const confirmReservation = Effect.fn("confirmReservation")(
    function* (reservationId: string) {
      const id = reservationId.trim();

      if (!id) {
        return yield* Effect.fail(
          new ValidationError({ message: "Reservation ID is required" })
        );
      }

      yield* Effect.logInfo("Dotypos reservation ETag load started");

      const [, response] = yield* runDotyposRequest(
        client.getReservation(config.cloudId, id, {
          config: { includeResponse: true },
        }),
        "Get reservation"
      ).pipe(
        Effect.withSpan("dotyposService.confirmReservation.getEtag"),
        Effect.retry(retryPolicy)
      );
      const etag = response.headers.etag ?? response.headers.ETag;

      yield* Effect.logDebug("Dotypos reservation ETag load succeeded", {
        etag,
      });

      if (!etag) {
        yield* Effect.logWarning(
          "Dotypos reservation ETag missing before confirmation failure"
        );

        return yield* Effect.fail(
          new ExternalAPIError({
            service: "Dotypos",
            operation: "Get reservation",
            message: "Reservation ETag header was missing.",
          })
        );
      }

      yield* Effect.logInfo("Dotypos reservation confirmation patch started");

      const reservation = yield* runDotyposRequest(
        client.patchReservation(config.cloudId, id, {
          params: { "If-Match": etag },
          payload: { status: "CONFIRMED" },
        }),
        "patchReservation"
      ).pipe(
        Effect.withSpan("dotyposService.confirmReservation"),
        Effect.retry(retryPolicy),
        Effect.tapError((error) =>
          Effect.logError("Dotypos reservation confirmation failed", {
            error,
          })
        )
      );

      yield* Effect.logInfo("Dotypos reservation confirmation succeeded");

      return reservation;
    },
    (effect, reservationId) =>
      effect.pipe(Effect.annotateLogs({ reservationId }))
  );

  const getCustomer = Effect.fn("getCustomer")(
    function* (id: string) {
      return yield* runDotyposRequest(
        client.getCustomer(config.cloudId, id, undefined),
        "getCustomer"
      ).pipe(
        Effect.retry(retryPolicy),
        Effect.catchIf(
          (error) => !error,
          (error) =>
            Effect.fail(
              new ExternalAPIError({
                service: "Dotypos",
                operation: "getCustomer",
                cause: `\`${error}' value thrown`,
              })
            )
        ),
        catchUnexpectedDotyposError("getCustomer")
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
      const normalizedCustomerData = normalizeCustomerLookupData(customerData);

      const searchByField = (fieldName: "email" | "phone", value: string) =>
        Effect.gen(function* () {
          const valueSanitized = value.replace("|", encodeURIComponent("|"));
          const filter = `${fieldName}|like|${valueSanitized}`;

          return yield* runDotyposRequest(
            client
              .getCustomers(config.cloudId, {
                params: { limit: 100, filter },
              })
              .pipe(Effect.map((page) => [...(page.data ?? [])])),
            "searchCustomers"
          ).pipe(
            Effect.catchTag("ExternalAPIError", (error) =>
              error.statusCode === 404
                ? Effect.succeed<Customer[]>([])
                : Effect.fail(error)
            ),
            Effect.retry(retryPolicy)
          );
        });

      const lookupFields = options?.lookupFields ?? defaultCustomerLookupFields;
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

      if (hasAtLeastTwoCustomers(matchingCustomers)) {
        return {
          _tag: "Ambiguous" as const,
          matches: matchingCustomers,
          normalizedCustomerData,
        };
      }

      return {
        _tag: "Matched" as const,
        customer: matchingCustomers[0]!,
        matches: matchingCustomers,
        normalizedCustomerData,
      };
    },
    (effect, _input, options) =>
      effect.pipe(Effect.annotateLogs(getCustomerLookupLogAnnotations(options)))
  );

  const findCustomer = Effect.fn("findCustomer")(
    function* (
      customerData: DotyposCustomerLookupData,
      options?: FindCustomerOptions
    ) {
      const { normalizedCustomerData: _, ...result } = yield* lookupCustomer(
        customerData,
        options
      );

      switch (result._tag) {
        case "Matched":
          return FindCustomerResult.Matched({
            customer: result.customer,
            matches: result.matches,
          });
        case "Ambiguous":
          return FindCustomerResult.Ambiguous({ matches: result.matches });
        case "NotFound":
          return FindCustomerResult.NotFound({ matches: [] });
      }
    },
    (effect, _input, options) =>
      effect.pipe(Effect.annotateLogs(getCustomerLookupLogAnnotations(options)))
  );

  const findOrCreateCustomer = Effect.fn("findOrCreateCustomer")(
    function* (
      customerData: DotyposCustomerLookupData,
      options?: FindCustomerOptions
    ) {
      yield* Effect.annotateLogsScoped({
        customerInputFields: presentCustomerInputFields(customerData),
      });
      yield* Effect.logInfo("Dotypos customer lookup started");

      const lookup = yield* lookupCustomer(customerData, options);

      yield* Effect.logDebug("Dotypos customer lookup result", { lookup });

      const normalizedCustomerData = lookup.normalizedCustomerData;
      const existingCustomer = lookup.matches[0];

      if (existingCustomer) {
        const needsUpdate =
          (normalizedCustomerData.email && !existingCustomer.email) ||
          (normalizedCustomerData.phone && !existingCustomer.phone) ||
          (normalizedCustomerData.firstName && !existingCustomer.firstName) ||
          (normalizedCustomerData.lastName && !existingCustomer.lastName);

        yield* Effect.logDebug("Dotypos customer update-needed decision", {
          needsUpdate,
          existingCustomer,
          normalizedCustomerData,
        });

        if (needsUpdate) {
          const customerId = existingCustomer.id;
          if (!customerId) {
            return yield* Effect.fail(
              new ValidationError({
                message: "Cannot update Dotypos customer without id",
              })
            );
          }

          const updateRequest: UpdateCustomerRequest = {
            ...(normalizedCustomerData.email && !existingCustomer.email
              ? { email: normalizedCustomerData.email }
              : {}),
            ...(normalizedCustomerData.phone && !existingCustomer.phone
              ? { phone: normalizedCustomerData.phone }
              : {}),
            ...(normalizedCustomerData.firstName && !existingCustomer.firstName
              ? { firstName: normalizedCustomerData.firstName }
              : {}),
            ...(normalizedCustomerData.lastName && !existingCustomer.lastName
              ? { lastName: normalizedCustomerData.lastName }
              : {}),
          };

          const updatedCustomer = yield* runDotyposRequest(
            client.updateCustomer(config.cloudId, customerId, {
              payload: updateRequest,
            }),
            "updateCustomer"
          ).pipe(
            Effect.retry(retryPolicy),
            Effect.tapError((error) =>
              Effect.logWarning("Dotypos customer update failed", {
                error,
                existingCustomer,
                input: normalizedCustomerData,
                operation: "updateCustomer",
                request: {
                  path: {
                    cloudId: config.cloudId,
                    customerId,
                  },
                  body: updateRequest,
                },
              })
            ),
            Effect.catch(() => Effect.succeed(existingCustomer))
          );

          yield* Effect.logDebug("Dotypos existing customer result", {
            customer: updatedCustomer,
          });

          return updatedCustomer;
        }

        yield* Effect.logDebug("Dotypos existing customer result", {
          customer: existingCustomer,
        });

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

      const createRequest: CreateCustomerRequest = {
        _cloudId: config.cloudId,
        addressLine1: "",
        barcode: "",
        companyId: "",
        companyName: "",
        deleted: false,
        display: true,
        firstName: normalizedCustomerData.firstName,
        flags: "0",
        headerPrint: "",
        hexColor: "#000000",
        internalNote: "",
        lastName: normalizedCustomerData.lastName ?? "",
        email: normalizedCustomerData.email,
        phone: normalizedCustomerData.phone,
        points: "0",
        tags: [],
        vatId: "",
        zip: "",
        expireDate: null,
      };

      const createCustomerRequestFields =
        presentCreateCustomerRequestFields(createRequest);

      yield* Effect.annotateLogsScoped({ createCustomerRequestFields });

      const customer = yield* runDotyposRequest(
        client
          .createCustomers(config.cloudId, { payload: [createRequest] })
          .pipe(
            Effect.flatMap((customers) =>
              firstOrExternalError(customers, "createCustomer")
            )
          ),
        "createCustomer"
      ).pipe(
        Effect.retry(retryPolicy),
        Effect.tapError((error) =>
          Effect.logError("Dotypos customer creation failed", {
            errorTag: error._tag,
            operation: "createCustomer",
            statusCode:
              error._tag === "ExternalAPIError" ? error.statusCode : undefined,
            providerError:
              error._tag === "ExternalAPIError"
                ? error.providerError
                : undefined,
            createCustomerRequestFields,
          })
        )
      );

      yield* Effect.logInfo("Dotypos customer created", { customer });

      return customer;
    },
    (effect, _input, options) =>
      effect.pipe(
        Effect.annotateLogs(getCustomerLookupLogAnnotations(options)),
        Effect.scoped
      )
  );

  const getCustomerDiscount = Effect.fn("getCustomerDiscount")(
    function* (customer: Customer) {
      const discountGroupId = customer._discountGroupId?.toString().trim();
      if (!discountGroupId) return undefined;

      const discountGroup = yield* runDotyposRequest(
        getDiscountGroup({
          config,
          discountGroupId,
          httpClient,
        }),
        "getDiscountGroup"
      ).pipe(Effect.retry(retryPolicy));
      const percent = parseDiscountPercent(discountGroup.discountPercent);

      if (percent === undefined) return undefined;

      return {
        source: "dotypos-discount-group",
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
    return yield* runDotyposRequest(
      client
        .getTables(config.cloudId, { params: { limit: 100 } })
        .pipe(Effect.map((page) => [...(page.data ?? [])])),
      "getTables"
    ).pipe(Effect.retry(retryPolicy), catchUnexpectedDotyposError("getTables"));
  });

  const listReservations = Effect.fn("listReservations")(function* () {
    return yield* runDotyposRequest(
      client
        .listReservations(config.cloudId, { params: { limit: 100 } })
        .pipe(Effect.map((page) => [...(page.data ?? [])])),
      "listReservations"
    ).pipe(
      Effect.catchTag("ExternalAPIError", (error) =>
        error.statusCode === 404 ? Effect.succeed([]) : Effect.fail(error)
      ),
      Effect.retry(retryPolicy),
      catchUnexpectedDotyposError("listReservations")
    );
  });

  const getProducts = Effect.fn("getProducts")(function* (options: {
    categoryId?: string;
    includeDeleted?: boolean;
  }) {
    return yield* runDotyposRequest(
      client
        .getProducts(config.cloudId, {
          params: {
            limit: 100,
            ...(options?.categoryId && {
              filter: `_categoryId|eq|${options.categoryId}`,
            }),
          },
        })
        .pipe(Effect.map((page) => [...(page.data ?? [])])),
      "getProducts"
    ).pipe(
      Effect.map((products) =>
        options?.includeDeleted
          ? products
          : products.filter((product) => !product.deleted)
      ),
      Effect.retry(retryPolicy),
      catchUnexpectedDotyposError("getProducts")
    );
  });

  const getCategories = Effect.fn("getCategories")(function* () {
    return yield* runDotyposRequest(
      client
        .getCategories(config.cloudId, { params: { limit: 100 } })
        .pipe(Effect.map((page) => [...(page.data ?? [])])),
      "getCategories"
    ).pipe(Effect.retry(retryPolicy));
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
);

export class DotyposService extends Context.Service<
  DotyposService,
  Effect.Success<typeof makeDotyposService>
>()("DotyposService") {
  static DefaultWithoutDependencies = Layer.effect(
    this,
    makeDotyposService
  ).pipe(
    Layer.provide(DotyposGeneratedClient.Live),
    Layer.provide(DotyposAccessToken.Live)
  );
  static Default = this.DefaultWithoutDependencies.pipe(
    Layer.provide(FetchHttpClient.layer)
  );
}
