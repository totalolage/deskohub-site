import {
  getCanonicalWorkspaceProductIdentity,
  type WorkspaceProductIdentity,
} from "@/features/checkout/product-identity";
import type { CalculatedDiscountApplication } from "./calculator";
import type {
  AppliedDiscount,
  DiscountAdjustment,
  DiscountId,
} from "./contracts";
import type { DiscountClaimInstruction, DiscountProvenance } from "./provider";

interface DiscountCommitmentApplication {
  readonly application: AppliedDiscount;
  readonly provenance: DiscountProvenance;
  readonly claim?: DiscountClaimInstruction;
}

interface DiscountCommitmentPayload {
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

export interface MaterializedDiscountApplication {
  readonly application: AppliedDiscount;
  readonly provenance: DiscountProvenance;
  readonly claim?: DiscountClaimInstruction;
}

export type DiscountCommitmentMaterialization =
  | {
      readonly status: "ready";
      readonly product: WorkspaceProductIdentity;
      readonly displayedDiscountIds: readonly DiscountId[];
      readonly applications: readonly MaterializedDiscountApplication[];
    }
  | { readonly status: "pricing_changed" };

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

export const materializeDiscountCommitment = (
  commitment: DiscountCommitment,
  displayedApplications: readonly AppliedDiscount[]
): DiscountCommitmentMaterialization => {
  const payload = commitment[readDiscountCommitment]();
  if (
    payload.applications.length !== displayedApplications.length ||
    payload.applications.some(
      ({ application }, index) =>
        !discountApplicationsEqual(application, displayedApplications[index])
    )
  ) {
    return { status: "pricing_changed" };
  }

  return {
    status: "ready",
    product: payload.product,
    displayedDiscountIds: displayedApplications.map(
      ({ discount }) => discount.id
    ),
    applications: payload.applications,
  };
};

const discountApplicationsEqual = (
  committed: AppliedDiscount,
  displayed: AppliedDiscount | undefined
) =>
  displayed !== undefined &&
  committed.discount.id === displayed.discount.id &&
  committed.discount.label === displayed.discount.label &&
  committed.discount.expiresAt === displayed.discount.expiresAt &&
  committed.discount.countdownStartsAt ===
    displayed.discount.countdownStartsAt &&
  discountAdjustmentsEqual(
    committed.discount.adjustment,
    displayed.discount.adjustment
  ) &&
  moneyEquals(committed.subtotalBefore, displayed.subtotalBefore) &&
  moneyEquals(committed.amount, displayed.amount) &&
  moneyEquals(committed.subtotalAfter, displayed.subtotalAfter);

const discountAdjustmentsEqual = (
  committed: DiscountAdjustment,
  displayed: DiscountAdjustment
) => {
  if (committed.kind === "percentage" && displayed.kind === "percentage") {
    return committed.basisPoints === displayed.basisPoints;
  }
  if (committed.kind === "fixed" && displayed.kind === "fixed") {
    return moneyEquals(committed.amount, displayed.amount);
  }
  return false;
};

const moneyEquals = (
  left: AppliedDiscount["amount"],
  right: AppliedDiscount["amount"]
) =>
  left.value === right.value &&
  left.exponent === right.exponent &&
  left.currency === right.currency;

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
