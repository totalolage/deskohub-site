import { Schema } from "effect";
import type { CalculatedDiscountApplication } from "./calculator";

const DiscountCommitmentSchema = Schema.ObjectKeyword.pipe(
  Schema.brand("DiscountCommitment")
);

export type DiscountCommitment = Schema.Schema.Type<
  typeof DiscountCommitmentSchema
>;

export const makeDiscountCommitment = (input: {
  readonly applications: readonly CalculatedDiscountApplication[];
}): DiscountCommitment =>
  Schema.decodeUnknownSync(DiscountCommitmentSchema)({
    applications: input.applications.map(({ application, candidate }) => ({
      application,
      provenance: candidate.provenance,
      ...(candidate.claim !== undefined && { claim: candidate.claim }),
    })),
  });

type Assert<T extends true> = T;

export type CommitmentPayloadRemainsPrivate = Assert<
  Extract<
    keyof DiscountCommitment,
    | "applications"
    | "claimInstructions"
    | "provenance"
    | "providerNamespace"
    | "providerReference"
  > extends never
    ? true
    : false
>;
