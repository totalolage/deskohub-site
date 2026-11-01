import { Context, Data, Effect, Layer, Match, Option, Schema } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { DotyposRuntimeConfig } from "../config";
import {
  type DotyposConditionalWriteFailure,
  type DotyposOperation,
  type DotyposReadFailure,
  DotyposRejected,
  type DotyposRequest,
  DotyposReservationCancelledError,
  DotyposUnavailable,
  type DotyposWriteFailure,
} from "../errors";
import type {
  CreateCustomerRequest,
  CreateReservationRequest,
  UpdateCustomerRequest,
  UpdateReservationRequest,
} from "../generated/effect.gen";
import { type DotyposTimestamp, formatDotyposTimestamp } from "../timestamp";
import type {
  CreateDotyposReservationInput,
  DotyposCategory,
  DotyposCategoryId,
  DotyposCustomer,
  DotyposCustomerId,
  DotyposDiscountGroup,
  DotyposDiscountGroupId,
  DotyposProduct,
  DotyposReservation,
  DotyposReservationId,
  DotyposReservationInterval,
  DotyposTable,
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
import { toCustomerEmailIdentity } from "../utils/customer-email";
import { normalizePhoneNumber } from "../utils/phone-formatting";
import {
  DotyposAccessToken,
  DotyposGeneratedClient,
  toDotyposWireFailure,
} from "./api";
import {
  classifyWireFailure,
  type DotyposCall,
  dotyposInvalidRequest,
  dotyposInvalidResponse,
  dotyposTimeout,
} from "./failure-classification";
import { type DotyposIdReadOptions, readByIds } from "./id-reads";
import {
  type DotyposAttemptFailure,
  type DotyposRequestFailure,
  retryDotyposRequest,
} from "./request-profiles";

export type ReservationListOptions = {
  readonly customerId?: DotyposCustomerId;
  readonly startsAtOrAfter?: string;
  readonly startsBefore?: string;
  readonly order?: "startDateAscending" | "startDateDescending";
};

export type ReservationPage = {
  readonly reservations: readonly DotyposReservation[];
  readonly nextPage: Option.Option<number>;
};

/**
 * Which customers a change listing reads, by `versionDate`. Dated selections
 * list customers ordered by `versionDate`. A single version date and the
 * undated customers are listed ordered by `created`, from `createdFrom` on
 * when it is set. Dotypos can't sort by `id`, and compares timestamps at
 * microsecond precision.
 */
export type CustomerVersionSelection = Data.TaggedEnum<{
  Dated: Record<never, never>;
  ChangedFrom: { readonly versionDate: DotyposTimestamp };
  ChangedAfter: { readonly versionDate: DotyposTimestamp };
  ChangedAt: {
    readonly versionDate: DotyposTimestamp;
    readonly createdFrom: Option.Option<DotyposTimestamp>;
  };
  Undated: { readonly createdFrom: Option.Option<DotyposTimestamp> };
}>;

export const CustomerVersionSelection =
  Data.taggedEnum<CustomerVersionSelection>();

export type CustomerChangesOptions = {
  readonly selection: CustomerVersionSelection;
};

export type CustomerChanges = {
  /** Customers in the selection's order, deleted ones included. */
  readonly customers: readonly DotyposCustomer[];
  readonly hasMore: boolean;
};

/** Dotypos serves at most this many records per list page. */
export const dotyposMaximumPageSize = 100;

type DotyposPage<A> = {
  readonly data?: readonly A[];
  readonly lastPage?: string;
  readonly nextPage?: string | null;
};

const isNotFound = (failure: DotyposAttemptFailure) =>
  failure._tag === "DotyposRejected" && failure.reason === "not-found";

/**
 * Reads the addressed record as some, or none when Dotypos answers 404 for
 * it. Only the record's own request counts: the access-token request never
 * classifies as not-found, and a nested read of another record names its own
 * request, so their failures still fail.
 */
const noneWhenNotFound =
  (request: "customer.get" | "reservation.get") =>
  <A, E extends DotyposReadFailure, R>(
    effect: Effect.Effect<A, E, R>
  ): Effect.Effect<Option.Option<A>, E, R> =>
    effect.pipe(
      Effect.map(Option.some),
      Effect.catchIf(
        (failure) => isNotFound(failure) && failure.request === request,
        () => Effect.succeed(Option.none<A>())
      )
    );

/**
 * Compatibility: an access-token 404 stays DotyposRejected{unauthorized} but
 * still reads as an empty first list page, as every 404 did before the
 * outcome tags.
 */
const isAccessTokenNotFound = (failure: DotyposAttemptFailure) =>
  failure._tag === "DotyposRejected" &&
  failure.reason === "unauthorized" &&
  failure.httpStatus === 404;

/** Dotypos answers a list page without records with 404. */
const emptyFirstPageWhenNotFound =
  (page: number) =>
  <A, E extends DotyposAttemptFailure, R>(
    effect: Effect.Effect<DotyposPage<A>, E, R>
  ): Effect.Effect<DotyposPage<A>, E, R> =>
    effect.pipe(
      Effect.catchIf(
        (failure) =>
          page === 1 && (isNotFound(failure) || isAccessTokenNotFound(failure)),
        () => Effect.succeed({ data: [] })
      )
    );

const validateReservationInterval = (
  interval: DotyposReservationInterval,
  operation: DotyposOperation
): Effect.Effect<void, DotyposRejected> => {
  const startDate = interval.startDate.getTime();
  const endDate = interval.endDate.getTime();

  if (Number.isNaN(startDate) || Number.isNaN(endDate)) {
    return Effect.fail(
      dotyposInvalidRequest(operation, "Reservation dates must be valid")
    );
  }

  if (endDate <= startDate) {
    return Effect.fail(
      dotyposInvalidRequest(
        operation,
        "Reservation end date must be after start date"
      )
    );
  }

  return Effect.void;
};

const getActiveReservationOverlapFilter = (
  interval: DotyposReservationInterval,
  operation: DotyposOperation
) =>
  validateReservationInterval(interval, operation).pipe(
    Effect.as(
      [
        "status|in|NEW,CONFIRMED",
        `startDate|lt|${interval.endDate.getTime()}`,
        `endDate|gt|${interval.startDate.getTime()}`,
      ].join(";")
    )
  );

const customerVersionQuery = (
  selection: CustomerVersionSelection
): { readonly filters: readonly string[]; readonly sort: string } =>
  Match.valueTags(selection, {
    Dated: () => ({ filters: ["versionDate|eq|notnull"], sort: "versionDate" }),
    ChangedFrom: ({ versionDate }) => ({
      filters: [`versionDate|gteq|${formatDotyposTimestamp(versionDate)}`],
      sort: "versionDate",
    }),
    ChangedAfter: ({ versionDate }) => ({
      filters: [`versionDate|gt|${formatDotyposTimestamp(versionDate)}`],
      sort: "versionDate",
    }),
    ChangedAt: ({ versionDate, createdFrom }) => ({
      filters: [
        `versionDate|eq|${formatDotyposTimestamp(versionDate)}`,
        ...createdFromFilter(createdFrom),
      ],
      sort: "created",
    }),
    Undated: ({ createdFrom }) => ({
      filters: ["versionDate|eq|null", ...createdFromFilter(createdFrom)],
      sort: "created",
    }),
  });

const createdFromFilter = (createdFrom: Option.Option<DotyposTimestamp>) =>
  Option.match(createdFrom, {
    onNone: () => [],
    onSome: (created) => [`created|gteq|${formatDotyposTimestamp(created)}`],
  });

type ReservationListQuery = {
  readonly filter?: string;
  readonly sort?: string;
};

/** The reservation list request's filter and sort. */
const reservationListQuery = (
  options: ReservationListOptions,
  operation: DotyposOperation
): Effect.Effect<ReservationListQuery, DotyposRejected> => {
  const filterValues = [
    options.customerId,
    options.startsAtOrAfter,
    options.startsBefore,
  ].filter((value): value is string => value !== undefined);

  if (filterValues.some((value) => !value.trim() || /[|;]/.test(value))) {
    return Effect.fail(
      dotyposInvalidRequest(
        operation,
        "Reservation filters contain an invalid value"
      )
    );
  }

  const filter = [
    options.customerId && `_customerId|eq|${options.customerId}`,
    options.startsAtOrAfter && `startDate|gteq|${options.startsAtOrAfter}`,
    options.startsBefore && `startDate|lt|${options.startsBefore}`,
  ]
    .filter((value): value is string => Boolean(value))
    .join(";");

  return Effect.succeed({
    ...(filter && { filter }),
    ...(options.order && {
      sort: options.order === "startDateAscending" ? "startDate" : "-startDate",
    }),
  });
};

const singleIdPage = <A>(
  page: DotyposPage<A>,
  call: DotyposCall<"customers.page" | "reservations.page">
) =>
  getNextDotyposPageNumber({
    currentPage: 1,
    nextPage: page.nextPage,
    call,
  }).pipe(
    Effect.filterOrFail(
      (next) =>
        next === undefined &&
        !(page.lastPage !== undefined && Number(page.lastPage) > 1),
      () =>
        dotyposInvalidResponse(call, {
          message: "Dotypos paged an id-filtered read",
        })
    ),
    Effect.as(page.data ?? [])
  );

const validateReservationPageNumber = (
  page: number,
  operation: DotyposOperation
): Effect.Effect<void, DotyposRejected> =>
  Number.isSafeInteger(page) && page >= 1
    ? Effect.void
    : Effect.fail(
        dotyposInvalidRequest(
          operation,
          "Reservation page must be a positive integer"
        )
      );

const getNextDotyposPageNumber = <Request extends DotyposRequest>(input: {
  readonly currentPage: number;
  readonly nextPage: string | null | undefined;
  readonly call: DotyposCall<Request>;
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
        dotyposInvalidResponse(input.call, {
          message: `Dotypos returned an invalid next page: ${input.nextPage}`,
        })
    )
  );

type DotyposPageLoad<A, E, R, Request extends DotyposRequest> = {
  readonly loadPage: (page: number) => Effect.Effect<DotyposPage<A>, E, R>;
  readonly call: DotyposCall<Request>;
};

type DotyposPages<A> = {
  readonly items: readonly A[];
  readonly pageCount: number;
};

const loadDotyposPages = <A, E, R, Request extends DotyposRequest>(
  input: DotyposPageLoad<A, E, R, Request>
): Effect.Effect<DotyposPages<A>, E | DotyposRequestFailure<Request>, R> => {
  const items: A[] = [];
  let currentPage = 1;
  let pageCount = 0;
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
            call: input.call,
          })
        )
      ),
    step: ({ nextPage, page }) => {
      items.push(...(page.data ?? []));
      pageCount += 1;
      hasNextPage = nextPage !== undefined;
      if (nextPage !== undefined) currentPage = nextPage;
    },
  }).pipe(Effect.map(() => ({ items, pageCount })));
};

