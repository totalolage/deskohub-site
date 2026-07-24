import { Schema } from "effect";
import {
  getCanonicalWorkspaceProductIdentity,
  type WorkspaceProductIdentity,
} from "@/features/checkout/product-identity";
import type { CalculatedDiscountApplication } from "./calculator";
import type { AppliedDiscount } from "./contracts";
import type { DiscountClaimInstruction, DiscountProvenance } from "./provider";

const DiscountCommitmentSchema = Schema.ObjectKeyword.pipe(
  Schema.brand("DiscountCommitment")
);

export type DiscountCommitment = Schema.Schema.Type<
  typeof DiscountCommitmentSchema
>;

export interface DiscountCommitmentApplication {
  readonly application: AppliedDiscount;
  readonly provenance: DiscountProvenance;
  readonly claim?: DiscountClaimInstruction;
}

export interface DiscountCommitmentPayload {
  readonly product: WorkspaceProductIdentity;
  readonly applications: readonly DiscountCommitmentApplication[];
}

export const makeDiscountCommitment = (input: {
  readonly product: WorkspaceProductIdentity;
  readonly applications: readonly CalculatedDiscountApplication[];
}): DiscountCommitment =>
  Schema.decodeUnknownSync(DiscountCommitmentSchema)({
    product: getCanonicalWorkspaceProductIdentity(input.product),
    applications: input.applications.map(({ application, candidate }) => ({
      application,
      provenance: candidate.provenance,
      ...(candidate.claim !== undefined && { claim: candidate.claim }),
    })),
  });

export const getDiscountCommitmentPayload = (
  commitment: DiscountCommitment
): DiscountCommitmentPayload =>
  commitment as unknown as DiscountCommitmentPayload;

type Assert<T extends true> = T;

export type CommitmentPayloadRemainsPrivate = Assert<
  Extract<
    keyof DiscountCommitment,
    | "product"
    | "applications"
    | "claimInstructions"
    | "provenance"
    | "providerNamespace"
    | "providerReference"
  > extends never
    ? true
    : false
>;
