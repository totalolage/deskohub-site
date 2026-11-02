import { describe, expect, test } from "bun:test";
import { m } from "@/features/administration/i18n";
import { formatDiscountAdjustment } from "@/features/checkout/format-discount-adjustment";
import {
  adminCodeClaim,
  adminCustomer,
  adminCustomerCode,
  adminCustomerProfile,
  adminCustomerVoucher,
  adminVoucherClaim,
} from "./customer-admin-fixtures.test-utils";
import {
  countCustomerAvailableCodes,
  customerClaimHistory,
  customerPromotionCodeValues,
  customerVisiblePromotionCodes,
  formatCustomerDiscountGroup,
} from "./customer-profile-display";
import type { AdminCustomerProfile } from "./discount-administration.service";

const locale = "en-US";
type GroupId = AdminCustomerProfile["discountGroups"][number]["id"];

describe("customer profile display", () => {
  test("names the customer's discount group with its percentage", () => {
    const groupId = "group-regulars" as GroupId;
    const profile = adminCustomerProfile({
      customer: adminCustomer({ discountGroupId: groupId }),
      discountGroups: [
        { id: "group-other" as GroupId, name: "Other", basisPoints: 500 },
        { id: groupId, name: "Regulars", basisPoints: 1500 },
      ],
    });
    expect(formatCustomerDiscountGroup(profile, locale)).toBe(
      `Regulars (${formatDiscountAdjustment(
        { kind: "percentage", basisPoints: 1500 },
        locale
      )})`
    );
  });

  test("reports a discount group Dotypos no longer lists, or no group", () => {
    const groupId = "group-gone" as GroupId;
    expect(
      formatCustomerDiscountGroup(
        adminCustomerProfile({
          customer: adminCustomer({ discountGroupId: groupId }),
        }),
        locale
      )
    ).toBe(m.discountsCustomerGroupUnavailable({ groupId }, { locale }));
    expect(formatCustomerDiscountGroup(adminCustomerProfile(), locale)).toBe(
      m.discountsCustomerGroupNone({}, { locale })
    );
  });

  test("shows the customer's own and everyone's promotions, enabled and own first", () => {
    const profile = adminCustomerProfile({
      codes: [
        adminCustomerCode({ code: "ZOWN", audienceSize: 2 }),
        adminCustomerCode({ code: "AOPEN", audienceSize: 0, eligible: false }),
        adminCustomerCode({ code: "OTHERS", audienceSize: 3, eligible: false }),
        adminCustomerCode({ code: "AOFF", enabled: false }),
      ],
      vouchers: [
        adminCustomerVoucher({ code: "GIFT" }),
        adminCustomerVoucher({ code: "NOTMINE", audienceSize: 1 }),
      ],
    });
    const visible = customerVisiblePromotionCodes(profile, locale);
    expect(visible.map(({ code }) => code)).toEqual([
      "ZOWN",
      "AOPEN",
      "GIFT",
      "AOFF",
    ]);
    expect(visible[0]).toMatchObject({
      kind: "discount-code",
      discountLabel: "Summer discount",
    });
    expect(visible[2]).toMatchObject({
      kind: "voucher",
      issuedCredit: adminCustomerVoucher().issuedCredit,
      remainingCredit: adminCustomerVoucher().remainingCredit,
    });
  });

  test("counts enabled codes limited to the customer and open to everyone", () => {
    expect(
      countCustomerAvailableCodes([
        adminCustomerCode(),
        adminCustomerCode({ audienceSize: 4 }),
        adminCustomerCode({ audienceSize: 4, eligible: false }),
        adminCustomerCode({ enabled: false }),
        adminCustomerCode({ audienceSize: 0, eligible: false }),
        adminCustomerCode({ audienceSize: 0, enabled: false }),
      ])
    ).toEqual({ targeted: 2, universal: 1 });
  });

  test("merges code and voucher claims newest first", () => {
    const older = adminCodeClaim({
      reservedAt: Temporal.Instant.from("2026-08-01T08:00:00Z"),
    });
    const newest = adminVoucherClaim({
      reservedAt: Temporal.Instant.from("2026-08-20T08:00:00Z"),
    });
    const middle = adminCodeClaim({
      id: "code-claim-2" as typeof older.id,
      reservedAt: Temporal.Instant.from("2026-08-10T08:00:00Z"),
    });
    expect(
      customerClaimHistory(
        adminCustomerProfile({
          claims: [older, middle],
          voucherClaims: [newest],
        })
      )
    ).toEqual([newest, middle, older]);
  });

  test("keys code values by promotion kind and id", () => {
    const code = adminCustomerCode();
    const voucher = adminCustomerVoucher();
    expect(
      customerPromotionCodeValues(
        adminCustomerProfile({ codes: [code], vouchers: [voucher] })
      )
    ).toEqual(
      new Map([
        [`discount-code:${code.id}`, code.code],
        [`voucher:${voucher.id}`, voucher.code],
      ])
    );
  });
});
