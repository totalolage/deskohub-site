import {
  Context,
  Data,
  Duration,
  Effect,
  Layer,
  Match,
  Option,
  Predicate,
  Schedule,
  Schema,
} from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { DotyposRuntimeConfig } from "../config";
import { ExternalAPIError, NetworkError, ValidationError } from "../errors";
import type {
  CreateCustomerRequest,
  CreateReservationRequest,
  UpdateCustomerRequest,
  UpdateReservationRequest,
} from "../generated/effect.gen";
import type {
  CreateDotyposReservationInput,
  DotyposCategoryId,
  DotyposCustomer,
  DotyposCustomerId,
  DotyposDiscountGroup,
  DotyposDiscountGroupId,
  DotyposProduct,
  DotyposReservationId,
  DotyposReservationInterval,
  UpdateDotyposReservationInput,
} from "../types";
import {
  DotyposCategorySchema,
  DotyposCustomerIdSchema,
  DotyposCustomerSchema,
  DotyposDiscountGroupIdSchema,
  DotyposDiscountGroupSchema,
  DotyposProductSchema,
  DotyposReservationIdSchema,
  DotyposReservationSchema,
  DotyposTableIdSchema,
  DotyposTableSchema,
} from "../types";
import { normalizePhoneNumber } from "../utils/phone-formatting";
import {
  DotyposAccessToken,
  DotyposGeneratedClient,
  mapDotyposClientError,
} from "./api";

type DotyposError = ValidationError | ExternalAPIError | NetworkError;

export type ReservationListOptions = {
  readonly ids?: readonly DotyposReservationId[];
  readonly customerId?: DotyposCustomerId;
  readonly startsAtOrAfter?: string;
  readonly startsBefore?: string;
  readonly order?: "startDateAscending" | "startDateDescending";
};

export type CustomerListOptions = {
  readonly ids: readonly DotyposCustomerId[];
};

type DotyposPage<A> = {
  readonly data?: readonly A[];
  readonly nextPage?: string | null;
};

const isDotyposError = (error: unknown): error is DotyposError =>
  Predicate.isTagged(error, "ValidationError") ||
  Predicate.isTagged(error, "ExternalAPIError") ||
  Predicate.isTagged(error, "NetworkError");

const isRetryableDotyposError = (error: DotyposError) =>
  Match.value(error).pipe(
    Match.tag("NetworkError", () => true),
    Match.tag("ExternalAPIError", (apiError) =>
      Boolean(
        apiError.statusCode &&
          (apiError.statusCode === 429 || apiError.statusCode >= 500)
      )
    ),
    Match.orElse(() => false)
  );

