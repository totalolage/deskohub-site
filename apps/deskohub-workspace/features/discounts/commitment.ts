declare const discountCommitmentBrand: unique symbol;

export type DiscountCommitment = {
  readonly [discountCommitmentBrand]: "DiscountCommitment";
};

type Assert<T extends true> = T;

export type CommitmentPayloadRemainsPrivate = Assert<
  Extract<
    keyof DiscountCommitment,
    "applications" | "claimInstructions" | "provenance"
  > extends never
    ? true
    : false
>;
