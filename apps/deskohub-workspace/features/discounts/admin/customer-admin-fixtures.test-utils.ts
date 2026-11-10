import { testEmailAddress } from "@deskohub/test-email";
import type { AdminCustomerProfile } from "./discount-administration.service";

type CustomerCode = AdminCustomerProfile["codes"][number];
type CustomerVoucher = AdminCustomerProfile["vouchers"][number];
type CodeClaim = AdminCustomerProfile["claims"][number];
type VoucherClaim = AdminCustomerProfile["voucherClaims"][number];

const instant = (value: string) => Temporal.Instant.from(value);

/** A reachable, named Dotypos customer without a discount group. */
export const adminCustomer = (
  overrides: Partial<AdminCustomerProfile["customer"]> = {}
): AdminCustomerProfile["customer"] => ({
  id: "dotypos-customer" as AdminCustomerProfile["customer"]["id"],
  displayName: "Test Customer",
  hasName: true,
  email: testEmailAddress("customer-admin"),
  phone: "+420 123 456 789",
  discountGroupId: null,
  ...overrides,
});

/** An enabled 10 % code limited to the customer alone. */
export const adminCustomerCode = (
  overrides: Partial<CustomerCode> = {}
): CustomerCode => ({
  id: "019c91dd-c560-7e55-b9d8-c95065efd52d" as CustomerCode["id"],
  discountId:
    "019c91dd-c560-7e55-b9d8-c95065efd51d" as CustomerCode["discountId"],
  code: "SUMMER10",
  enabled: true,
  validFrom: instant("2026-08-01T08:00:00Z"),
  validUntil: instant("2026-09-01T08:00:00Z"),
  maxUses: 100,
  maxUsesPerCustomer: 2,
  serviceDateFrom: null,
  serviceDateUntil: null,
  audienceSize: 1,
  audienceCustomerIds: [
    "dotypos-customer" as CustomerCode["audienceCustomerIds"][number],
  ],
  reservedUses: 1,
  redeemedUses: 3,
  releasedUses: 1,
  remainingUses: 96,
  createdAt: instant("2026-07-01T08:00:00Z"),
  updatedAt: instant("2026-07-02T08:00:00Z"),
  discountAdjustment: { kind: "percentage", basisPoints: 1000 },
  discountLabel: "Summer discount",
  discountLabels: { "cs-CZ": "Letní sleva", "en-US": "Summer discount" },
  eligible: true,
  ...overrides,
});

/** An enabled 100 CZK voucher open to everyone. */
export const adminCustomerVoucher = (
  overrides: Partial<CustomerVoucher> = {}
): CustomerVoucher => ({
  id: "019c91dd-c560-7e55-b9d8-c95065efd55d" as CustomerVoucher["id"],
  issuedCredit: { value: 10_000, exponent: 2, currency: "CZK" },
  remainingCredit: { value: 6500, exponent: 2, currency: "CZK" },
  code: "GIFT100",
  enabled: true,
  validFrom: null,
  validUntil: null,
  audienceSize: 0,
  audienceCustomerIds: [],
  reservedUses: 0,
  redeemedUses: 1,
  releasedUses: 0,
  createdAt: instant("2026-07-01T08:00:00Z"),
  updatedAt: instant("2026-07-02T08:00:00Z"),
  eligible: false,
  ...overrides,
});

const claimBase = {
  dotyposCustomerId: "dotypos-customer" as CodeClaim["dotyposCustomerId"],
  state: "reserved",
  paymentAttemptId: "payment-attempt" as CodeClaim["paymentAttemptId"],
  workspaceReservationId:
    "workspace-reservation" as CodeClaim["workspaceReservationId"],
  appliedAmount: { value: 7500, exponent: 2, currency: "CZK" },
  reservationExpiresAt: instant("2026-08-10T09:00:00Z"),
  reservedAt: instant("2026-08-10T08:00:00Z"),
  redeemedAt: null,
  releasedAt: null,
  releaseReason: null,
} as const satisfies Partial<CodeClaim>;

/** A reserved claim of {@link adminCustomerCode}. */
export const adminCodeClaim = (
  overrides: Partial<CodeClaim> = {}
): CodeClaim => ({
  ...claimBase,
  id: "code-claim" as CodeClaim["id"],
  codeId: adminCustomerCode().id,
  ...overrides,
});

/** A reserved claim of {@link adminCustomerVoucher}. */
export const adminVoucherClaim = (
  overrides: Partial<VoucherClaim> = {}
): VoucherClaim => ({
  ...claimBase,
  id: "voucher-claim" as VoucherClaim["id"],
  voucherId: adminCustomerVoucher().id,
  ...overrides,
});

/** A customer with no codes, vouchers, claims, or discount groups. */
export const adminCustomerProfile = (
  overrides: Partial<AdminCustomerProfile> = {}
): AdminCustomerProfile => ({
  customer: adminCustomer(),
  discountGroups: [],
  codes: [],
  claims: [],
  vouchers: [],
  voucherClaims: [],
  ...overrides,
});
