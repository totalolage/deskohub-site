import { formatAdministrationDateTime } from "@/features/administration/formatters";
import type { Locale } from "@/features/i18n";
import type { ClaimHistoryItem } from "./customer-admin-tables";
import type {
  AdminDiscountCodeClaim,
  AdminVoucherClaim,
} from "./discount-administration.service";

/**
 * A code or voucher claim as the claim history table shows it, with its times
 * formatted on the server. `promotionCodes` holds code values keyed by
 * `discount-code:<id>` or `voucher:<id>`.
 */
export const toClaimHistoryItem = (
  claim: AdminDiscountCodeClaim | AdminVoucherClaim,
  locale: Locale,
  promotionCodes?: ReadonlyMap<string, string>
): ClaimHistoryItem => {
  const promotion =
    "codeId" in claim
      ? { kind: "discount-code" as const, id: claim.codeId }
      : { kind: "voucher" as const, id: claim.voucherId };
  const completedAt = claim.redeemedAt ?? claim.releasedAt;
  return {
    id: claim.id,
    kind: promotion.kind,
    appliedAmount: claim.appliedAmount,
    promotion: {
      id: promotion.id,
      code: promotionCodes?.get(`${promotion.kind}:${promotion.id}`) ?? null,
    },
    dotyposCustomerId: claim.dotyposCustomerId,
    redeemedAt: claim.redeemedAt?.toString() ?? null,
    releasedAt: claim.releasedAt?.toString() ?? null,
    releaseReason: claim.releaseReason,
    reservedAt: claim.reservedAt.toString(),
    reservedAtLabel: formatAdministrationDateTime(
      claim.reservedAt.toString(),
      locale
    ),
    completedAtLabel: completedAt
      ? formatAdministrationDateTime(completedAt.toString(), locale)
      : null,
    state: claim.state,
    workspaceReservationId: claim.workspaceReservationId,
  };
};
