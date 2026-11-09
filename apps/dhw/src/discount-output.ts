import type {
  AdministrationDiscountAdjustmentType,
  AdministrationDiscountCodeClaimType,
  AdministrationDiscountCodeDetailType,
  AdministrationDiscountCodeType,
  AdministrationDiscountMutationResultType,
  AdministrationWorkspaceProductTargetType,
} from "@deskohub/workspace-admin-api";
import { Match } from "effect";

export const formatMoney = (
  money: {
    readonly value: number;
    readonly exponent: number;
    readonly currency: string;
  } | null
) =>
  money === null
    ? "Amount unavailable"
    : `${money.value / 10 ** money.exponent} ${money.currency}`;

export const formatCodeBenefit = (
  code: AdministrationDiscountCodeType,
  discountLabels: ReadonlyMap<string, string>
) => discountLabels.get(code.discountId) ?? code.discountId;

const formatCodeRemaining = (
  code: AdministrationDiscountCodeType,
  unlimitedLabel: string | number = "Unlimited"
) => code.remainingUses ?? unlimitedLabel;

type ServiceDates = Pick<
  AdministrationDiscountCodeType,
  "serviceDateFrom" | "serviceDateUntil"
>;

/** The reservation start dates a code applies to, or none for any date. */
const serviceDateRange = ({
  serviceDateFrom,
  serviceDateUntil,
}: ServiceDates) =>
  serviceDateFrom === null || serviceDateUntil === null
    ? undefined
    : { from: serviceDateFrom, until: serviceDateUntil };

const formatServiceDates = (code: ServiceDates) => {
  const range = serviceDateRange(code);
  return range === undefined
    ? "Any service date"
    : `Service dates ${range.from} to ${range.until}`;
};

/**
 * One code with the label of the discount it grants, its state, its limits,
 * and the reservation start dates it applies to.
 */
export const formatCodeRow = (
  code: AdministrationDiscountCodeType,
  discountLabel: string
) =>
  [
    code.id,
    code.code,
    discountLabel,
    code.enabled ? "Enabled" : "Disabled",
    `${formatCodeRemaining(code)} globally`,
    `${code.maxUsesPerCustomer ?? "Unlimited"} per customer`,
    formatServiceDates(code),
  ].join("\t");

/** A code detail's line naming the first and last reservation start date. */
export const formatServiceDatesLine = (code: ServiceDates) => {
  const range = serviceDateRange(code);
  return range === undefined
    ? "Service dates\tAny"
    : `Service dates\t${range.from}\t${range.until}`;
};

type PromotionClaim = Pick<
  AdministrationDiscountCodeClaimType,
  | "appliedAmount"
  | "dotyposCustomerId"
  | "redeemedAt"
  | "releasedAt"
  | "reservedAt"
  | "state"
  | "workspaceReservationId"
>;

const formatPromotionClaimRow = (claim: PromotionClaim) =>
  [
    claim.state,
    formatMoney(claim.appliedAmount),
    claim.dotyposCustomerId,
    claim.workspaceReservationId,
    claim.reservedAt,
    claim.redeemedAt ?? claim.releasedAt ?? "Pending",
  ].join("\t");

/**
 * What a code's or voucher's detail shows below its summary row: when it is
 * valid, which customers may claim it, and the claims made so far.
 */
export const formatPromotionDetailLines = (
  validity: {
    readonly validFrom: string | null;
    readonly validUntil: string | null;
  },
  {
    claims,
    customers,
  }: {
    readonly claims: ReadonlyArray<PromotionClaim>;
    readonly customers: AdministrationDiscountCodeDetailType["customers"];
  }
): ReadonlyArray<string> => [
  `Validity\t${validity.validFrom ?? "No start"}\t${validity.validUntil ?? "No end"}`,
  customers.length === 0
    ? "Audience\tUnrestricted"
    : `Audience\t${customers.length} customers`,
  ...customers.map(({ customer, customerId }) =>
    ["Customer", customerId, customer?.displayName ?? "Unavailable"].join("\t")
  ),
  `Claims\t${claims.length}`,
  ...claims.map(formatPromotionClaimRow),
];

export const formatProductTarget = (
  target: AdministrationWorkspaceProductTargetType
) =>
  target.kind === "cowork" && target.tier !== undefined
    ? `cowork:${target.tier}`
    : target.kind;

export const formatDiscountAdjustment = (
  adjustment: AdministrationDiscountAdjustmentType
) =>
  adjustment.kind === "percentage"
    ? `${adjustment.basisPoints / 100}%`
    : formatMoney(adjustment.amount);

export const formatMutationResult = (
  result: AdministrationDiscountMutationResultType
) => {
  const notice = Match.value(result.kind).pipe(
    Match.when("create-discount", () => "Discount created."),
    Match.when("update-discount", () => "Discount updated."),
    Match.when("delete-discount", () => "Discount deleted."),
    Match.when("create-code", () => "Discount code created."),
    Match.when("create-customer-code", () => "Customer code created."),
    Match.when("update-code", () => "Discount code updated."),
    Match.when("delete-code", () => "Discount code deleted."),
    Match.when("add-code-customer", () => "Customer added to code audience."),
    Match.when(
      "remove-code-customer",
      () => "Customer removed from code audience."
    ),
    Match.when("make-code-unrestricted", () => "Code made unrestricted."),
    Match.when("create-voucher", () => "Voucher created."),
    Match.when("create-customer-voucher", () => "Customer voucher created."),
    Match.when("update-voucher", () => "Voucher updated."),
    Match.when("delete-voucher", () => "Voucher deleted."),
    Match.when(
      "add-voucher-customer",
      () => "Customer added to voucher audience."
    ),
    Match.when(
      "remove-voucher-customer",
      () => "Customer removed from voucher audience."
    ),
    Match.when("make-voucher-unrestricted", () => "Voucher made unrestricted."),
    Match.when(
      "set-customer-discount-group",
      () => "Customer discount group updated."
    ),
    Match.exhaustive
  );
  const createdId =
    result.createdDiscountId ?? result.createdCodeId ?? result.createdVoucherId;
  return createdId === null ? notice : `${notice} ${createdId}`;
};
