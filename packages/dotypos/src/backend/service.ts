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
  Customer,
  DiscountGroup,
  Reservation,
  UpdateCustomerRequest,
  UpdateReservationRequest,
} from "../generated/effect.gen";
import { canonicalizeDotyposEntityId } from "../identity";
import type {
  CreateDotyposReservationInput,
  UpdateDotyposReservationInput,
} from "../types";
import { normalizePhoneNumber } from "../utils/phone-formatting";
import {
  DotyposAccessToken,
  DotyposGeneratedClient,
  mapDotyposClientError,
} from "./api";

type DotyposError = ValidationError | ExternalAPIError | NetworkError;

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
      Boolean(apiError.statusCode && apiError.statusCode >= 500)
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

const preparedReservationCreationBrand = Symbol(
  "PreparedDotyposReservationCreation"
);

export interface PreparedDotyposReservationCreation {
  readonly [preparedReservationCreationBrand]: true;
}

type PreparedDotyposReservationCreationState = {
  readonly accessToken: string;
  readonly request: CreateReservationRequest;
};

const preparedReservationCreationState = new WeakMap<
  PreparedDotyposReservationCreation,
  PreparedDotyposReservationCreationState
>();

const reservationRequestEvidencePrefix = "Provider request evidence: ";

const reservationRequestEvidence = (input: {
  readonly branchId: string;
  readonly cloudId: string;
  readonly customerId: string;
  readonly tableId: string;
  readonly startDate: number;
  readonly endDate: number;
  readonly seats: number;
  readonly note: string;
}) =>
  createHash("sha256")
    .update(
      JSON.stringify([
        input.branchId,
        input.cloudId,
        input.customerId,
        input.tableId,
        input.startDate,
        input.endDate,
        input.seats,
        "NEW",
        input.note,
      ])
    )
    .digest("base64url");

const canonicalReservationProviderIdentity = (reservation: Reservation) => {
  const branchId = canonicalizeDotyposEntityId(reservation._branchId);
  const cloudId = canonicalizeDotyposEntityId(reservation._cloudId);
  const customerId = canonicalizeDotyposEntityId(reservation._customerId);
  const tableId = canonicalizeDotyposEntityId(reservation._tableId);
  return branchId && cloudId && customerId && tableId
    ? { branchId, cloudId, customerId, tableId }
    : null;
};

export const hasValidDotyposReservationRequestEvidence = (
  reservation: Reservation
) => {
  const lines = reservation.note?.split(/\r?\n/u) ?? [];
  const evidenceLines = lines.filter((line) =>
    line.startsWith(reservationRequestEvidencePrefix)
  );
  const evidence = evidenceLines[0]?.slice(
    reservationRequestEvidencePrefix.length
  );
  const note = lines
    .filter((line) => !line.startsWith(reservationRequestEvidencePrefix))
    .join("\n");
  const startDate = Date.parse(reservation.startDate);
  const endDate = Date.parse(reservation.endDate);
  const seats = Number(reservation.seats);
  const identity = canonicalReservationProviderIdentity(reservation);
  return Boolean(
    evidenceLines.length === 1 &&
      evidence &&
      identity &&
      Number.isFinite(startDate) &&
      Number.isFinite(endDate) &&
      Number.isInteger(seats) &&
      evidence ===
        reservationRequestEvidence({
          branchId: identity.branchId,
          cloudId: identity.cloudId,
          customerId: identity.customerId,
          tableId: identity.tableId,
          startDate,
          endDate,
          seats,
          note,
        })
  );
};

