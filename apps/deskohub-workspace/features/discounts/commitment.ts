import { Schema } from "effect";
import type { CalculatedDiscountApplication } from "./calculator";
import type { AppliedDiscount } from "./contracts";
import type { DiscountClaimInstruction, DiscountProvenance } from "./provider";

const DiscountCommitmentSchema = Schema.ObjectKeyword.pipe(
  Schema.brand("DiscountCommitment")
);

export type DiscountCommitment = Schema.Schema.Type<
  typeof DiscountCommitmentSchema
>;

export type DiscountCommitmentApplication = {
  readonly application: AppliedDiscount;
  readonly provenance: DiscountProvenance;
  readonly claim?: DiscountClaimInstruction;
};

const commitmentApplications = new WeakMap<
  DiscountCommitment,
  readonly DiscountCommitmentApplication[]
>();

export const makeDiscountCommitment = (input: {
  readonly applications: readonly CalculatedDiscountApplication[];
}): DiscountCommitment => {
  const commitment = Schema.decodeUnknownSync(DiscountCommitmentSchema)({});
  const applications = Object.freeze(
    input.applications.map(({ application, candidate }) =>
      Object.freeze({
        application,
        provenance: candidate.provenance,
        ...(candidate.claim !== undefined && { claim: candidate.claim }),
      })
    )
  );

  commitmentApplications.set(commitment, applications);
  return Object.freeze(commitment);
};

export const getDiscountCommitmentApplications = (
  commitment: DiscountCommitment
) => commitmentApplications.get(commitment);

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