const loadAllDotyposPages = <A, E, R, Request extends DotyposRequest>(
  input: DotyposPageLoad<A, E, R, Request>
): Effect.Effect<readonly A[], E | DotyposRequestFailure<Request>, R> =>
  loadDotyposPages(input).pipe(Effect.map(({ items }) => items));

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
  Deleted: {
    readonly matches: readonly DotyposCustomer[];
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
    email: customerData.email?.trim() || undefined,
    phone: normalizedPhone || undefined,
  };
};

/**
 * Customers own one mailbox regardless of how its address was cased, so
 * customer identity compares emails case-insensitively. Dotypos' `like`
 * filter is a case-insensitive substring match (`ILIKE '%value%'`), so the
 * provider search returns every case variant and longer addresses that
 * contain the value; only a whole-address match identifies the customer.
 */
const hasCustomerEmail = (customer: DotyposCustomer, email: string) =>
  customer.email != null &&
  toCustomerEmailIdentity(customer.email) === toCustomerEmailIdentity(email);

/** Normalizes an identifier the caller passed, before any request. */
const normalizeInputIdentifier = <A>(
  schema: Schema.Decoder<A>,
  value: string,
  label: string,
  operation: DotyposOperation
) =>
  Schema.decodeUnknownEffect(schema)(value.trim()).pipe(
    Effect.mapError((cause) =>
      dotyposInvalidRequest(operation, `${label} is required`, cause)
    )
  );