const retryPolicy = {
  schedule: Schedule.exponential("100 millis").pipe(
    Schedule.jittered,
    Schedule.while<DotyposError, Duration.Duration>(({ input }) =>
      isRetryableDotyposError(input)
    ),
    Schedule.both(Schedule.recurs(3)),
    Schedule.tapOutput(([delay, attempt]) =>
      Effect.logWarning(`Dotypos retry attempt #${attempt + 1}`, {
        attemptNumber: attempt + 1,
        delayMs: Duration.toMillis(delay),
        maxRetries: 3,
      })
    )
  ),
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

const validateReservationInterval = (
  interval: DotyposReservationInterval
): Effect.Effect<void, ValidationError> => {
  const startDate = interval.startDate.getTime();
  const endDate = interval.endDate.getTime();

  if (Number.isNaN(startDate) || Number.isNaN(endDate)) {
    return Effect.fail(
      new ValidationError({ message: "Reservation dates must be valid" })
    );
  }

  if (endDate <= startDate) {
    return Effect.fail(
      new ValidationError({
        message: "Reservation end date must be after start date",
      })
    );
  }

  return Effect.void;
};

const getActiveReservationOverlapFilter = (
  interval: DotyposReservationInterval
) =>
  validateReservationInterval(interval).pipe(
    Effect.as(
      [
        "status|in|NEW,CONFIRMED",
        `startDate|lt|${interval.endDate.getTime()}`,
        `endDate|gt|${interval.startDate.getTime()}`,
      ].join(";")
    )
  );

const getNextDotyposPageNumber = (input: {
  readonly currentPage: number;
  readonly nextPage: string | null | undefined;
  readonly operation: string;
}) =>
  Effect.succeed(
    Option.fromNullishOr(input.nextPage).pipe(
      Option.map(Number),
      Option.getOrUndefined
    )
  ).pipe(
    Effect.filterOrFail(
      (pageNumber) =>
        pageNumber === undefined ||
        (Number.isSafeInteger(pageNumber) && pageNumber > input.currentPage),
      () =>
        new ExternalAPIError({
          service: "Dotypos",
          operation: input.operation,
          message: `Dotypos returned an invalid next page: ${input.nextPage}`,
          statusCode: 502,
        })
    )
  );

const loadAllDotyposPages = <A, E, R>(input: {
  readonly loadPage: (page: number) => Effect.Effect<DotyposPage<A>, E, R>;
  readonly operation: string;
}): Effect.Effect<readonly A[], E | ExternalAPIError, R> => {
  const items: A[] = [];
  let currentPage = 1;
  let hasNextPage = true;

  return Effect.whileLoop({
    while: () => hasNextPage,
    body: () =>
      input.loadPage(currentPage).pipe(
        Effect.bindTo("page"),
        Effect.bind("nextPage", ({ page }) =>
          getNextDotyposPageNumber({
            currentPage,
            nextPage: page.nextPage,
            operation: input.operation,
          })
        )
      ),
    step: ({ nextPage, page }) => {
      items.push(...(page.data ?? []));
      hasNextPage = nextPage !== undefined;
      if (nextPage !== undefined) currentPage = nextPage;
    },
  }).pipe(Effect.map(() => items));
};

export type CustomerLookupField = "email" | "phone";

export type DotyposCustomerLookupData = {
  firstName: string;
  lastName?: string;
  email?: string;
  phone?: string;
};

export type DotyposCustomerDiscount = {
  readonly source: "dotypos-discount-group";
  readonly discountGroupId: DotyposDiscountGroupId;
  readonly percent: number;
};

export type DotyposCustomerDiscountGroup = {
  readonly discountGroupId: DotyposDiscountGroupId;
  readonly discountPercent: DotyposDiscountGroup["discountPercent"];
};

export type DotyposCustomerBillingDetails = {
  readonly addressLine1: string;
  readonly addressLine2: string;
  readonly city: string;
  readonly zip: string;
  readonly country: string;
  readonly companyName: string;
  readonly companyId: string;
  readonly vatId: string;
};

export type DotyposCustomerDetails = DotyposCustomerBillingDetails & {
  readonly firstName: string;
  readonly lastName: string;
  readonly email: string;
  readonly phone?: string;
};

export type FindCustomerOptions = {
  readonly lookupFields?: readonly CustomerLookupField[];
};

export type FindCustomerResult = Data.TaggedEnum<{
  Matched: {
    readonly customer: DotyposCustomer;
    readonly matches: readonly DotyposCustomer[];
  };
  NotFound: {
    readonly matches: readonly [];
  };
  Ambiguous: {
    readonly matches: readonly [
      DotyposCustomer,
      DotyposCustomer,
      ...DotyposCustomer[],
    ];
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

const normalizeIdentifier = <A>(
  schema: Schema.Decoder<A>,
  value: string,
  label: string
) =>
  Schema.decodeUnknownEffect(schema)(value.trim()).pipe(
    Effect.mapError(
      (cause) =>
        new ValidationError({
          message: `${label} is required`,
          cause,
        })
    )
  );

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

const addUniqueCustomer = (
  customers: DotyposCustomer[],
  customer: DotyposCustomer
) => {
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
  customers: readonly DotyposCustomer[]
): customers is readonly [
  DotyposCustomer,
  DotyposCustomer,
  ...DotyposCustomer[],
] => customers.length >= 2;

const makeDotyposService = Effect.gen(function* () {
  const config = yield* DotyposRuntimeConfig;
  const { client } = yield* DotyposGeneratedClient;

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

  const decodeProviderEntity = <A>(
    schema: Schema.Decoder<A>,
    value: unknown,
    operation: string
  ) =>
    Schema.decodeUnknownEffect(schema)(value).pipe(
      Effect.mapError(
        (cause) =>
          new ExternalAPIError({
            service: "Dotypos",
            operation,
            message: "Dotypos returned malformed entity identifiers.",
            statusCode: 502,
            cause,
          })
      )
    );

  const decodeProviderEntities = <A>(
    schema: Schema.Decoder<A>,
    values: readonly unknown[],
    operation: string
  ) =>
    Effect.forEach(values, (value) =>
      decodeProviderEntity(schema, value, operation)
    );

  const decodeProviderPage = <A>(
    schema: Schema.Decoder<A>,
    page: DotyposPage<unknown>,
    operation: string
  ) =>
    decodeProviderEntities(schema, page.data ?? [], operation).pipe(
      Effect.map((data) => ({ ...page, data }))
    );

  const getReservation = Effect.fn("getReservation")(
    function* (id: DotyposReservationId) {
      const reservationId = yield* normalizeIdentifier(
        DotyposReservationIdSchema,
        id,
        "Reservation ID"
      );
      const reservationResult = yield* runDotyposRequest(
        client.getReservation(config.cloudId, reservationId, undefined),
        "getReservation"
      ).pipe(
        Effect.retry(retryPolicy),
        catchUnexpectedDotyposError("getReservation")
      );

      const reservation = yield* decodeProviderEntity(
        DotyposReservationSchema,
        { ...reservationResult, id: reservationId },
        "getReservation"
      );

      if (!reservation._customerId) {
        return yield* new ValidationError({
          message: `Reservation ${reservationId} has no customer ID`,
        });
      }

      const customerId = yield* normalizeIdentifier(
        DotyposCustomerIdSchema,
        reservation._customerId,
        "Customer ID"
      );
      const customerResult = yield* getCustomer(customerId);
      const customer = yield* decodeProviderEntity(
        DotyposCustomerSchema,
        { ...customerResult, id: customerId },
        "getCustomer"
      );

      return { reservation, customer };
    },
    (effect, reservationId) =>
      effect.pipe(
        Effect.annotateLogs({
          reservationId,
        })
      )
  );

  const getReservationStatus = Effect.fn("getReservationStatus")(
    function* (id: DotyposReservationId) {
      const reservationId = yield* normalizeIdentifier(
        DotyposReservationIdSchema,
        id,
        "Reservation ID"
      );

      const reservation = yield* runDotyposRequest(
        client.getReservation(config.cloudId, reservationId, undefined),
        "getReservation"
      ).pipe(
        Effect.retry(retryPolicy),
        catchUnexpectedDotyposError("getReservation")
      );

      return reservation.status;
    },
    (effect, reservationId) =>
      effect.pipe(Effect.annotateLogs({ reservationId }))
  );

  const createReservation = Effect.fn("createReservation")(
    function* (input: CreateDotyposReservationInput) {
      yield* Effect.annotateLogsScoped({ input });
      yield* Effect.logInfo("Dotypos reservation request build started");

      const customerId = yield* normalizeIdentifier(
        DotyposCustomerIdSchema,
        input.customerId,
        "Customer ID"
      );
      const tableId = yield* normalizeIdentifier(
        DotyposTableIdSchema,
        input.tableId,
        "Table ID"
      );

      if (!Number.isInteger(input.seats) || input.seats <= 0) {
        return yield* new ValidationError({
          message: "Reservation seats must be a positive integer",
        });
      }

      yield* validateReservationInterval(input);

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

      const reservationResult = yield* runDotyposRequest(
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

      const reservationId = yield* normalizeIdentifier(
        DotyposReservationIdSchema,
        reservationResult.id ?? "",
        "Reservation ID"
      );
      const reservation = yield* decodeProviderEntity(
        DotyposReservationSchema,
        { ...reservationResult, id: reservationId },
        "createReservation"
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
    function* (reservationId: DotyposReservationId) {
      yield* Effect.annotateLogsScoped({ reservationId });
      const id = yield* normalizeIdentifier(
        DotyposReservationIdSchema,
        reservationId,
        "Reservation ID"
      );

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

  const patchReservation = Effect.fn("DotyposService.patchReservation")(
    (input: {
      readonly reservationId: DotyposReservationId;
      readonly payload: UpdateReservationRequest;
    }) =>
      Effect.succeed(input).pipe(
        Effect.bind("response", ({ reservationId }) =>
          runDotyposRequest(
            client.getReservation(config.cloudId, reservationId, {
              config: { includeResponse: true },
            }),
            "getReservation"
          ).pipe(Effect.retry(retryPolicy))
        ),
        Effect.bind("etag", ({ response: [, response] }) => {
          const etag = response.headers.etag ?? response.headers.ETag;

          return etag
            ? Effect.succeed(etag)
            : Effect.fail(
                new ExternalAPIError({
                  service: "Dotypos",
                  operation: "getReservation",
                  message: "Reservation ETag header was missing.",
                })
              );
        }),
        Effect.bind("reservation", ({ etag, payload, reservationId }) =>
          runDotyposRequest(
            client.patchReservation(config.cloudId, reservationId, {
              params: { "If-Match": etag },
              payload,
            }),
            "patchReservation"
          ).pipe(
            Effect.retry(retryPolicy),
            Effect.flatMap((reservation) =>
              decodeProviderEntity(
                DotyposReservationSchema,
                { ...reservation, id: reservation.id ?? reservationId },
                "patchReservation"
              )
            )
          )
        ),
        Effect.map(({ reservation }) => reservation)
      )
  );

  const confirmReservation = Effect.fn("confirmReservation")(
    function* (reservationId: DotyposReservationId) {
      const id = yield* normalizeIdentifier(
        DotyposReservationIdSchema,
        reservationId,
        "Reservation ID"
      );

      yield* Effect.logInfo("Dotypos reservation confirmation patch started");

      const reservation = yield* patchReservation({
        reservationId: id,
        payload: { status: "CONFIRMED" },
      }).pipe(
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

  const updateReservation = Effect.fn("DotyposService.updateReservation")(
    function* (input: UpdateDotyposReservationInput) {
      const reservationId = yield* normalizeIdentifier(
        DotyposReservationIdSchema,
        input.reservationId,
        "Reservation ID"
      );
      const note = input.note.trim();

      if (!note) {
        return yield* new ValidationError({
          message: "Reservation note is required",
        });
      }

      yield* Effect.logInfo("Dotypos reservation update started");

      const reservation = yield* patchReservation({
        reservationId,
        payload: { note },
      }).pipe(
        Effect.tapError((error) =>
          Effect.logError("Dotypos reservation update failed", { error })
        )
      );

      yield* Effect.logInfo("Dotypos reservation update succeeded");

      return reservation;
    },
    (effect, input) =>
      effect.pipe(
        Effect.annotateLogs({ reservationId: input.reservationId }),
        Effect.scoped
      )
  );

  const getCustomer = Effect.fn("getCustomer")(
    function* (id: DotyposCustomerId) {
      const customer = yield* runDotyposRequest(
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
      return yield* decodeProviderEntity(
        DotyposCustomerSchema,
        { ...customer, id: customer.id ?? id },
        "getCustomer"
      );
    },
    (effect, customerId) =>
      effect.pipe(
        Effect.annotateLogs({
          customerId,
        })
      )
  );

  const getCustomers = Effect.fn("getCustomers")(function* (
    options: CustomerListOptions
  ) {
    const uniqueIds = [...new Set(options.ids)];
    if (uniqueIds.length === 0) return [];
    if (uniqueIds.some((value) => !value.trim() || /[|;,]/.test(value))) {
      return yield* new ValidationError({
        message: "Customer filters contain an invalid value",
      });
    }
    const filter = [`id|in|${uniqueIds.join(",")}`, "deleted|in|0,1"].join(";");

    return yield* loadAllDotyposPages({
      loadPage: (page) =>
        runDotyposRequest(
          client.getCustomers(config.cloudId, {
            params: {
              filter,
              limit: 100,
              page,
            },
          }),
          "getCustomers"
        ).pipe(
          Effect.catchTag("ExternalAPIError", (error) =>
            page === 1 && error.statusCode === 404
              ? Effect.succeed({ data: [] as const })
              : Effect.fail(error)
          ),
          Effect.flatMap((result) =>
            decodeProviderPage(DotyposCustomerSchema, result, "getCustomers")
          )
        ),
      operation: "getCustomers",
    }).pipe(
      Effect.retry(retryPolicy),
      catchUnexpectedDotyposError("getCustomers")
    );
  });

  const searchCustomers = Effect.fn("searchCustomers")(function* (
    rawQuery: string
  ) {
    const query = rawQuery.trim();
    if (query.length < 2 || query.length > 100 || /[|;]/.test(query)) {
      return yield* new ValidationError({
        message: "Customer search query is invalid",
      });
    }

    const matches = yield* Effect.all(
      (["firstName", "lastName", "companyName", "email"] as const).map(
        (field) =>
          loadAllDotyposPages({
            loadPage: (page) =>
              runDotyposRequest(
                client.getCustomers(config.cloudId, {
                  params: {
                    filter: `${field}|like|${query}`,
                    limit: 100,
                    page,
                  },
                }),
                "searchCustomers"
              ).pipe(
                Effect.catchTag("ExternalAPIError", (error) =>
                  page === 1 && error.statusCode === 404
                    ? Effect.succeed({ data: [] as const })
                    : Effect.fail(error)
                ),
                Effect.flatMap((result) =>
                  decodeProviderPage(
                    DotyposCustomerSchema,
                    result,
                    "searchCustomers"
                  )
                )
              ),
            operation: "searchCustomers",
          }).pipe(Effect.retry(retryPolicy))
      ),
      { concurrency: 4 }
    );
    const customers: DotyposCustomer[] = [];
    for (const match of matches.flat()) addUniqueCustomer(customers, match);
    return customers;
  });

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

          const customers = yield* runDotyposRequest(
            client
              .getCustomers(config.cloudId, {
                params: { limit: 100, filter },
              })
              .pipe(Effect.map((page) => [...(page.data ?? [])])),
            "searchCustomers"
          ).pipe(
            Effect.catchTag("ExternalAPIError", (error) =>
              error.statusCode === 404 ? Effect.succeed([]) : Effect.fail(error)
            ),
            Effect.retry(retryPolicy)
          );
          return yield* decodeProviderEntities(
            DotyposCustomerSchema,
            customers,
            "searchCustomers"
          );
        });

      const lookupFields = options?.lookupFields ?? defaultCustomerLookupFields;
      const shouldLookupBy = (field: CustomerLookupField) =>
        lookupFields.includes(field);

      const matchingCustomers: DotyposCustomer[] = [];

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

      const activeMatchingCustomers = matchingCustomers.filter(
        (customer) => !customer.deleted
      );

      if (activeMatchingCustomers.length === 0) {
        return {
          _tag: "NotFound" as const,
          matches: [],
          normalizedCustomerData,
        };
      }

      if (hasAtLeastTwoCustomers(activeMatchingCustomers)) {
        return {
          _tag: "Ambiguous" as const,
          matches: activeMatchingCustomers,
          normalizedCustomerData,
        };
      }

      return {
        _tag: "Matched" as const,
        customer: activeMatchingCustomers[0]!,
        matches: activeMatchingCustomers,
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

      return Match.value(result).pipe(
        Match.tag("Matched", (matched) =>
          FindCustomerResult.Matched({
            customer: matched.customer,
            matches: matched.matches,
          })
        ),
        Match.tag("Ambiguous", (ambiguous) =>
          FindCustomerResult.Ambiguous({ matches: ambiguous.matches })
        ),
        Match.tag("NotFound", () =>
          FindCustomerResult.NotFound({ matches: [] })
        ),
        Match.exhaustive
      );
    },
    (effect, _input, options) =>
      effect.pipe(Effect.annotateLogs(getCustomerLookupLogAnnotations(options)))
  );

  const createCustomer = Effect.fn("DotyposService.createCustomer")(
    function* (details: DotyposCustomerDetails) {
      const email = details.email.trim();
      if (!email) {
        return yield* new ValidationError({
          message: "Customer email is required",
        });
      }

      const request: CreateCustomerRequest = {
        _cloudId: config.cloudId,
        addressLine1: details.addressLine1.trim(),
        addressLine2: details.addressLine2.trim() || null,
        barcode: "",
        city: details.city.trim() || null,
        companyId: details.companyId.trim(),
        companyName: details.companyName.trim(),
        country: details.country.trim() || null,
        deleted: false,
        display: true,
        email,
        expireDate: null,
        firstName: details.firstName.trim(),
        flags: "0",
        headerPrint: "",
        hexColor: "#000000",
        internalNote: "",
        lastName: details.lastName.trim(),
        phone: details.phone ? normalizePhoneNumber(details.phone) || "" : "",
        points: "0",
        tags: [],
        vatId: details.vatId.trim(),
        zip: details.zip.trim(),
      };

      const result = yield* runDotyposRequest(
        client
          .createCustomers(config.cloudId, { payload: [request] })
          .pipe(
            Effect.flatMap((customers) =>
              firstOrExternalError(customers, "createCustomer")
            )
          ),
        "createCustomer"
      );

      return yield* decodeProviderEntity(
        DotyposCustomerSchema,
        result,
        "createCustomer"
      );
    },
    (effect) => effect.pipe(Effect.scoped)
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
      const existingCustomer = yield* Match.value(lookup).pipe(
        Match.tag("Ambiguous", (ambiguousLookup) =>
          Effect.gen(function* () {
            yield* Effect.logError("Ambiguous Dotypos customer lookup", {
              customerIds: ambiguousLookup.matches.map(
                (customer) => customer.id
              ),
              matchCount: ambiguousLookup.matches.length,
            });

            return yield* new ValidationError({
              message: "Dotypos customer lookup matched multiple customers",
            });
          })
        ),
        Match.tag("Matched", (matchedLookup) =>
          Effect.succeed(matchedLookup.matches[0])
        ),
        Match.tag("NotFound", () => Effect.as(Effect.void, undefined)),
        Match.exhaustive
      );

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
            return yield* new ValidationError({
              message: "Cannot update Dotypos customer without id",
            });
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
            Effect.flatMap((customer) =>
              decodeProviderEntity(
                DotyposCustomerSchema,
                { ...customer, id: customer.id ?? customerId },
                "updateCustomer"
              )
            ),
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
            Effect.orElseSucceed(() => existingCustomer)
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
        return yield* new ValidationError({
          message: "Customer email is required",
        });
      }

      if (!normalizedCustomerData.phone) {
        return yield* new ValidationError({
          message: "Customer phone is required",
        });
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

      const customerResult = yield* runDotyposRequest(
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
        Effect.tapError((error) => {
          const apiErrorDetails = Match.value(error).pipe(
            Match.tag("ExternalAPIError", (apiError) => ({
              providerError: apiError.providerError,
              statusCode: apiError.statusCode,
            })),
            Match.orElse(() => ({
              providerError: undefined,
              statusCode: undefined,
            }))
          );

          return Effect.logError("Dotypos customer creation failed", {
            errorTag: error._tag,
            operation: "createCustomer",
            ...apiErrorDetails,
            createCustomerRequestFields,
          });
        })
      );

      const customer = yield* decodeProviderEntity(
        DotyposCustomerSchema,
        customerResult,
        "createCustomer"
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

  const loadCustomerDiscountGroup = (customer: DotyposCustomer) =>
    Effect.gen(function* () {
      const rawDiscountGroupId = customer._discountGroupId?.toString().trim();
      if (!rawDiscountGroupId) return undefined;

      const discountGroupId = yield* normalizeIdentifier(
        DotyposDiscountGroupIdSchema,
        rawDiscountGroupId,
        "Discount group ID"
      );

      return yield* runDotyposRequest(
        client.getDiscountGroup(config.cloudId, discountGroupId, undefined),
        "getDiscountGroup"
      ).pipe(
        Effect.retry(retryPolicy),
        Effect.map(
          (discountGroup) =>
            ({
              discountGroupId,
              discountPercent: discountGroup.discountPercent,
            }) satisfies DotyposCustomerDiscountGroup
        )
      );
    });

  const getCustomerDiscountGroup = Effect.fn(
    "DotyposService.getCustomerDiscountGroup"
  )(
    (input: { readonly customerId: DotyposCustomerId }) =>
      Effect.succeed(input).pipe(
        Effect.bind("normalizedCustomerId", ({ customerId }) =>
          normalizeIdentifier(
            DotyposCustomerIdSchema,
            customerId,
            "Customer ID"
          )
        ),
        Effect.bind("customer", ({ normalizedCustomerId }) =>
          getCustomer(normalizedCustomerId)
        ),
        Effect.bind("discountGroup", ({ customer }) =>
          loadCustomerDiscountGroup(customer)
        ),
        Effect.map(({ discountGroup }) => discountGroup)
      ),
    (effect, input) =>
      effect.pipe(Effect.annotateLogs({ customerId: input.customerId }))
  );

  const getCustomerDiscount = Effect.fn("getCustomerDiscount")(
    function* (customer: DotyposCustomer) {
      const discountGroup = yield* loadCustomerDiscountGroup(customer);
      if (!discountGroup) return undefined;

      const percent = parseDiscountPercent(discountGroup.discountPercent);

      if (percent === undefined) return undefined;

      return {
        source: "dotypos-discount-group",
        discountGroupId: discountGroup.discountGroupId,
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

  const getDiscountGroups = Effect.fn("DotyposService.getDiscountGroups")(() =>
    loadAllDotyposPages({
      loadPage: (page) =>
        runDotyposRequest(
          client.getDiscountGroups(config.cloudId, {
            params: { limit: 100, page },
          }),
          "getDiscountGroups"
        ).pipe(
          Effect.catchTag("ExternalAPIError", (error) =>
            page === 1 && error.statusCode === 404
              ? Effect.succeed({ data: [] as const })
              : Effect.fail(error)
          ),
          Effect.flatMap((result) =>
            decodeProviderPage(
              DotyposDiscountGroupSchema,
              result,
              "getDiscountGroups"
            )
          )
        ),
      operation: "getDiscountGroups",
    }).pipe(
      Effect.retry(retryPolicy),
      catchUnexpectedDotyposError("getDiscountGroups")
    )
  );

  const patchCustomer = Effect.fn("DotyposService.patchCustomer")(function* (
    customerId: DotyposCustomerId,
    payload: UpdateCustomerRequest
  ) {
    const normalizedCustomerId = yield* normalizeIdentifier(
      DotyposCustomerIdSchema,
      customerId,
      "Customer ID"
    );

    const [, response] = yield* runDotyposRequest(
      client.getCustomer(config.cloudId, normalizedCustomerId, {
        config: { includeResponse: true },
      }),
      "getCustomer"
    ).pipe(Effect.retry(retryPolicy));
    const etag = response.headers.etag ?? response.headers.ETag;
    if (!etag) {
      return yield* new ExternalAPIError({
        service: "Dotypos",
        operation: "getCustomer",
        message: "Customer ETag header was missing.",
      });
    }

    const customer = yield* runDotyposRequest(
      client.patchCustomer(config.cloudId, normalizedCustomerId, {
        params: { "If-Match": etag },
        payload,
      }),
      "patchCustomer"
    ).pipe(Effect.retry(retryPolicy));
    return yield* decodeProviderEntity(
      DotyposCustomerSchema,
      { ...customer, id: customer.id ?? normalizedCustomerId },
      "patchCustomer"
    );
  });

  const setCustomerDiscountGroup = Effect.fn(
    "DotyposService.setCustomerDiscountGroup"
  )(function* (
    customerId: DotyposCustomerId,
    discountGroupId: DotyposDiscountGroupId | null
  ) {
    const normalizedDiscountGroupId = discountGroupId
      ? yield* normalizeIdentifier(
          DotyposDiscountGroupIdSchema,
          discountGroupId,
          "Discount group ID"
        )
      : null;

    return yield* patchCustomer(customerId, {
      _discountGroupId: normalizedDiscountGroupId,
    });
  });

  const updateCustomerBillingDetails = Effect.fn(
    "DotyposService.updateCustomerBillingDetails"
  )((customerId: DotyposCustomerId, details: DotyposCustomerBillingDetails) =>
    patchCustomer(customerId, details)
  );

  const updateCustomerDetails = Effect.fn(
    "DotyposService.updateCustomerDetails"
  )((customerId: DotyposCustomerId, details: DotyposCustomerDetails) =>
    patchCustomer(customerId, {
      addressLine1: details.addressLine1.trim(),
      addressLine2: details.addressLine2.trim(),
      city: details.city.trim(),
      companyId: details.companyId.trim(),
      companyName: details.companyName.trim(),
      country: details.country.trim(),
      email: details.email.trim(),
      firstName: details.firstName.trim(),
      lastName: details.lastName.trim(),
      phone: details.phone ? normalizePhoneNumber(details.phone) || "" : "",
      vatId: details.vatId.trim(),
      zip: details.zip.trim(),
    })
  );

  const getTables = Effect.fn("getTables")(() =>
    loadAllDotyposPages({
      operation: "getTables",
      loadPage: (page) =>
        runDotyposRequest(
          client.getTables(config.cloudId, {
            params: { limit: 100, page },
          }),
          "getTables"
        ).pipe(
          Effect.flatMap((result) =>
            decodeProviderPage(DotyposTableSchema, result, "getTables")
          )
        ),
    }).pipe(Effect.retry(retryPolicy), catchUnexpectedDotyposError("getTables"))
  );

  const loadReservations = (options: {
    readonly filter?: string;
    readonly sort?: string;
  }) =>
    loadAllDotyposPages({
      operation: "listReservations",
      loadPage: (page) =>
        runDotyposRequest(
          client.listReservations(config.cloudId, {
            params: {
              limit: 100,
              page,
              ...(options.filter && { filter: options.filter }),
              ...(options.sort && { sort: options.sort }),
            },
          }),
          "listReservations"
        ).pipe(
          Effect.catchTag("ExternalAPIError", (error) =>
            page === 1 && error.statusCode === 404
              ? Effect.succeed({ data: [] })
              : Effect.fail(error)
          ),
          Effect.flatMap((result) =>
            decodeProviderPage(
              DotyposReservationSchema,
              result,
              "listReservations"
            )
          )
        ),
    }).pipe(
      Effect.retry(retryPolicy),
      catchUnexpectedDotyposError("listReservations")
    );

  const listReservations = Effect.fn("listReservations")(function* (
    options: ReservationListOptions = {}
  ) {
    const ids = [...new Set(options.ids ?? [])];
    if (options.ids && ids.length === 0) return [];
    const filterValues = [
      options.customerId,
      options.startsAtOrAfter,
      options.startsBefore,
    ].filter((value): value is string => value !== undefined);

    if (
      ids.some((id) => !id.trim() || /[|;,]/.test(id)) ||
      filterValues.some((value) => !value.trim() || /[|;]/.test(value))
    ) {
      return yield* new ValidationError({
        message: "Reservation filters contain an invalid value",
      });
    }

    const filter = [
      ids.length > 0 && `id|in|${ids.join(",")}`,
      options.customerId && `_customerId|eq|${options.customerId}`,
      options.startsAtOrAfter && `startDate|gteq|${options.startsAtOrAfter}`,
      options.startsBefore && `startDate|lt|${options.startsBefore}`,
    ]
      .filter((value): value is string => Boolean(value))
      .join(";");

    return yield* loadReservations({
      ...(filter && { filter }),
      ...(options.order && {
        sort:
          options.order === "startDateAscending" ? "startDate" : "-startDate",
      }),
    });
  });

  const listActiveReservationsOverlapping = Effect.fn(
    "listActiveReservationsOverlapping"
  )(function* (interval: DotyposReservationInterval) {
    const filter = yield* getActiveReservationOverlapFilter(interval);
    return yield* loadReservations({ filter });
  });

  const getProducts = Effect.fn("getProducts")(function* (options: {
    categoryId?: DotyposCategoryId;
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
      Effect.flatMap((products) =>
        decodeProviderEntities(DotyposProductSchema, products, "getProducts")
      ),
      Effect.map((products: readonly DotyposProduct[]) =>
        options?.includeDeleted
          ? products
          : products.filter((product) => !product.deleted)
      ),
      Effect.retry(retryPolicy),
      catchUnexpectedDotyposError("getProducts")
    );
  });

  const getCategories = Effect.fn("getCategories")(function* () {
    const categories = yield* runDotyposRequest(
      client
        .getCategories(config.cloudId, { params: { limit: 100 } })
        .pipe(Effect.map((page) => [...(page.data ?? [])])),
      "getCategories"
    ).pipe(Effect.retry(retryPolicy));
    return yield* decodeProviderEntities(
      DotyposCategorySchema,
      categories,
      "getCategories"
    );
  });

  return {
    createReservation,
    updateReservation,
    cancelReservation,
    confirmReservation,
    getReservation,
    getReservationStatus,
    getCustomer,
    getCustomers,
    createCustomer,
    searchCustomers,
    getCustomerDiscountGroup,
    getCustomerDiscount,
    getDiscountGroups,
    setCustomerDiscountGroup,
    updateCustomerBillingDetails,
    updateCustomerDetails,
    findCustomer,
    findOrCreateCustomer,
    getTables,
    listReservations,
    listActiveReservationsOverlapping,
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
  static Default = Layer.effect(this, makeDotyposService);

  static Live = this.Default.pipe(
    Layer.provide(DotyposGeneratedClient.Default),
    Layer.provide(DotyposAccessToken.Default),
    Layer.provide(FetchHttpClient.layer)
  );
}
