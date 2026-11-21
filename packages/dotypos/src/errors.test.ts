import { expect, test } from "bun:test";
import { type Effect, Schema } from "effect";
import type { IDotyposService } from "./backend/service";
import {
  type DotyposFailure,
  type DotyposOperation,
  type DotyposReadFailure,
  DotyposRejected,
  DotyposReservationCancelledError,
  DotyposReservationNotRestorable,
  DotyposUnavailable,
  DotyposUncertain,
  DotyposVersionConflict,
  type DotyposWriteFailure,
  dotyposFailureCode,
} from "./errors";
import { DotyposReservationIdSchema } from "./types";

type Expect<T extends true> = T;
type Equal<X, Y> =
  (<T>() => T extends X ? 1 : 2) extends <T>() => T extends Y ? 1 : 2
    ? true
    : false;
type ErrorOf<K extends keyof IDotyposService> = Effect.Error<
  ReturnType<IDotyposService[K]>
>;

// Every tag carries the port prefix.
export type Prefixed = Expect<
  Equal<DotyposFailure["_tag"] extends `Dotypos${string}` ? true : false, true>
>;
// The operation literal is exactly the interface.
export type Operations = Expect<Equal<DotyposOperation, keyof IDotyposService>>;
// Reads exclude Uncertain; unconditional writes exclude VersionConflict.
export type ReadsCertain = Expect<
  Equal<Extract<DotyposReadFailure, DotyposUncertain>, never>
>;
export type WritesUnconditional = Expect<
  Equal<Extract<DotyposWriteFailure, DotyposVersionConflict>, never>
>;
// Every read operation's channel is within DotyposReadFailure. This list is
// the one place the write set is written by hand: a new write that is missing
// here fails ReadChannels.
type ReadOperation = Exclude<
  keyof IDotyposService,
  | "createReservation"
  | "createCustomer"
  | "findOrCreateCustomer"
  | "cancelReservation"
  | "setReservationStatusIfMatches"
  | "updateReservation"
  | "confirmReservation"
  | "restoreCancelledReservation"
  | "patchCustomer"
  | "setCustomerDiscountGroup"
  | "updateCustomerBillingDetails"
  | "updateCustomerDetails"
  | "updateCustomerProfile"
  | "expireCustomer"
  | "reactivateCustomer"
>;
export type ReadChannels = Expect<
  Equal<
    Extract<ErrorOf<ReadOperation>, DotyposUncertain | DotyposVersionConflict>,
    never
  >
>;
test("each tag has its own stable failure code", () => {
  const reservationId = Schema.decodeSync(DotyposReservationIdSchema)(
    "reservation-id"
  );
  const cases = [
    [
      new DotyposUnavailable({ operation: "getCustomer", reason: "timeout" }),
      "dotypos-unavailable",
    ],
    [
      new DotyposRejected({ operation: "getCustomer", reason: "not-found" }),
      "dotypos-rejected",
    ],
    [
      new DotyposUncertain({ operation: "createCustomer", reason: "timeout" }),
      "dotypos-uncertain",
    ],
    [
      new DotyposVersionConflict({ operation: "confirmReservation" }),
      "dotypos-version-conflict",
    ],
    [
      new DotyposReservationCancelledError({
        reservationId,
        message: "Reservation is cancelled.",
      }),
      "dotypos-reservation-cancelled",
    ],
    [
      new DotyposReservationNotRestorable({
        reservationId,
        reason: "not-cancelled",
        status: "NEW",
        changedFields: [],
        message: "Reservation is new.",
      }),
      "dotypos-reservation-not-restorable",
    ],
  ] as const;

  for (const [failure, expectedCode] of cases) {
    expect(dotyposFailureCode(failure)).toBe(expectedCode);
  }
});
