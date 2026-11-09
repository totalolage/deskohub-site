import {
  getCanonicalWorkspaceProductIdentity,
  type WorkspaceProductIdentity,
} from "@/features/checkout/product-identity";
import type { CalculatedDiscountApplication } from "./calculator";
import type { AppliedDiscount } from "./contracts";
import type { DiscountClaimInstruction, DiscountProvenance } from "./provider";

interface DiscountCommitmentApplication {
  readonly application: AppliedDiscount;
  readonly provenance: DiscountProvenance;
  readonly claim?: DiscountClaimInstruction;
}

export interface DiscountCommitmentPayload {
  readonly product: WorkspaceProductIdentity;
  readonly applications: readonly DiscountCommitmentApplication[];
}

const readDiscountCommitment = Symbol("readDiscountCommitment");

class DiscountCommitmentValue {
  readonly #payload: DiscountCommitmentPayload;

  constructor(payload: DiscountCommitmentPayload) {
    this.#payload = payload;
  }

  [readDiscountCommitment]() {
    return this.#payload;
  }
}

export type DiscountCommitment = DiscountCommitmentValue;

export const makeDiscountCommitment = (input: {
  readonly product: WorkspaceProductIdentity;
  readonly applications: readonly CalculatedDiscountApplication[];
}): DiscountCommitment => {
  return new DiscountCommitmentValue({
    product: getCanonicalWorkspaceProductIdentity(input.product),
    applications: input.applications.map(({ application, candidate }) => ({
      application,
      provenance: candidate.provenance,
      ...(candidate.claim !== undefined && { claim: candidate.claim }),
    })),
  });
};

export const getDiscountCommitmentPayload = (
  commitment: DiscountCommitment
): DiscountCommitmentPayload => commitment[readDiscountCommitment]();
