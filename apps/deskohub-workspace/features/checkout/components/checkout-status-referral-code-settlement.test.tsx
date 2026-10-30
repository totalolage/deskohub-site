import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect, Layer } from "effect";
import { CustomerAccountContactService } from "@/features/account/backend/customer-account-contact.service";
import { customerAccountIdSchema } from "@/features/account/customer-account";
import type { CheckoutStatusKind } from "@/features/checkout/checkout-status-kind";
import { ReferralServiceMock } from "@/features/referrals/referral.service.mock";
import { ReferralFeatureFlagService } from "@/features/referrals/referral-feature-flag.service";
import { RememberedReferral } from "@/features/referrals/remembered-referral.service";
import { dotyposCustomerIdSchema } from "@/features/reservation/dotypos-customer";
import { reservationCustomerEmailSchema } from "@/features/reservation/reservation-contact";

mock.module("server-only", () => ({}));

const booker = dotyposCustomerIdSchema.make("60111");
const currentAccount = {
  status: "linked" as const,
  accountId: customerAccountIdSchema.make("account-1"),
  dotyposCustomerId: booker,
  email: reservationCustomerEmailSchema.make(testEmailAddress("booker")),
};

const runSettlement = async (
  status: CheckoutStatusKind,
  options: {
    readonly cookie?: string;
    readonly settled?: boolean;
    readonly writable?: boolean;
  } = {}
) => {
  const cookie = {
    value: Object.hasOwn(options, "cookie") ? options.cookie : "RFL12345",
  };
  const checks: { readonly dotyposCustomerId: string }[] = [];
  const hasSettledReferral = mock(
    ({ dotyposCustomerId }: { readonly dotyposCustomerId: string }) =>
      Effect.sync(() => {
        checks.push({ dotyposCustomerId });
        return options.settled ?? true;
      })
  );
  const { isRememberedReferralSettledByStatus } = await import(
    "./checkout-status-referral-code-settlement"
  );
  const settled = await Effect.runPromise(
    isRememberedReferralSettledByStatus(status).pipe(
      Effect.provide(
        RememberedReferral.inMemory(cookie, {
          writable: options.writable,
        }).pipe(
          Layer.provide(
            Layer.mergeAll(
              ReferralFeatureFlagService.fromDecision(true),
              ReferralServiceMock({
                hasSettledReferral: hasSettledReferral as never,
              }),
              Layer.mock(CustomerAccountContactService, {
                currentAccount: Effect.succeed(currentAccount),
              })
            )
          )
        )
      )
    )
  );
  return { settled, cookie: cookie.value, checks, hasSettledReferral };
};

describe("isRememberedReferralSettledByStatus", () => {
  test.each([
    "paid_waiting_fulfillment",
    "paid_fulfillment_delayed",
    "paid_awaiting_delivery",
    "paid_delivery_delayed",
    "fulfilled",
    "fulfillment_failed",
  ] as const)("settles for a paid status: %s", async (status) => {
    const result = await runSettlement(status, { settled: true });

    expect(result.settled).toBe(true);
    expect(result.checks).toEqual([{ dotyposCustomerId: booker }]);
  });

  test.each([
    "not_found",
    "created",
    "pending",
    "payment_pending_delayed",
    "payment_failed",
    "cancelled",
    "expired",
    "late_payment_checking",
    "late_payment_refund",
    "late_payment_review",
  ] as const)(
    "does not check settlement for unpaid status: %s",
    async (status) => {
      const result = await runSettlement(status);

      expect(result.settled).toBe(false);
      expect(result.checks).toEqual([]);
    }
  );

  test("returns false without a remembered code and skips the settlement check", async () => {
    const result = await runSettlement("fulfilled", { cookie: undefined });

    expect(result.settled).toBe(false);
    expect(result.checks).toEqual([]);
  });

  test("keeps the booker's code when a paid booking for a friend leaves the booker unsettled", async () => {
    const result = await runSettlement("fulfilled", {
      cookie: "RFL12345",
      settled: false,
    });

    expect(result.settled).toBe(false);
    expect(result.checks).toEqual([{ dotyposCustomerId: booker }]);
    expect(result.cookie).toBe("RFL12345");
  });

  test("does not write while checking a paid status when cookies are not writable", async () => {
    const result = await runSettlement("fulfilled", {
      cookie: "RFL12345",
      settled: true,
      writable: false,
    });

    expect(result.settled).toBe(true);
    expect(result.cookie).toBe("RFL12345");
  });
});

test("CheckoutStatusReferralCodeSettlement returns null for an unpaid status", async () => {
  const { CheckoutStatusReferralCodeSettlement } = await import(
    "./checkout-status-referral-code-settlement"
  );

  expect(
    await CheckoutStatusReferralCodeSettlement({ status: "pending" })
  ).toBeNull();
});
