import { Match } from "effect";
import * as Schema from "effect/Schema";
import { DotyposReservationIdSchema, DotyposReservationSchema } from "./types";

/** Every public DotyposService operation. errors.test.ts pins this to keyof IDotyposService. */
export const DotyposOperation = Schema.Literals([
  "createReservation",
  "updateReservation",
  "cancelReservation",
  "setReservationStatusIfMatches",
  "confirmReservation",
  "restoreCancelledReservation",
  "getReservation",
  "getReservationWithoutCustomer",
  "getReservationStatus",
  "getCustomer",
  "getCustomersByIds",
  "getReservationsByIds",
  "listCustomerChanges",
  "createCustomer",
  "patchCustomer",
  "searchCustomers",
  "getCustomerDiscountGroup",
  "getDiscountGroups",
  "setCustomerDiscountGroup",
  "updateCustomerBillingDetails",
  "updateCustomerDetails",
  "updateCustomerProfile",
  "expireCustomer",
  "reactivateCustomer",
  "findCustomer",
  "findOrCreateCustomer",
  "getTables",
  "listReservations",
  "listReservationsPage",
  "listActiveReservationsPage",
  "listActiveReservationsOverlapping",
  "getProducts",
  "getCategories",
]);
export type DotyposOperation = typeof DotyposOperation.Type;

/**
 * The wire request that failed. One operation can make several requests: an
 * ETag read and a PATCH, or a lookup and a create. Diagnostic only. The
 * package's private request profiles are keyed by these names.
 */
export const DotyposRequest = Schema.Literals([
  "reservation.get",
  "reservation.status",
  "reservation.create",
  "reservation.version",
  "reservation.patch",
  "reservation.delete",
  "customer.get",
  "customer.version",
  "customer.patch",
  "customer.fill",
  "customer.create",
  "customer.createAfterLookup",
  "customers.page",
  "customers.changes",
  "customers.search",
  "customers.lookup",
  "discountGroup.get",
  "discountGroups.list",
  "tables.list",
  "reservations.list",
  "reservations.page",
  "products.list",
  "categories.list",
]);
export type DotyposRequest = typeof DotyposRequest.Type;

const DotyposFailureBase = Schema.Struct({
  operation: DotyposOperation,
  /** Absent when the failure came before any request, such as invalid input. */
  request: Schema.optional(DotyposRequest),
  /** Diagnostic only, for logs and support. Code never branches on it. */
  httpStatus: Schema.optional(Schema.Int),
  /** Human detail without personal data or provider bodies. */
  message: Schema.optional(Schema.String),
  /** The original error, without request bodies, credentials or personal data. */
  cause: Schema.optionalKey(Schema.Defect()),
});

/** Dotypos could not serve the request. Nothing was applied, and the package's retries are spent. */
export class DotyposUnavailable extends Schema.TaggedError<DotyposUnavailable>()(
  "DotyposUnavailable",
  {
    ...DotyposFailureBase.fields,
    reason: Schema.Literals([
      "rate-limited",
      "server",
      "transport",
      "timeout",
      "empty-response",
    ]),
  }
) {}

/** Dotypos refused, or answered unusably in a way a retry would repeat. Nothing was applied. */
export class DotyposRejected extends Schema.TaggedError<DotyposRejected>()(
  "DotyposRejected",
  {
    ...DotyposFailureBase.fields,
    reason: Schema.Literals([
      "invalid-request",
      "unauthorized",
      "not-found",
      "invalid-response",
      "ambiguous-match",
    ]),
  }
) {}

/** A write may have been applied. Settle it (reread or reconcile) before acting. Reads never raise it. */
export class DotyposUncertain extends Schema.TaggedError<DotyposUncertain>()(
  "DotyposUncertain",
  {
    ...DotyposFailureBase.fields,
    reason: Schema.Literals([
      "server",
      "transport",
      "timeout",
      "invalid-response",
      "conflict-after-replay",
    ]),
    /** Distinct IDs observed in an ambiguous single-reservation create reply. */
    createdReservationIds: Schema.optional(
      Schema.Array(DotyposReservationIdSchema)
    ),
  }
) {}

/** A conditional (If-Match) write lost to a concurrent change, and no earlier attempt of the call was uncertain. Nothing was applied. */
export class DotyposVersionConflict extends Schema.TaggedError<DotyposVersionConflict>()(
  "DotyposVersionConflict",
  DotyposFailureBase.fields
) {}

/** confirmReservation found the reservation cancelled, so confirmation cannot revive it. Nothing was applied. */
export class DotyposReservationCancelledError extends Schema.TaggedError<DotyposReservationCancelledError>()(
  "DotyposReservationCancelledError",
  { reservationId: DotyposReservationIdSchema, message: Schema.String }
) {}

