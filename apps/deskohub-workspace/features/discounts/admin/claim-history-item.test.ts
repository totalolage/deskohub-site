import { describe, expect, test } from "bun:test";
import { formatAdministrationDateTime } from "@/features/administration/formatters";
import { toClaimHistoryItem } from "./claim-history-item";
import {
  adminCodeClaim,
  adminCustomerCode,
  adminCustomerVoucher,
  adminVoucherClaim,
} from "./customer-admin-fixtures.test-utils";

const locale = "en-US";

describe("claim history item", () => {
  test("shows a reserved code claim without a completion or a known code value", () => {
    const claim = adminCodeClaim();
    expect(toClaimHistoryItem(claim, locale)).toEqual({
      id: claim.id,
      kind: "discount-code",
      appliedAmount: claim.appliedAmount,
      promotion: { id: claim.codeId, code: null },
      dotyposCustomerId: claim.dotyposCustomerId,
      redeemedAt: null,
      releasedAt: null,
      releaseReason: null,
      reservedAt: claim.reservedAt.toString(),
      reservedAtLabel: formatAdministrationDateTime(
        claim.reservedAt.toString(),
        locale
      ),
      completedAtLabel: null,
      state: "reserved",
      workspaceReservationId: claim.workspaceReservationId,
    });
  });

  test("completes a redeemed claim at its redemption and names its code", () => {
    const redeemedAt = Temporal.Instant.from("2026-08-11T08:00:00Z");
    const claim = adminCodeClaim({ redeemedAt, state: "redeemed" });
    const code = adminCustomerCode();
    const item = toClaimHistoryItem(
      claim,
      locale,
      new Map([[`discount-code:${code.id}`, code.code]])
    );
    expect(item.promotion).toEqual({ id: code.id, code: code.code });
    expect(item.redeemedAt).toBe(redeemedAt.toString());
    expect(item.completedAtLabel).toBe(
      formatAdministrationDateTime(redeemedAt.toString(), locale)
    );
  });

  test("completes a released voucher claim at its release with its reason", () => {
    const releasedAt = Temporal.Instant.from("2026-08-12T08:00:00Z");
    const claim = adminVoucherClaim({
      releasedAt,
      releaseReason: "payment_abandoned",
      state: "released",
    });
    const voucher = adminCustomerVoucher();
    const item = toClaimHistoryItem(
      claim,
      locale,
      new Map([[`discount-code:${voucher.id}`, "WRONGKIND"]])
    );
    expect(item).toMatchObject({
      kind: "voucher",
      promotion: { id: voucher.id, code: null },
      redeemedAt: null,
      releasedAt: releasedAt.toString(),
      releaseReason: "payment_abandoned",
      completedAtLabel: formatAdministrationDateTime(
        releasedAt.toString(),
        locale
      ),
    });
  });
});
