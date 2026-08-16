import {
  getCanonicalWorkspaceProductIdentity,
  type WorkspaceProductIdentity,
} from "@/features/checkout/product-identity";
import type { CalculatedGoodsBasketDiscountApplication } from "./basket-calculator";
import type { CalculatedDiscountApplication } from "./calculator";
import type { AppliedDiscount } from "./contracts";
import type { DiscountClaimInstruction, DiscountProvenance } from "./provider";

export interface DiscountCommitmentApplication {
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

export interface GoodsBasketDiscountCommitmentPayload {
  readonly applications: readonly {
    readonly lineApplications: CalculatedGoodsBasketDiscountApplication["lineApplications"];
    readonly provenance: DiscountProvenance;
    readonly claim?: DiscountClaimInstruction;
  }[];
}

const readGoodsBasketDiscountCommitment = Symbol(
  "readGoodsBasketDiscountCommitment"
);

class GoodsBasketDiscountCommitmentValue {
  readonly #payload: GoodsBasketDiscountCommitmentPayload;

  constructor(payload: GoodsBasketDiscountCommitmentPayload) {
    this.#payload = payload;
  }

  [readGoodsBasketDiscountCommitment]() {
    return this.#payload;
  }
}

export type GoodsBasketDiscountCommitment = GoodsBasketDiscountCommitmentValue;

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

export const makeGoodsBasketDiscountCommitment = (input: {
  readonly applications: readonly CalculatedGoodsBasketDiscountApplication[];
}): GoodsBasketDiscountCommitment =>
  new GoodsBasketDiscountCommitmentValue({
    applications: input.applications.map(({ candidate, lineApplications }) => ({
      lineApplications,
      provenance: candidate.provenance,
      ...(candidate.claim !== undefined && { claim: candidate.claim }),
    })),
  });

export const getGoodsBasketDiscountCommitmentPayload = (
  commitment: GoodsBasketDiscountCommitment
): GoodsBasketDiscountCommitmentPayload =>
  commitment[readGoodsBasketDiscountCommitment]();

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
