import { expect, test } from "bun:test";
import type { Effect } from "effect";
import type { dotyposRequestProfiles } from "./backend/request-profiles";
import type { IDotyposService } from "./backend/service";
import {
  type DotyposFailure,
  DotyposFailureCode,
  type DotyposOperation,
  type DotyposReadFailure,
  type DotyposUncertain,
  type DotyposVersionConflict,
  type DotyposWriteFailure,
} from "./errors";

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
  | "updateReservation"
  | "confirmReservation"
  | "patchCustomer"
  | "setCustomerDiscountGroup"
  | "updateCustomerBillingDetails"
  | "updateCustomerDetails"
>;
export type ReadChannels = Expect<
  Equal<
    Extract<ErrorOf<ReadOperation>, DotyposUncertain | DotyposVersionConflict>,
    never
  >
>;
// No read request has a write ceiling. The profile union already forbids it.
type ReadRequestRetry = Extract<
  (typeof dotyposRequestProfiles)[keyof typeof dotyposRequestProfiles],
  { effect: "read" }
>["retry"];
export type ReadRetry = Expect<Equal<ReadRequestRetry, "transient" | "none">>;

test("each tag has its own stable failure code", () => {
  const codes = Object.values(DotyposFailureCode);
  expect(new Set(codes).size).toBe(codes.length);
});
