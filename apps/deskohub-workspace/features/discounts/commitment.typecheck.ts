import type { DiscountCommitment } from "./commitment";

type AssertTrue<Value extends true> = Value;

// Callers read commitment fields only through getDiscountCommitmentPayload.
export type CommitmentPayloadRemainsPrivate = AssertTrue<
  Extract<
    keyof DiscountCommitment,
    | "product"
    | "firstServiceDate"
    | "applications"
    | "claimInstructions"
    | "provenance"
    | "providerNamespace"
    | "providerReference"
  > extends never
    ? true
    : false
>;
