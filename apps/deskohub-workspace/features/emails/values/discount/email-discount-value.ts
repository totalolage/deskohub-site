import type { EmailDiscountSelection } from "@deskohub/workspace-admin-api";
import type { EmailIssuanceParameters } from "@/features/emails/backend";

/** A discount value as an email renders and snapshots it: its code and expiry. */
export type EmailDiscountValue = {
  readonly code: string;
  /** ISO-8601 instant after which the code no longer applies. */
  readonly expiresAt: string;
};

/** Absolute expiry of a code issued at `issuedAt`, `validDays` whole days later. */
const emailDiscountExpiry = (
  selection: Pick<EmailDiscountSelection, "validDays">,
  issuedAt: Temporal.Instant
): Temporal.Instant => issuedAt.add({ hours: 24 * selection.validDays });

/** The provider parameters frozen before a recipient's code is created. */
export const emailDiscountIssuanceParameters = (
  selection: EmailDiscountSelection,
  nowEpochMilliseconds: number
): EmailIssuanceParameters => ({
  discountId: selection.discountId,
  expiresAt: emailDiscountExpiry(
    selection,
    Temporal.Instant.fromEpochMilliseconds(nowEpochMilliseconds)
  ).toString(),
  maxUses: selection.maxUses,
  maxUsesPerCustomer: selection.maxUsesPerCustomer,
});

/**
 * Placeholder code for previews, test sends, and dry runs. The space makes it
 * invalid promotion-code syntax, so it can never be stored or redeemed.
 */
export const emailDiscountSampleCode = "SAMPLE CODE";

/**
 * A clearly marked, non-redeemable discount value. It touches no storage and
 * issues nothing; real deliveries use `EmailDiscountValues.issue`.
 */
export const sampleEmailDiscountValue = (
  selection: Pick<EmailDiscountSelection, "validDays">,
  now: Temporal.Instant
): EmailDiscountValue => ({
  code: emailDiscountSampleCode,
  expiresAt: emailDiscountExpiry(selection, now).toString(),
});