const verifyCreatedReservation = (
  reservation: Reservation,
  request: CreateReservationRequest
) => {
  const reservationId = canonicalizeDotyposEntityId(reservation.id);
  const identity = canonicalReservationProviderIdentity(reservation);
  const requestBranchId = canonicalizeDotyposEntityId(request._branchId);
  const requestCloudId = canonicalizeDotyposEntityId(request._cloudId);
  const requestCustomerId = canonicalizeDotyposEntityId(request._customerId);
  const requestTableId = canonicalizeDotyposEntityId(request._tableId);
  return Boolean(
    reservationId &&
      identity &&
      requestBranchId &&
      requestCloudId &&
      requestCustomerId &&
      requestTableId &&
      reservation.status === request.status &&
      identity.branchId === requestBranchId &&
      identity.cloudId === requestCloudId &&
      identity.customerId === requestCustomerId &&
      identity.tableId === requestTableId &&
      Date.parse(reservation.startDate) === request.startDate &&
      Date.parse(reservation.endDate) === request.endDate &&
      Number(reservation.seats) === request.seats &&
      reservation.note === request.note
  );
};

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

export type DotyposCustomerDiscountGroup = {
  readonly discountGroupId: string;
  readonly discountPercent: DiscountGroup["discountPercent"];
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
  const customerId = canonicalizeDotyposEntityId(customer.id);
  const isDuplicate = customers.find((existing) =>
    customerId
      ? canonicalizeDotyposEntityId(existing.id) === customerId
      : existing === customer
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
  const accessToken = yield* DotyposAccessToken;
  const { client, clientForAccessToken } = yield* DotyposGeneratedClient;

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

  const exactlyOneOrExternalError = <A>(
    items: readonly A[],
    operation: string
  ) =>
    items.length === 1 && items[0]
      ? Effect.succeed(items[0])
      : Effect.fail(
          new ExternalAPIError({
            service: "Dotypos",
            operation,
            message: "Dotypos returned an ambiguous item count.",
            statusCode: 502,
          })
        );

  const getReservation = Effect.fn("getReservation")(
    function* (id: string) {
      const reservationId = canonicalizeDotyposEntityId(id);
      if (!reservationId) {
        return yield* new ValidationError({
          message: "Reservation ID is required",
        });
      }
      const reservationResult = yield* runDotyposRequest(
        client.getReservation(config.cloudId, reservationId, undefined),
        "getReservation"
      ).pipe(
        Effect.retry(retryPolicy),
        catchUnexpectedDotyposError("getReservation")
      );

      const reservation = {
        ...reservationResult,
        id: reservationId,
      };

      const customerId = canonicalizeDotyposEntityId(reservation._customerId);
      if (!customerId) {
        return yield* new ValidationError({
          message: "Reservation has no customer ID",
        });
      }

      const customerResult = yield* getCustomer(customerId);
      const customer = {
        ...customerResult,
        id: customerId,
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

  const getReservationStatus = Effect.fn("getReservationStatus")(
    function* (id: string) {
      const reservationId = id.trim();
      if (!reservationId) {
        return yield* new ValidationError({
          message: "Reservation ID is required",
        });
      }

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

  const prepareReservationCreation = Effect.fn("prepareReservationCreation")(
    function* (input: CreateDotyposReservationInput) {
      yield* Effect.logInfo("Dotypos reservation request build started");

      const customerId = input.customerId.trim();
      const tableId = input.tableId.trim();
      const branchId = canonicalizeDotyposEntityId(config.branchId);
      const cloudId = canonicalizeDotyposEntityId(config.cloudId);

      if (!customerId) {
        return yield* new ValidationError({
          message: "Customer ID is required",
        });
      }

      if (!tableId) {
        return yield* new ValidationError({ message: "Table ID is required" });
      }
      if (!branchId || !cloudId) {
        return yield* new ValidationError({
          message: "Dotypos provider identity is invalid",
        });
      }

      if (!Number.isInteger(input.seats) || input.seats <= 0) {
        return yield* new ValidationError({
          message: "Reservation seats must be a positive integer",
        });
      }

      if (
        Number.isNaN(input.startDate.getTime()) ||
        Number.isNaN(input.endDate.getTime())
      ) {
        return yield* new ValidationError({
          message: "Reservation dates must be valid",
        });
      }

      if (input.endDate <= input.startDate) {
        return yield* new ValidationError({
          message: "Reservation end date must be after start date",
        });
      }

      const note = input.note?.trim();
      let request: CreateReservationRequest = {
        _branchId: branchId,
        _cloudId: cloudId,
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
      if (
        note
          ?.split(/\r?\n/u)
          .some((line) => line.startsWith("Provider creation epoch: "))
      ) {
        request = {
          ...request,
          note: `${note}\n${reservationRequestEvidencePrefix}${reservationRequestEvidence(
            {
              branchId: request._branchId,
              cloudId: request._cloudId,
              customerId,
              tableId,
              startDate: request.startDate,
              endDate: request.endDate,
              seats: request.seats,
              note,
            }
          )}`,
        };
      }

      // Authentication is prepared before the caller persists its irreversible
      // provider boundary. The prepared send consumes this fixed lease and
      // performs no token refresh or other fallible setup before the POST.
      const tokenLease = yield* accessToken.prepare(
        Math.max(config.apiTimeout + 15_000, 60_000)
      );
      const prepared = {
        [preparedReservationCreationBrand]: true,
      } as PreparedDotyposReservationCreation;
      preparedReservationCreationState.set(prepared, {
        accessToken: tokenLease.token,
        request,
      });
      return prepared;
    }
  );

  const createPreparedReservation = Effect.fn("createPreparedReservation")(
    function* (input: PreparedDotyposReservationCreation) {
      const prepared = preparedReservationCreationState.get(input);
      if (!prepared) {
        return yield* new ValidationError({
          message: "Reservation creation was not prepared or was already sent",
        });
      }
      preparedReservationCreationState.delete(input);
      yield* Effect.logInfo("Dotypos reservation API call started");
      const preparedClient = clientForAccessToken(prepared.accessToken);

      const reservation = yield* runDotyposRequest(
        preparedClient
          .createReservation(prepared.request._cloudId, {
            payload: [prepared.request],
          })
          .pipe(
            Effect.flatMap((reservations) =>
              exactlyOneOrExternalError(reservations, "createReservation")
            ),
            Effect.filterOrFail(
              (created) => verifyCreatedReservation(created, prepared.request),
              () =>
                new ExternalAPIError({
                  service: "Dotypos",
                  operation: "createReservation",
                  message:
                    "Dotypos reservation creation returned ambiguous evidence",
                  statusCode: 502,
                })
            ),
            Effect.provideService(FetchHttpClient.RequestInit, {
              redirect: "manual",
            })
          ),
        "createReservation"
      ).pipe(
        Effect.withSpan("dotyposService.createReservation"),
        // Dotypos does not expose an idempotency key for reservation POSTs.
        // Callers must reconcile an ambiguous result instead of sending again.
        Effect.tapError(() =>
          Effect.logError("Dotypos reservation creation failed")
        )
      );

      yield* Effect.logInfo("Dotypos reservation created successfully");

      const reservationId = canonicalizeDotyposEntityId(reservation.id);
      if (!reservationId) {
        return yield* new ExternalAPIError({
          service: "Dotypos",
          operation: "createReservation",
          message: "Dotypos reservation creation returned ambiguous evidence",
          statusCode: 502,
        });
      }
      return { ...reservation, id: reservationId };
    }
  );

  const createReservation = Effect.fn("createReservation")(
    function* (input: CreateDotyposReservationInput) {
      const prepared = yield* prepareReservationCreation(input);
      return yield* createPreparedReservation(prepared);
    },
    (effect) => effect.pipe(Effect.scoped)
  );

  const cancelReservation = Effect.fn("cancelReservation")(
    function* (reservationId: string) {
      yield* Effect.annotateLogsScoped({ reservationId });
      const id = reservationId.trim();

      if (!id) {
        return yield* new ValidationError({
          message: "Reservation ID is required",
        });
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

  const patchReservation = Effect.fn("DotyposService.patchReservation")(
    (input: {
      readonly reservationId: string;
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
          ).pipe(Effect.retry(retryPolicy))
        ),
        Effect.map(({ reservation }) => reservation)
      )
  );

  const confirmReservation = Effect.fn("confirmReservation")(
    function* (reservationId: string) {
      const id = reservationId.trim();

      if (!id) {
        return yield* new ValidationError({
          message: "Reservation ID is required",
        });
      }

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
      const reservationId = input.reservationId.trim();
      const note = input.note.trim();

      if (!reservationId) {
        return yield* new ValidationError({
          message: "Reservation ID is required",
        });
      }

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
    function* (id: string) {
      const customerId = canonicalizeDotyposEntityId(id);
      if (!customerId) {
        return yield* new ValidationError({
          message: "Customer ID is required",
        });
      }
      return yield* runDotyposRequest(
        client.getCustomer(config.cloudId, customerId, undefined),
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

      yield* Effect.logDebug("Dotypos customer lookup result", {
        lookupResult: lookup._tag,
        matchCount: lookup.matches.length,
      });

      const normalizedCustomerData = lookup.normalizedCustomerData;
      const existingCustomer = yield* Match.value(lookup).pipe(
        Match.tag("Ambiguous", (ambiguousLookup) =>
          Effect.gen(function* () {
            yield* Effect.logError("Ambiguous Dotypos customer lookup", {
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
          needsUpdate: Boolean(needsUpdate),
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
            Effect.tapError((error) =>
              Effect.logWarning("Dotypos customer update failed", {
                errorTag: error._tag,
                operation: "updateCustomer",
                requestFields: Object.keys(updateRequest),
              })
            ),
            Effect.orElseSucceed(() => existingCustomer)
          );

          yield* Effect.logDebug("Dotypos existing customer resolved");

          return updatedCustomer;
        }

        yield* Effect.logDebug("Dotypos existing customer resolved");

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
        Effect.tapError((error) => {
          const apiErrorDetails = Match.value(error).pipe(
            Match.tag("ExternalAPIError", (apiError) => ({
              statusCode: apiError.statusCode,
            })),
            Match.orElse(() => ({
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

      yield* Effect.logInfo("Dotypos customer created");

      return customer;
    },
    (effect, _input, options) =>
      effect.pipe(
        Effect.annotateLogs(getCustomerLookupLogAnnotations(options)),
        Effect.scoped
      )
  );

  const loadCustomerDiscountGroup = (customer: Customer) => {
    const discountGroupId = customer._discountGroupId?.toString().trim();
    if (!discountGroupId) return Effect.as(Effect.void, undefined);

    return runDotyposRequest(
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
  };

  const getCustomerDiscountGroup = Effect.fn(
    "DotyposService.getCustomerDiscountGroup"
  )(
    (input: { readonly customerId: string }) =>
      Effect.succeed(input).pipe(
        Effect.let("normalizedCustomerId", ({ customerId }) =>
          customerId.trim()
        ),
        Effect.filterOrFail(
          ({ normalizedCustomerId }) => Boolean(normalizedCustomerId),
          () => new ValidationError({ message: "Customer ID is required" })
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
    function* (customer: Customer) {
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

  const getTables = Effect.fn("getTables")(() =>
    loadAllDotyposPages({
      operation: "getTables",
      loadPage: (page) =>
        runDotyposRequest(
          client.getTables(config.cloudId, {
            params: { limit: 100, page },
          }),
          "getTables"
        ),
    }).pipe(Effect.retry(retryPolicy), catchUnexpectedDotyposError("getTables"))
  );

  const listReservations = Effect.fn("listReservations")(() =>
    loadAllDotyposPages({
      operation: "listReservations",
      loadPage: (page) =>
        runDotyposRequest(
          client.listReservations(config.cloudId, {
            params: { limit: 100, page },
          }),
          "listReservations"
        ).pipe(
          Effect.catchTag("ExternalAPIError", (error) =>
            page === 1 && error.statusCode === 404
              ? Effect.succeed({ data: [] })
              : Effect.fail(error)
          )
        ),
    }).pipe(
      Effect.retry(retryPolicy),
      catchUnexpectedDotyposError("listReservations")
    )
  );

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
    prepareReservationCreation,
    createPreparedReservation,
    createReservation,
    updateReservation,
    cancelReservation,
    confirmReservation,
    getReservation,
    getReservationStatus,
    getCustomer,
    getCustomerDiscountGroup,
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

import { createHash } from "node:crypto";