/** Decodes an identifier Dotypos returned in the response to `call`. */
const decodeResponseIdentifier = <A, Request extends DotyposRequest>(
  schema: Schema.Decoder<A>,
  value: string,
  label: string,
  call: DotyposCall<Request>
) =>
  Schema.decodeUnknownEffect(schema)(value.trim()).pipe(
    Effect.mapError((cause) =>
      dotyposInvalidResponse(call, { message: `${label} is required`, cause })
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

/** The public patch operations, all of which go through one ETag read and If-Match PATCH. */
type PatchCustomerOperation =
  | "patchCustomer"
  | "setCustomerDiscountGroup"
  | "updateCustomerBillingDetails"
  | "updateCustomerDetails";

export interface IDotyposService {
  // ---- Reads: DotyposReadFailure only ----
  /** None means Dotypos has no such reservation. A reservation whose linked customer is gone fails DotyposRejected{not-found, request: "customer.get"}. */
  readonly getReservation: (id: DotyposReservationId) => Effect.Effect<
    Option.Option<{
      readonly reservation: DotyposReservation;
      readonly customer: DotyposCustomer;
    }>,
    DotyposReadFailure
  >;
  /** A missing reservation fails DotyposRejected{not-found}. */
  readonly getReservationWithoutCustomer: (
    id: DotyposReservationId
  ) => Effect.Effect<DotyposReservation, DotyposReadFailure>;
  /** A missing reservation fails DotyposRejected{not-found}. */
  readonly getReservationStatus: (
    id: DotyposReservationId
  ) => Effect.Effect<DotyposReservation["status"], DotyposReadFailure>;
  /** None means Dotypos has no such customer. */
  readonly getCustomer: (
    id: DotyposCustomerId
  ) => Effect.Effect<Option.Option<DotyposCustomer>, DotyposReadFailure>;
  /** Missing IDs and records without IDs are omitted. Batches never retry or follow paging. */
  readonly getCustomersByIds: (
    ids: Iterable<DotyposCustomerId>,
    options?: DotyposIdReadOptions
  ) => Effect.Effect<
    ReadonlyMap<DotyposCustomerId, DotyposCustomer>,
    DotyposReadFailure
  >;
  readonly getReservationsByIds: (
    ids: Iterable<DotyposReservationId>,
    options?: DotyposIdReadOptions & ReservationListOptions
  ) => Effect.Effect<
    ReadonlyMap<DotyposReservationId, DotyposReservation>,
    DotyposReadFailure
  >;
  readonly listCustomerChanges: (
    options: CustomerChangesOptions
  ) => Effect.Effect<CustomerChanges, DotyposReadFailure>;
  readonly searchCustomers: (
    rawQuery: string
  ) => Effect.Effect<DotyposCustomer[], DotyposReadFailure>;
  readonly findCustomer: (
    customerData: DotyposCustomerLookupData,
    options?: FindCustomerOptions
  ) => Effect.Effect<FindCustomerResult, DotyposReadFailure>;
  readonly getCustomerDiscountGroup: (input: {
    readonly customerId: DotyposCustomerId;
  }) => Effect.Effect<
    DotyposCustomerDiscountGroup | undefined,
    DotyposReadFailure
  >;
  readonly getCustomerDiscount: (
    customer: DotyposCustomer
  ) => Effect.Effect<DotyposCustomerDiscount | undefined, DotyposReadFailure>;
  readonly getDiscountGroups: () => Effect.Effect<
    readonly DotyposDiscountGroup[],
    DotyposReadFailure
  >;
  readonly getTables: () => Effect.Effect<
    readonly DotyposTable[],
    DotyposReadFailure
  >;
  readonly listReservations: (
    options?: ReservationListOptions
  ) => Effect.Effect<readonly DotyposReservation[], DotyposReadFailure>;
  readonly listReservationsPage: (
    options: ReservationListOptions & { readonly page: number }
  ) => Effect.Effect<ReservationPage, DotyposReadFailure>;
  readonly listActiveReservationsPage: (
    interval: DotyposReservationInterval,
    page: number
  ) => Effect.Effect<ReservationPage, DotyposReadFailure>;
  readonly listActiveReservationsOverlapping: (
    interval: DotyposReservationInterval
  ) => Effect.Effect<readonly DotyposReservation[], DotyposReadFailure>;
  readonly getProducts: (options: {
    readonly categoryId?: DotyposCategoryId;
    readonly includeDeleted?: boolean;
  }) => Effect.Effect<readonly DotyposProduct[], DotyposReadFailure>;
  readonly getCategories: () => Effect.Effect<
    DotyposCategory[],
    DotyposReadFailure
  >;

  // ---- Unconditional writes: DotyposWriteFailure ----
  /** Retries only DotyposUnavailable{rate-limited | empty-response}. */
  readonly createReservation: (
    input: CreateDotyposReservationInput
  ) => Effect.Effect<DotyposReservation, DotyposWriteFailure>;
  /** Never retried. */
  readonly createCustomer: (
    details: DotyposCustomerDetails
  ) => Effect.Effect<DotyposCustomer, DotyposWriteFailure>;
  /** A lookup, then either a fill-missing PUT whose failures are swallowed or a create retried like createReservation. */
  readonly findOrCreateCustomer: (
    customerData: DotyposCustomerLookupData,
    options?: FindCustomerOptions
  ) => Effect.Effect<DotyposCustomer, DotyposWriteFailure>;
  /** Never retried. A missing reservation fails DotyposRejected{not-found}. */
  readonly cancelReservation: (
    reservationId: DotyposReservationId
  ) => Effect.Effect<void, DotyposWriteFailure>;

  // ---- Conditional (ETag read, then If-Match PATCH) writes: DotyposConditionalWriteFailure ----
  readonly updateReservation: (
    input: UpdateDotyposReservationInput
  ) => Effect.Effect<DotyposReservation, DotyposConditionalWriteFailure>;
  /** CONFIRMED already: succeeds without a PATCH. CANCELLED: DotyposReservationCancelledError. A vanished reservation: DotyposRejected{not-found}. */
  readonly confirmReservation: (
    reservationId: DotyposReservationId
  ) => Effect.Effect<
    DotyposReservation,
    DotyposConditionalWriteFailure | DotyposReservationCancelledError
  >;
  /** None means the customer does not exist, and nothing was applied. */
  readonly patchCustomer: (
    customerId: DotyposCustomerId,
    payload: UpdateCustomerRequest
  ) => Effect.Effect<
    Option.Option<DotyposCustomer>,
    DotyposConditionalWriteFailure
  >;
  /** The next three patch the customer and fail DotyposRejected{not-found} when it does not exist. */
  readonly setCustomerDiscountGroup: (
    customerId: DotyposCustomerId,
    discountGroupId: DotyposDiscountGroupId | null
  ) => Effect.Effect<DotyposCustomer, DotyposConditionalWriteFailure>;
  readonly updateCustomerBillingDetails: (
    customerId: DotyposCustomerId,
    details: DotyposCustomerBillingDetails
  ) => Effect.Effect<DotyposCustomer, DotyposConditionalWriteFailure>;
  readonly updateCustomerDetails: (
    customerId: DotyposCustomerId,
    details: DotyposCustomerDetails
  ) => Effect.Effect<DotyposCustomer, DotyposConditionalWriteFailure>;
}

const makeDotyposService: Effect.Effect<
  IDotyposService,
  never,
  DotyposRuntimeConfig | DotyposGeneratedClient
> = Effect.gen(function* () {
  const config = yield* DotyposRuntimeConfig;
  const { client } = yield* DotyposGeneratedClient;

  /**
   * Sends one request attempt and classifies its failure by the request's
   * profile. Each attempt has its own timeout.
   */
  const runDotyposRequest = <A, E, Request extends DotyposRequest>(
    effect: Effect.Effect<A, E>,
    call: DotyposCall<Request>
  ): Effect.Effect<A, DotyposRequestFailure<Request>> =>
    effect.pipe(
      Effect.mapError((error) =>
        classifyWireFailure(
          toDotyposWireFailure(error, { fromAccessToken: false }),
          call
        )
      ),
      Effect.timeoutOrElse({
        duration: config.apiTimeout,
        orElse: () => Effect.fail(dotyposTimeout(call)),
      })
    );

  /** A creation answered with an empty array created nothing, so it can be retried. */
  const firstCreated = <A>(items: readonly A[], call: DotyposCall) => {
    const item = items[0];
    return item
      ? Effect.succeed(item)
      : Effect.fail(
          new DotyposUnavailable({
            ...call,
            reason: "empty-response",
            message: "Dotypos returned an empty array.",
          })
        );
  };

  const decodeProviderEntity = <A, Request extends DotyposRequest>(
    schema: Schema.Decoder<A>,
    value: unknown,
    call: DotyposCall<Request>
  ) =>
    Schema.decodeUnknownEffect(schema)(value).pipe(
      Effect.mapError((cause) =>
        dotyposInvalidResponse(call, {
          message: "Dotypos returned malformed entity identifiers.",
          cause,
        })
      )
    );

  const decodeProviderEntities = <A, Request extends DotyposRequest>(
    schema: Schema.Decoder<A>,
    values: readonly unknown[],
    call: DotyposCall<Request>
  ) =>
    Effect.forEach(values, (value) =>
      decodeProviderEntity(schema, value, call)
    );

  const decodeProviderPage = <A, Request extends DotyposRequest>(
    schema: Schema.Decoder<A>,
    page: DotyposPage<unknown>,
    call: DotyposCall<Request>
  ): Effect.Effect<DotyposPage<A>, DotyposRequestFailure<Request>> => {
    if (!Array.isArray(page.data)) {
      return Effect.fail(
        dotyposInvalidResponse(call, {
          message: "Dotypos returned a malformed list response.",
        })
      );
    }

    return decodeProviderEntities(schema, page.data, call).pipe(
      Effect.map((data) => ({ ...page, data }))
    );
  };

  const readReservationRecord = Effect.fn("getReservationWithoutCustomer")(
    function* (id: DotyposReservationId, operation: DotyposOperation) {
      const reservationId = yield* normalizeInputIdentifier(
        DotyposReservationIdSchema,
        id,
        "Reservation ID",
        operation
      );
      const call = { operation, request: "reservation.get" } as const;
      const reservationResult = yield* runDotyposRequest(
        client.getReservation(config.cloudId, reservationId, undefined),
        call
      ).pipe(retryDotyposRequest(call.request));

      return yield* decodeProviderEntity(
        DotyposReservationSchema,
        { ...reservationResult, id: reservationId },
        call
      );
    },
    (effect, reservationId) =>
      effect.pipe(
        Effect.annotateLogs({
          reservationId,
        })
      )
  );

  const getReservationWithoutCustomer = (id: DotyposReservationId) =>
    readReservationRecord(id, "getReservationWithoutCustomer");

  const readReservation = Effect.fn("getReservation")(
    function* (id: DotyposReservationId) {
      const reservationCall = {
        operation: "getReservation",
        request: "reservation.get",
      } as const;
      const reservation = yield* readReservationRecord(
        id,
        reservationCall.operation
      );

      if (!reservation._customerId) {
        return yield* dotyposInvalidResponse(reservationCall, {
          message: `Reservation ${reservation.id} has no customer ID`,
        });
      }

      const customerId = yield* decodeResponseIdentifier(
        DotyposCustomerIdSchema,
        reservation._customerId,
        "Customer ID",
        reservationCall
      );
      const customerCall = {
        operation: "getReservation",
        request: "customer.get",
      } as const;
      const customerResult = yield* readCustomer(
        customerId,
        customerCall.operation
      );
      const customer = yield* decodeProviderEntity(
        DotyposCustomerSchema,
        { ...customerResult, id: customerId },
        customerCall
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
      const reservationId = yield* normalizeInputIdentifier(
        DotyposReservationIdSchema,
        id,
        "Reservation ID",
        "getReservationStatus"
      );

      const reservation = yield* runDotyposRequest(
        client.getReservation(config.cloudId, reservationId, undefined),
        { operation: "getReservationStatus", request: "reservation.status" }
      ).pipe(retryDotyposRequest("reservation.status"));

      return reservation.status;
    },
    (effect, reservationId) =>
      effect.pipe(Effect.annotateLogs({ reservationId }))
  );

  const createReservation = Effect.fn("createReservation")(
    function* (input: CreateDotyposReservationInput) {
      yield* Effect.annotateLogsScoped({ input });
      yield* Effect.logInfo("Dotypos reservation request build started");

      const customerId = yield* normalizeInputIdentifier(
        DotyposCustomerIdSchema,
        input.customerId,
        "Customer ID",
        "createReservation"
      );
      const tableId = yield* normalizeInputIdentifier(
        DotyposTableIdSchema,
        input.tableId,
        "Table ID",
        "createReservation"
      );

      if (!Number.isInteger(input.seats) || input.seats <= 0) {
        return yield* dotyposInvalidRequest(
          "createReservation",
          "Reservation seats must be a positive integer"
        );
      }

      yield* validateReservationInterval(input, "createReservation");

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

      const call = {
        operation: "createReservation",
        request: "reservation.create",
      } as const;
      const reservationResult = yield* runDotyposRequest(
        client.createReservation(config.cloudId, { payload: [request] }),
        call
      ).pipe(
        Effect.flatMap((reservations) => firstCreated(reservations, call)),
        Effect.withSpan("dotyposService.createReservation"),
        retryDotyposRequest(call.request),
        Effect.tapError((error) =>
          Effect.logError("Dotypos reservation creation failed", {
            error,
          })
        )
      );

      const reservationId = yield* decodeResponseIdentifier(
        DotyposReservationIdSchema,
        reservationResult.id ?? "",
        "Reservation ID",
        call
      );
      const reservation = yield* decodeProviderEntity(
        DotyposReservationSchema,
        { ...reservationResult, id: reservationId },
        call
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
      const id = yield* normalizeInputIdentifier(
        DotyposReservationIdSchema,
        reservationId,
        "Reservation ID",
        "cancelReservation"
      );

      yield* Effect.logInfo("Dotypos reservation cancellation started");

      const call = {
        operation: "cancelReservation",
        request: "reservation.delete",
      } as const;
      yield* runDotyposRequest(
        client.cancelReservation(config.cloudId, id, undefined),
        call
      ).pipe(
        retryDotyposRequest(call.request),
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

  const readReservationVersion = Effect.fn(
    "DotyposService.readReservationVersion"
  )(
    (
      reservationId: DotyposReservationId,
      operation: "confirmReservation" | "updateReservation"
    ) => {
      const call = { operation, request: "reservation.version" } as const;
      return runDotyposRequest(
        client.getReservation(config.cloudId, reservationId, {
          config: { includeResponse: true },
        }),
        call
      ).pipe(
        retryDotyposRequest(call.request),
        Effect.flatMap(([reservation, response]) => {
          const etag = response.headers.etag ?? response.headers.ETag;

          if (!etag) {
            return Effect.fail(
              dotyposInvalidResponse(call, {
                message: "Reservation ETag header was missing.",
              })
            );
          }

          return decodeProviderEntity(
            DotyposReservationSchema,
            { ...reservation, id: reservation.id ?? reservationId },
            call
          ).pipe(Effect.map((decoded) => ({ etag, reservation: decoded })));
        })
      );
    }
  );

  const patchReservationVersion = Effect.fn(
    "DotyposService.patchReservationVersion"
  )(
    (input: {
      readonly reservationId: DotyposReservationId;
      readonly etag: string;
      readonly payload: UpdateReservationRequest;
      readonly operation: "confirmReservation" | "updateReservation";
    }) => {
      const call = {
        operation: input.operation,
        request: "reservation.patch",
      } as const;
      return runDotyposRequest(
        client.patchReservation(config.cloudId, input.reservationId, {
          params: { "If-Match": input.etag },
          payload: input.payload,
        }),
        call
      ).pipe(
        retryDotyposRequest(call.request),
        Effect.flatMap((reservation) =>
          decodeProviderEntity(
            DotyposReservationSchema,
            { ...reservation, id: reservation.id ?? input.reservationId },
            call
          )
        )
      );
    }
  );

  const confirmReservation = Effect.fn("confirmReservation")(
    function* (reservationId: DotyposReservationId) {
      const id = yield* normalizeInputIdentifier(
        DotyposReservationIdSchema,
        reservationId,
        "Reservation ID",
        "confirmReservation"
      );

      yield* Effect.logInfo("Dotypos reservation confirmation patch started");

      // The If-Match ETag makes the status check and the PATCH one atomic
      // transition: a cancellation after this read fails the PATCH instead of
      // being overwritten, so a cancelled hold is never revived.
      const reservation = yield* readReservationVersion(
        id,
        "confirmReservation"
      ).pipe(
        Effect.flatMap((current) =>
          Match.value(current.reservation.status).pipe(
            Match.when("CANCELLED", () =>
              Effect.fail(
                new DotyposReservationCancelledError({
                  reservationId: id,
                  message: "Dotypos reservation is already cancelled.",
                })
              )
            ),
            Match.when("CONFIRMED", () => Effect.succeed(current.reservation)),
            Match.when("NEW", () =>
              patchReservationVersion({
                reservationId: id,
                etag: current.etag,
                payload: { status: "CONFIRMED" },
                operation: "confirmReservation",
              })
            ),
            Match.exhaustive
          )
        ),
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
      const reservationId = yield* normalizeInputIdentifier(
        DotyposReservationIdSchema,
        input.reservationId,
        "Reservation ID",
        "updateReservation"
      );
      const note = input.note.trim();

      if (!note) {
        return yield* dotyposInvalidRequest(
          "updateReservation",
          "Reservation note is required"
        );
      }

      yield* Effect.logInfo("Dotypos reservation update started");

      const reservation = yield* readReservationVersion(
        reservationId,
        "updateReservation"
      ).pipe(
        Effect.flatMap((current) =>
          patchReservationVersion({
            reservationId,
            etag: current.etag,
            payload: { note },
            operation: "updateReservation",
          })
        ),
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

  const readCustomer = Effect.fn("getCustomer")(
    function* (id: DotyposCustomerId, operation: DotyposOperation) {
      const call = { operation, request: "customer.get" } as const;
      const customer = yield* runDotyposRequest(
        client.getCustomer(config.cloudId, id, undefined),
        call
      ).pipe(retryDotyposRequest(call.request));
      return yield* decodeProviderEntity(
        DotyposCustomerSchema,
        { ...customer, id: customer.id ?? id },
        call
      );
    },
    (effect, customerId) =>
      effect.pipe(
        Effect.annotateLogs({
          customerId,
        })
      )
  );

  /** A missing linked customer still fails the reservation read. */
  const getReservation = (id: DotyposReservationId) =>
    readReservation(id).pipe(noneWhenNotFound("reservation.get"));

  const getCustomer = (id: DotyposCustomerId) =>
    readCustomer(id, "getCustomer").pipe(noneWhenNotFound("customer.get"));

  const getCustomersByIds = Effect.fn("getCustomersByIds")(
    (ids: Iterable<DotyposCustomerId>, options?: DotyposIdReadOptions) =>
      readByIds(
        ids,
        "getCustomersByIds",
        (batch) => {
          const call = {
            operation: "getCustomersByIds",
            request: "customers.page",
          } as const;
          return runDotyposRequest(
            client.getCustomers(config.cloudId, {
              params: {
                filter: `id|in|${batch.join(",")};deleted|in|0,1`,
                limit: dotyposMaximumPageSize,
                page: 1,
              },
            }),
            call
          ).pipe(
            emptyFirstPageWhenNotFound(1),
            Effect.flatMap((result) =>
              decodeProviderPage(DotyposCustomerSchema, result, call)
            ),
            Effect.flatMap((page) => singleIdPage(page, call))
          );
        },
        options
      )
  );

  const getReservationsByIds = Effect.fn("getReservationsByIds")(
    (
      ids: Iterable<DotyposReservationId>,
      options: DotyposIdReadOptions & ReservationListOptions = {}
    ) =>
      readByIds(
        ids,
        "getReservationsByIds",
        (batch) => {
          const call = {
            operation: "getReservationsByIds",
            request: "reservations.page",
          } as const;
          return reservationListQuery(options, call.operation).pipe(
            Effect.flatMap((query) =>
              readReservationPage({
                query: {
                  ...query,
                  filter: [`id|in|${batch.join(",")}`, query.filter]
                    .filter(Boolean)
                    .join(";"),
                },
                page: 1,
                call,
              })
            ),
            Effect.flatMap((page) => singleIdPage(page, call))
          );
        },
        options
      )
  );

  /**
   * Reads the first page of customer changes for an incremental export; the
   * caller moves through the changes by narrowing the selection, never by
   * page number. It sends exactly one list request and never retries it, so
   * every call costs one request against the Dotypos rate limit and the
   * caller decides when to try again.
   */
  const listCustomerChanges = (options: CustomerChangesOptions) =>
    Effect.succeed(options).pipe(
      Effect.let("query", ({ selection }) => customerVersionQuery(selection)),
      Effect.bind("result", readCustomerChangePage),
      Effect.bind("nextPage", ({ result }) =>
        getNextDotyposPageNumber({
          currentPage: 1,
          nextPage: result.nextPage,
          call: customerChangesCall,
        })
      ),
      Effect.map(
        ({ result, nextPage }): CustomerChanges => ({
          customers: result.data ?? [],
          hasMore: nextPage !== undefined,
        })
      ),
      Effect.withSpan("listCustomerChanges")
    );

  const customerChangesCall = {
    operation: "listCustomerChanges",
    request: "customers.changes",
  } as const;

  const readCustomerChangePage = (input: {
    readonly query: ReturnType<typeof customerVersionQuery>;
  }) =>
    runDotyposRequest(
      client.getCustomers(config.cloudId, {
        params: {
          filter: ["deleted|in|0,1", ...input.query.filters].join(";"),
          sort: input.query.sort,
          limit: dotyposMaximumPageSize,
          page: 1,
        },
      }),
      customerChangesCall
    ).pipe(
      emptyFirstPageWhenNotFound(1),
      Effect.flatMap((result) =>
        decodeProviderPage(DotyposCustomerSchema, result, customerChangesCall)
      ),
      retryDotyposRequest(customerChangesCall.request)
    );

  const searchCustomers = Effect.fn("searchCustomers")(function* (
    rawQuery: string
  ) {
    const query = rawQuery.trim();
    if (query.length < 2 || query.length > 100 || /[|;]/.test(query)) {
      return yield* dotyposInvalidRequest(
        "searchCustomers",
        "Customer search query is invalid"
      );
    }
    const call = {
      operation: "searchCustomers",
      request: "customers.search",
    } as const;

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
                call
              ).pipe(
                emptyFirstPageWhenNotFound(page),
                Effect.flatMap((result) =>
                  decodeProviderPage(DotyposCustomerSchema, result, call)
                )
              ),
            call,
          }).pipe(retryDotyposRequest(call.request))
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
      options: FindCustomerOptions | undefined,
      operation: "findCustomer" | "findOrCreateCustomer"
    ) {
      const normalizedCustomerData = normalizeCustomerLookupData(customerData);
      const call = { operation, request: "customers.lookup" } as const;

      const searchByField = (fieldName: "email" | "phone", value: string) =>
        Effect.gen(function* () {
          const valueSanitized = value.replace("|", encodeURIComponent("|"));
          const filter = [
            `${fieldName}|like|${valueSanitized}`,
            "deleted|in|0,1",
          ].join(";");

          return yield* loadAllDotyposPages({
            loadPage: (page) =>
              runDotyposRequest(
                client.getCustomers(config.cloudId, {
                  params: { limit: 100, page, filter },
                }),
                call
              ).pipe(
                emptyFirstPageWhenNotFound(page),
                Effect.flatMap((result) =>
                  decodeProviderPage(DotyposCustomerSchema, result, call)
                )
              ),
            call,
          }).pipe(retryDotyposRequest(call.request));
        });

      const lookupFields = options?.lookupFields ?? defaultCustomerLookupFields;
      const shouldLookupBy = (field: CustomerLookupField) =>
        lookupFields.includes(field);

      const matchingCustomers: DotyposCustomer[] = [];

      if (shouldLookupBy("email") && normalizedCustomerData.email) {
        const email = normalizedCustomerData.email;
        // The provider filter is already case-insensitive; send the address as
        // entered so its collation, not JavaScript case mapping, folds case.
        const customersByEmail = yield* searchByField("email", email);
        for (const customer of customersByEmail) {
          if (hasCustomerEmail(customer, email)) {
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
        return matchingCustomers.length > 0
          ? {
              _tag: "Deleted" as const,
              matches: matchingCustomers,
              normalizedCustomerData,
            }
          : {
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
        options,
        "findCustomer"
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
        Match.tag("Deleted", (deleted) =>
          FindCustomerResult.Deleted({ matches: deleted.matches })
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
        return yield* dotyposInvalidRequest(
          "createCustomer",
          "Customer email is required"
        );
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
        // Dotypos requires a phone on creation; a new customer has no stored
        // phone to preserve, so an absent or unparseable phone stays blank.
        phone: normalizePhoneNumber(details.phone) ?? "",
        points: "0",
        tags: [],
        vatId: details.vatId.trim(),
        zip: details.zip.trim(),
      };

      const call = {
        operation: "createCustomer",
        request: "customer.create",
      } as const;
      const result = yield* runDotyposRequest(
        client.createCustomers(config.cloudId, { payload: [request] }),
        call
      ).pipe(
        Effect.flatMap((customers) => firstCreated(customers, call)),
        retryDotyposRequest(call.request)
      );

      return yield* decodeProviderEntity(DotyposCustomerSchema, result, call);
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

      const lookup = yield* lookupCustomer(
        customerData,
        options,
        "findOrCreateCustomer"
      );

      yield* Effect.logDebug("Dotypos customer lookup result", {
        outcome: lookup._tag,
        matchedCustomerIds: lookup.matches.map((customer) => customer.id),
      });

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

            return yield* new DotyposRejected({
              operation: "findOrCreateCustomer",
              request: "customers.lookup",
              reason: "ambiguous-match",
              message: "Dotypos customer lookup matched multiple customers",
            });
          })
        ),
        Match.tag("Matched", (matchedLookup) =>
          Effect.succeed(matchedLookup.matches[0])
        ),
        Match.tag("NotFound", () => Effect.as(Effect.void, undefined)),
        // Deleted profiles never served active lookups before; keep creating
        // a fresh customer so existing findOrCreate callers stay compatible.
        Match.tag("Deleted", () => Effect.as(Effect.void, undefined)),
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
          customerId: existingCustomer.id,
        });

        if (needsUpdate) {
          const customerId = existingCustomer.id;
          if (!customerId) {
            return yield* dotyposInvalidResponse(
              {
                operation: "findOrCreateCustomer",
                request: "customers.lookup",
              },
              { message: "Cannot update Dotypos customer without id" }
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

          const fillCall = {
            operation: "findOrCreateCustomer",
            request: "customer.fill",
          } as const;
          const updatedCustomer = yield* runDotyposRequest(
            client.updateCustomer(config.cloudId, customerId, {
              payload: updateRequest,
            }),
            fillCall
          ).pipe(
            retryDotyposRequest(fillCall.request),
            Effect.flatMap((customer) =>
              decodeProviderEntity(
                DotyposCustomerSchema,
                { ...customer, id: customer.id ?? customerId },
                fillCall
              )
            ),
            Effect.tapError((error) =>
              Effect.logWarning("Dotypos customer update failed", {
                errorTag: error._tag,
                operation: "updateCustomer",
                customerId,
                updatedFields: Object.keys(updateRequest),
              })
            ),
            Effect.orElseSucceed(() => existingCustomer)
          );

          yield* Effect.logDebug("Dotypos existing customer result", {
            customerId: updatedCustomer.id,
          });

          return updatedCustomer;
        }

        yield* Effect.logDebug("Dotypos existing customer result", {
          customerId: existingCustomer.id,
        });

        return existingCustomer;
      }

      if (!normalizedCustomerData.email) {
        return yield* dotyposInvalidRequest(
          "findOrCreateCustomer",
          "Customer email is required"
        );
      }

      if (!normalizedCustomerData.phone) {
        return yield* dotyposInvalidRequest(
          "findOrCreateCustomer",
          "Customer phone is required"
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

      const createCall = {
        operation: "findOrCreateCustomer",
        request: "customer.createAfterLookup",
      } as const;
      const customerResult = yield* runDotyposRequest(
        client.createCustomers(config.cloudId, { payload: [createRequest] }),
        createCall
      ).pipe(
        Effect.flatMap((customers) => firstCreated(customers, createCall)),
        retryDotyposRequest(createCall.request),
        Effect.tapError((error) =>
          Effect.logError("Dotypos customer creation failed", {
            errorTag: error._tag,
            operation: "createCustomer",
            // A failure Dotypos answered with a status keeps its parsed error body as the cause.
            providerError:
              error.httpStatus === undefined ? undefined : error.cause,
            statusCode: error.httpStatus,
            createCustomerRequestFields,
          })
        )
      );

      const customer = yield* decodeProviderEntity(
        DotyposCustomerSchema,
        customerResult,
        createCall
      );

      yield* Effect.logInfo("Dotypos customer created", {
        customerId: customer.id,
      });

      return customer;
    },
    (effect, _input, options) =>
      effect.pipe(
        Effect.annotateLogs(getCustomerLookupLogAnnotations(options)),
        Effect.scoped
      )
  );

  const loadCustomerDiscountGroup = (
    customer: DotyposCustomer,
    operation: "getCustomerDiscountGroup" | "getCustomerDiscount"
  ) =>
    Effect.gen(function* () {
      const rawDiscountGroupId = customer._discountGroupId?.toString().trim();
      if (!rawDiscountGroupId) return undefined;

      const call = { operation, request: "discountGroup.get" } as const;
      const discountGroupId = yield* decodeResponseIdentifier(
        DotyposDiscountGroupIdSchema,
        rawDiscountGroupId,
        "Discount group ID",
        call
      );

      return yield* runDotyposRequest(
        client.getDiscountGroup(config.cloudId, discountGroupId, undefined),
        call
      ).pipe(
        retryDotyposRequest(call.request),
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
          normalizeInputIdentifier(
            DotyposCustomerIdSchema,
            customerId,
            "Customer ID",
            "getCustomerDiscountGroup"
          )
        ),
        Effect.bind("customer", ({ normalizedCustomerId }) =>
          readCustomer(normalizedCustomerId, "getCustomerDiscountGroup")
        ),
        Effect.bind("discountGroup", ({ customer }) =>
          loadCustomerDiscountGroup(customer, "getCustomerDiscountGroup")
        ),
        Effect.map(({ discountGroup }) => discountGroup)
      ),
    (effect, input) =>
      effect.pipe(Effect.annotateLogs({ customerId: input.customerId }))
  );

  const getCustomerDiscount = Effect.fn("getCustomerDiscount")(
    function* (customer: DotyposCustomer) {
      const discountGroup = yield* loadCustomerDiscountGroup(
        customer,
        "getCustomerDiscount"
      );
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

  const discountGroupsCall = {
    operation: "getDiscountGroups",
    request: "discountGroups.list",
  } as const;

  const getDiscountGroups = Effect.fn("DotyposService.getDiscountGroups")(() =>
    loadAllDotyposPages({
      loadPage: (page) =>
        runDotyposRequest(
          client.getDiscountGroups(config.cloudId, {
            params: { limit: 100, page },
          }),
          discountGroupsCall
        ).pipe(
          emptyFirstPageWhenNotFound(page),
          Effect.flatMap((result) =>
            decodeProviderPage(
              DotyposDiscountGroupSchema,
              result,
              discountGroupsCall
            )
          )
        ),
      call: discountGroupsCall,
    }).pipe(retryDotyposRequest(discountGroupsCall.request))
  );

  /**
   * Reads the customer's ETag, then sends an If-Match PATCH that the package
   * replays on transient failures. A missing customer fails
   * DotyposRejected{not-found}, and nothing was applied.
   */
  const updateCustomerVersion = Effect.fn("DotyposService.patchCustomer")(
    function* (
      customerId: DotyposCustomerId,
      payload: UpdateCustomerRequest,
      operation: PatchCustomerOperation
    ) {
      const normalizedCustomerId = yield* normalizeInputIdentifier(
        DotyposCustomerIdSchema,
        customerId,
        "Customer ID",
        operation
      );

      const versionCall = { operation, request: "customer.version" } as const;
      const [, response] = yield* runDotyposRequest(
        client.getCustomer(config.cloudId, normalizedCustomerId, {
          config: { includeResponse: true },
        }),
        versionCall
      ).pipe(retryDotyposRequest(versionCall.request));
      const etag = response.headers.etag ?? response.headers.ETag;
      if (!etag) {
        return yield* dotyposInvalidResponse(versionCall, {
          message: "Customer ETag header was missing.",
        });
      }

      const patchCall = { operation, request: "customer.patch" } as const;
      const customer = yield* runDotyposRequest(
        client.patchCustomer(config.cloudId, normalizedCustomerId, {
          params: { "If-Match": etag },
          payload,
        }),
        patchCall
      ).pipe(retryDotyposRequest(patchCall.request));
      return yield* decodeProviderEntity(
        DotyposCustomerSchema,
        { ...customer, id: customer.id ?? normalizedCustomerId },
        patchCall
      );
    }
  );

  /**
   * None means the ETag read or a first PATCH answered 404. After an
   * uncertain attempt the failure is DotyposUncertain, so it never reads as
   * none.
   */
  const patchCustomer = (
    customerId: DotyposCustomerId,
    payload: UpdateCustomerRequest
  ) =>
    updateCustomerVersion(customerId, payload, "patchCustomer").pipe(
      Effect.map(Option.some),
      Effect.catchIf(isNotFound, () =>
        Effect.succeed(Option.none<DotyposCustomer>())
      )
    );

  const setCustomerDiscountGroup = Effect.fn(
    "DotyposService.setCustomerDiscountGroup"
  )(function* (
    customerId: DotyposCustomerId,
    discountGroupId: DotyposDiscountGroupId | null
  ) {
    const normalizedDiscountGroupId = discountGroupId
      ? yield* normalizeInputIdentifier(
          DotyposDiscountGroupIdSchema,
          discountGroupId,
          "Discount group ID",
          "setCustomerDiscountGroup"
        )
      : null;

    return yield* updateCustomerVersion(
      customerId,
      { _discountGroupId: normalizedDiscountGroupId },
      "setCustomerDiscountGroup"
    );
  });

  const updateCustomerBillingDetails = Effect.fn(
    "DotyposService.updateCustomerBillingDetails"
  )((customerId: DotyposCustomerId, details: DotyposCustomerBillingDetails) =>
    updateCustomerVersion(customerId, details, "updateCustomerBillingDetails")
  );

  /**
   * An absent or unparseable phone omits the field so the phone stored in
   * Dotypos stays untouched; clearing it requires an explicit provider patch.
   */
  const updateCustomerDetails = Effect.fn(
    "DotyposService.updateCustomerDetails"
  )((customerId: DotyposCustomerId, details: DotyposCustomerDetails) => {
    const phone = normalizePhoneNumber(details.phone);
    return updateCustomerVersion(
      customerId,
      {
        addressLine1: details.addressLine1.trim(),
        addressLine2: details.addressLine2.trim(),
        city: details.city.trim(),
        companyId: details.companyId.trim(),
        companyName: details.companyName.trim(),
        country: details.country.trim(),
        email: details.email.trim(),
        firstName: details.firstName.trim(),
        lastName: details.lastName.trim(),
        ...(phone && { phone }),
        vatId: details.vatId.trim(),
        zip: details.zip.trim(),
      },
      "updateCustomerDetails"
    );
  });

  const getTables = Effect.fn("getTables")(
    function* () {
      yield* Effect.logInfo("Dotypos tables load started");

      const call = { operation: "getTables", request: "tables.list" } as const;
      const { items: tables, pageCount } = yield* loadDotyposPages({
        call,
        loadPage: (page) =>
          runDotyposRequest(
            client.getTables(config.cloudId, {
              params: { limit: 100, page },
            }),
            call
          ).pipe(
            Effect.flatMap((result) =>
              decodeProviderPage(DotyposTableSchema, result, call)
            )
          ),
      }).pipe(retryDotyposRequest(call.request));

      yield* Effect.annotateLogsScoped({
        tableCount: tables.length,
        pageCount,
      });
      yield* Effect.logInfo("Dotypos tables load completed");
      return tables;
    },
    (effect) =>
      effect.pipe(
        Effect.scoped,
        Effect.tapError((error) =>
          Effect.logError("Dotypos tables load failed", { error })
        )
      )
  );

  const readReservationPage = <Request extends DotyposRequest>(input: {
    readonly query: ReservationListQuery;
    readonly page: number;
    readonly call: DotyposCall<Request>;
  }) =>
    runDotyposRequest(
      client.listReservations(config.cloudId, {
        params: {
          limit: dotyposMaximumPageSize,
          page: input.page,
          ...(input.query.filter && { filter: input.query.filter }),
          ...(input.query.sort && { sort: input.query.sort }),
        },
      }),
      input.call
    ).pipe(
      emptyFirstPageWhenNotFound(input.page),
      Effect.flatMap((result) =>
        decodeProviderPage(DotyposReservationSchema, result, input.call)
      )
    );

  const loadReservations = (
    query: ReservationListQuery,
    operation: "listReservations" | "listActiveReservationsOverlapping"
  ) => {
    const call = { operation, request: "reservations.list" } as const;
    return loadDotyposPages({
      call,
      loadPage: (page) => readReservationPage({ query, page, call }),
    }).pipe(retryDotyposRequest(call.request));
  };

  const listReservations = Effect.fn("listReservations")(function* (
    options: ReservationListOptions = {}
  ) {
    const query = yield* reservationListQuery(options, "listReservations");
    const { items: reservations } = yield* loadReservations(
      query,
      "listReservations"
    );
    return reservations;
  });

  /**
   * Reads one page of reservations. It sends exactly one list request and
   * never retries it, so every call costs one request against the Dotypos
   * rate limit and the caller decides when to try again.
   */
  const listReservationsPage = Effect.fn("listReservationsPage")(function* (
    options: ReservationListOptions & { readonly page: number }
  ) {
    yield* validateReservationPageNumber(options.page, "listReservationsPage");
    const query = yield* reservationListQuery(options, "listReservationsPage");
    return yield* readSingleReservationPage({
      query,
      page: options.page,
      operation: "listReservationsPage",
    });
  });

  /**
   * Reads one page of the reservations still `NEW` or `CONFIRMED` that
   * overlap the interval. Like {@link listReservationsPage}, it sends exactly
   * one list request and never retries it.
   */
  const listActiveReservationsPage = Effect.fn("listActiveReservationsPage")(
    function* (interval: DotyposReservationInterval, page: number) {
      yield* validateReservationPageNumber(page, "listActiveReservationsPage");
      const filter = yield* getActiveReservationOverlapFilter(
        interval,
        "listActiveReservationsPage"
      );
      return yield* readSingleReservationPage({
        query: { filter },
        page,
        operation: "listActiveReservationsPage",
      });
    }
  );

  const readSingleReservationPage = (input: {
    readonly query: ReservationListQuery;
    readonly page: number;
    readonly operation: "listReservationsPage" | "listActiveReservationsPage";
  }) => {
    const call = {
      operation: input.operation,
      request: "reservations.page",
    } as const;
    return readReservationPage({
      query: input.query,
      page: input.page,
      call,
    }).pipe(
      retryDotyposRequest(call.request),
      Effect.flatMap((result) =>
        getNextDotyposPageNumber({
          currentPage: input.page,
          nextPage: result.nextPage,
          call,
        }).pipe(
          Effect.map(
            (nextPage): ReservationPage => ({
              reservations: result.data ?? [],
              nextPage: Option.fromUndefinedOr(nextPage),
            })
          )
        )
      )
    );
  };

  const listActiveReservationsOverlapping = Effect.fn(
    "listActiveReservationsOverlapping"
  )(
    function* (interval: DotyposReservationInterval) {
      yield* Effect.logInfo("Dotypos active reservations load started");

      const filter = yield* getActiveReservationOverlapFilter(
        interval,
        "listActiveReservationsOverlapping"
      );
      const { items: reservations, pageCount } = yield* loadReservations(
        { filter },
        "listActiveReservationsOverlapping"
      );

      yield* Effect.annotateLogsScoped({
        reservationCount: reservations.length,
        pageCount,
      });
      yield* Effect.logInfo("Dotypos active reservations load completed");
      return reservations;
    },
    (effect) =>
      effect.pipe(
        Effect.scoped,
        Effect.tapError((error) =>
          Effect.logError("Dotypos active reservations load failed", { error })
        )
      )
  );

  const getProducts = Effect.fn("getProducts")(function* (options: {
    categoryId?: DotyposCategoryId;
    includeDeleted?: boolean;
  }) {
    const call = {
      operation: "getProducts",
      request: "products.list",
    } as const;
    return yield* loadAllDotyposPages({
      call,
      loadPage: (page) =>
        runDotyposRequest(
          client.getProducts(config.cloudId, {
            params: {
              limit: 100,
              page,
              ...(options?.categoryId && {
                filter: `_categoryId|eq|${options.categoryId}`,
              }),
            },
          }),
          call
        ),
    }).pipe(
      Effect.flatMap((products) =>
        decodeProviderEntities(DotyposProductSchema, products, call)
      ),
      Effect.map((products: readonly DotyposProduct[]) =>
        options?.includeDeleted
          ? products
          : products.filter((product) => !product.deleted)
      ),
      retryDotyposRequest(call.request)
    );
  });

  const getCategories = Effect.fn("getCategories")(function* () {
    const call = {
      operation: "getCategories",
      request: "categories.list",
    } as const;
    const categories = yield* loadAllDotyposPages({
      call,
      loadPage: (page) =>
        runDotyposRequest(
          client.getCategories(config.cloudId, {
            params: { limit: 100, page },
          }),
          call
        ),
    }).pipe(retryDotyposRequest(call.request));
    return yield* decodeProviderEntities(
      DotyposCategorySchema,
      categories,
      call
    );
  });

  return {
    createReservation,
    updateReservation,
    cancelReservation,
    confirmReservation,
    getReservation,
    getReservationWithoutCustomer,
    getReservationStatus,
    getCustomer,
    getCustomersByIds,
    getReservationsByIds,
    listCustomerChanges,
    createCustomer,
    patchCustomer,
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
    listReservationsPage,
    listActiveReservationsPage,
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
  IDotyposService
>()("DotyposService") {
  static Default = Layer.effect(this, makeDotyposService);

  static Live = this.Default.pipe(
    Layer.provide(DotyposGeneratedClient.Default),
    Layer.provide(DotyposAccessToken.Default),
    Layer.provide(FetchHttpClient.layer)
  );
}
