import { Schema } from "effect";

const DiscountCommitmentSchema = Schema.ObjectKeyword.pipe(
  Schema.brand("DiscountCommitment")
);

export type DiscountCommitment = Schema.Schema.Type<
  typeof DiscountCommitmentSchema
>;

type Assert<T extends true> = T;

export type CommitmentPayloadRemainsPrivate = Assert<
  Extract<
    keyof DiscountCommitment,
    "applications" | "claimInstructions" | "provenance"
  > extends never
    ? true
    : false
>;