/** The booking facts restoreCancelledReservation compares with the caller's booking. */
export const DotyposReservationBookingField = Schema.Literals([
  "customer",
  "table",
  "start",
  "end",
  "seats",
]);
export type DotyposReservationBookingField =
  typeof DotyposReservationBookingField.Type;

/**
 * restoreCancelledReservation found a reservation it must not restore, so
 * Dotypos holds something other than the cancelled booking the caller knows.
 * `booking-changed` names the facts that differ from the caller's booking;
 * `not-cancelled` is a matching reservation that is NEW. Nothing was applied.
 */
export class DotyposReservationNotRestorable extends Schema.TaggedError<DotyposReservationNotRestorable>()(
  "DotyposReservationNotRestorable",
  {
    reservationId: DotyposReservationIdSchema,
    reason: Schema.Literals(["booking-changed", "not-cancelled"]),
    status: DotyposReservationSchema.fields.status,
    changedFields: Schema.Array(DotyposReservationBookingField),
    message: Schema.String,
  }
) {}

export type DotyposReadFailure = DotyposUnavailable | DotyposRejected;
export type DotyposWriteFailure = DotyposReadFailure | DotyposUncertain;
export type DotyposConditionalWriteFailure =
  | DotyposWriteFailure
  | DotyposVersionConflict;
export type DotyposFailure =
  | DotyposConditionalWriteFailure
  | DotyposReservationCancelledError
  | DotyposReservationNotRestorable;

/**
 * Stable, low-cardinality machine codes, one per tag. Automation failure codes,
 * metrics and log annotations use these instead of HTTP statuses. `satisfies`
 * makes a new tag without a code a type error.
 */
export const DotyposFailureCode = {
  DotyposUnavailable: "dotypos-unavailable",
  DotyposRejected: "dotypos-rejected",
  DotyposUncertain: "dotypos-uncertain",
  DotyposVersionConflict: "dotypos-version-conflict",
  DotyposReservationCancelledError: "dotypos-reservation-cancelled",
  DotyposReservationNotRestorable: "dotypos-reservation-not-restorable",
} as const satisfies Record<DotyposFailure["_tag"], `dotypos-${string}`>;
export type DotyposFailureCode =
  (typeof DotyposFailureCode)[DotyposFailure["_tag"]];

export const dotyposFailureCode = (
  failure: DotyposFailure
): DotyposFailureCode => DotyposFailureCode[failure._tag];

type DotyposFailureReason =
  | DotyposUnavailable["reason"]
  | DotyposRejected["reason"]
  | DotyposUncertain["reason"]
  | DotyposReservationNotRestorable["reason"];

const providerFailureLogFields = (
  failure: Exclude<
    DotyposFailure,
    DotyposReservationCancelledError | DotyposReservationNotRestorable
  >,
  reason: DotyposFailureReason | undefined
) => ({
  dotyposCode: dotyposFailureCode(failure),
  dotyposReason: reason,
  dotyposOperation: failure.operation,
  dotyposRequest: failure.request,
  dotyposHttpStatus: failure.httpStatus,
});

/**
 * The log fields every Workspace log site attaches to a Dotypos failure. It is
 * the only reader of httpStatus outside the package's request handling, so call
 * sites never touch the status.
 */
export const dotyposFailureLogFields: (failure: DotyposFailure) => {
  readonly dotyposCode: DotyposFailureCode;
  readonly dotyposReason: DotyposFailureReason | undefined;
  readonly dotyposOperation: DotyposOperation;
  readonly dotyposRequest: DotyposRequest | undefined;
  readonly dotyposHttpStatus: number | undefined;
} = Match.type<DotyposFailure>().pipe(
  Match.tagsExhaustive({
    DotyposUnavailable: (failure) =>
      providerFailureLogFields(failure, failure.reason),
    DotyposRejected: (failure) =>
      providerFailureLogFields(failure, failure.reason),
    DotyposUncertain: (failure) =>
      providerFailureLogFields(failure, failure.reason),
    DotyposVersionConflict: (failure) =>
      providerFailureLogFields(failure, undefined),
    DotyposReservationCancelledError: (failure) => ({
      dotyposCode: dotyposFailureCode(failure),
      dotyposReason: undefined,
      dotyposOperation: "confirmReservation" as const,
      dotyposRequest: undefined,
      dotyposHttpStatus: undefined,
    }),
    DotyposReservationNotRestorable: (failure) => ({
      dotyposCode: dotyposFailureCode(failure),
      dotyposReason: failure.reason,
      dotyposOperation: "restoreCancelledReservation" as const,
      dotyposRequest: undefined,
      dotyposHttpStatus: undefined,
    }),
  })
);
