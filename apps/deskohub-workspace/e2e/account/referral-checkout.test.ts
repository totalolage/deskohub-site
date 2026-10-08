import "@/shared/testing/workspace-test-env";

import { expect, test } from "bun:test";
import { basename, dirname, resolve } from "node:path";
import { DotyposCustomerIdSchema } from "@deskohub/dotypos";
import { Effect } from "effect";
import { buildFreshCheckoutPayPath } from "@/features/checkout/backend/checkout/checkout-pay-url";
import { buildCoworkReservationQuote } from "@/features/checkout/checkout-quote.test-utils";
import { formatDiscountAdjustment } from "@/features/checkout/format-discount-adjustment";
import { getWorkspaceProductByTier } from "@/features/checkout/product-catalog";
import { currencyCZK } from "@/features/checkout/workspace-money";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { makeCoworkCheckoutData } from "../checkout/data";
import type { WorkspaceE2EConfig } from "../config";
import { workspaceDir } from "../runtime";
import type { WorkspaceE2ECase } from "../types";
import {
  bindWorkspaceE2EAccountReferralCheckout,
  calculateSingleInviteeReferralDiscount,
  isFreshOwnedPayStateUrl,
} from "./referral-checkout";
import {
  getWorkspaceE2EReferralCheckoutReviewArtifactPath,
  isOwnedReferralCheckoutReviewUrl,
} from "./referral-checkout-review";

const customerId = DotyposCustomerIdSchema.make("workspace-e2e-referral-owner");
const contact = {
  customerId,
  email: "delivered+account-referral@example.test",
  name: "E2E Lane",
  phone: "+420 555 000 111",
} as const;

test("expects a fixed 5% referrer amount after one invitation and an ordinary code", () => {
  const openSpace = getWorkspaceProductByTier("open-space").price;
  const afterOrdinaryCode = {
    ...openSpace,
    value: openSpace.value - Math.round((openSpace.value * 1000) / 10_000),
  };
  const afterInvitation = {
    ...afterOrdinaryCode,
    value:
      afterOrdinaryCode.value -
      Math.round((afterOrdinaryCode.value * 1500) / 10_000),
  };
  const expected = calculateSingleInviteeReferralDiscount(afterInvitation);

  expect(expected).toEqual(currencyCZK(1_109));
  expect(
    formatDiscountAdjustment(
      { kind: "fixed", amount: expected },
      "en-US"
    ).replaceAll("\u00a0", " ")
  ).toContain("11.09");
});

test("binds one planned referral case to two distinct synthetic checkout slots", () => {
  const testCase: WorkspaceE2ECase = {
    checkoutStates: [
      {
        data: makeCoworkCheckoutData(
          "https://workspace.example.test",
          "2099-09-01"
        ),
      },
      {
        data: makeCoworkCheckoutData(
          "https://workspace.example.test",
          "2099-09-02"
        ),
      },
    ],
    execute: () => Effect.void,
    id: "account-referral-checkout",
    timeoutMs: 600_000,
  };
  const bound = bindWorkspaceE2EAccountReferralCheckout({
    captureReview: async () => undefined,
    config: {} as WorkspaceE2EConfig,
    contact,
    datasourceConfig: {} as never,
    referralCode: "RFL12345",
    run: async () => ({ exitCode: 0, stderr: "", stdout: "" }),
    testCase,
  });

  expect(bound.id).toBe("account-referral-checkout");
  expect(bound.checkoutStates).toHaveLength(2);
  expect(new Set(bound.checkoutStates.map(({ data }) => data.date)).size).toBe(
    2
  );
  for (const { data } of bound.checkoutStates) {
    expect(data.email).toBe(contact.email);
    expect(data.name).toBe(contact.name);
    expect(data.phone).toBe(contact.phone);
    expect(new URL(data.checkoutUrl).searchParams.get("email")).toBe(
      contact.email
    );
  }
  expect(JSON.stringify(bound.checkoutStates)).not.toContain("RFL12345");
});

test("accepts only fresh signed pay URLs for the owned order and preview host", () => {
  const config = {
    baseUrl: "https://workspace.example.test",
    locale: "en-US",
  } as WorkspaceE2EConfig;
  const orderId = "workspace-reservation-123" as WorkspaceReservationId;
  const initial =
    "https://workspace.example.test/en-US/checkout/pay?payState=first&orderId=workspace-reservation-123";
  const fresh =
    "https://workspace.example.test/en-US/checkout/pay?payState=second&orderId=workspace-reservation-123";

  expect(
    isFreshOwnedPayStateUrl(fresh, initial, config, "en-US", orderId)
  ).toBe(true);
  expect(
    isFreshOwnedPayStateUrl(
      "https://workspace.example.test/en-US/checkout/pay?payState=first&orderId=workspace-reservation-123",
      initial,
      config,
      "en-US",
      orderId
    )
  ).toBe(false);
  expect(
    isFreshOwnedPayStateUrl(
      "https://elsewhere.example.test/en-US/checkout/pay?payState=second&orderId=workspace-reservation-123",
      initial,
      config,
      "en-US",
      orderId
    )
  ).toBe(false);
  expect(
    isOwnedReferralCheckoutReviewUrl({
      actualUrl: fresh,
      baseUrl: config.baseUrl,
      expectedUrl: fresh,
      orderId,
    })
  ).toBe(true);
  expect(
    isOwnedReferralCheckoutReviewUrl({
      actualUrl: `${fresh}&ref=RFL12345`,
      baseUrl: config.baseUrl,
      expectedUrl: `${fresh}&ref=RFL12345`,
      orderId,
    })
  ).toBe(false);
});

test("both ownership guards accept and constrain URLs from the real fresh-pay builder", async () => {
  const orderId = "workspace-reservation-123" as WorkspaceReservationId;
  const baseUrl = "https://workspace.example.test";
  const config = { baseUrl } as WorkspaceE2EConfig;
  const reservation = {
    kind: "cowork" as const,
    entryTier: "basic" as const,
    coffee: false,
    date: "2099-09-01",
    name: "Synthetic E2E",
    email: "delivered+referral-url@example.test",
    phone: "+420 555 000 111",
  };
  const input = {
    locale: "en-US" as const,
    orderId,
    checkoutSessionId: "checkout-session-referral-url",
    reservation,
    quote: buildCoworkReservationQuote(reservation),
  };
  const buildPayUrl = () =>
    Effect.runPromise(buildFreshCheckoutPayPath(input, {}, { orderId })).then(
      (path) => new URL(path, baseUrl).href
    );
  const [previousUrl, freshUrl] = await Promise.all([
    buildPayUrl(),
    buildPayUrl(),
  ]);

  expect(
    isFreshOwnedPayStateUrl(freshUrl, previousUrl, config, "en-US", orderId)
  ).toBe(true);
  expect(
    isOwnedReferralCheckoutReviewUrl({
      actualUrl: freshUrl,
      baseUrl,
      expectedUrl: freshUrl,
      orderId,
    })
  ).toBe(true);

  const wrongOrderUrl = new URL(freshUrl);
  wrongOrderUrl.searchParams.set("orderId", "another-workspace-reservation");
  const duplicateOrderUrl = new URL(freshUrl);
  duplicateOrderUrl.searchParams.append("orderId", orderId);
  const duplicatePayStateUrl = new URL(freshUrl);
  duplicatePayStateUrl.searchParams.append(
    "payState",
    duplicatePayStateUrl.searchParams.get("payState") ?? ""
  );
  const referredUrl = new URL(freshUrl);
  referredUrl.searchParams.set("ref", "RFL12345");
  const submittedCodeUrl = new URL(freshUrl);
  submittedCodeUrl.searchParams.set("submittedCode", "SAVE20");
  const missingOrderIdUrl = new URL(freshUrl);
  missingOrderIdUrl.searchParams.delete("orderId");
  const externalUrl = new URL(freshUrl);
  externalUrl.hostname = "elsewhere.example.test";

  expect(
    isFreshOwnedPayStateUrl(
      wrongOrderUrl.href,
      previousUrl,
      config,
      "en-US",
      orderId
    )
  ).toBe(false);
  expect(
    isOwnedReferralCheckoutReviewUrl({
      actualUrl: wrongOrderUrl.href,
      baseUrl,
      expectedUrl: wrongOrderUrl.href,
      orderId,
    })
  ).toBe(false);
  expect(
    isFreshOwnedPayStateUrl(
      duplicateOrderUrl.href,
      previousUrl,
      config,
      "en-US",
      orderId
    )
  ).toBe(false);
  expect(
    isFreshOwnedPayStateUrl(
      duplicatePayStateUrl.href,
      previousUrl,
      config,
      "en-US",
      orderId
    )
  ).toBe(false);
  expect(
    isOwnedReferralCheckoutReviewUrl({
      actualUrl: duplicateOrderUrl.href,
      baseUrl,
      expectedUrl: duplicateOrderUrl.href,
      orderId,
    })
  ).toBe(false);
  expect(
    isOwnedReferralCheckoutReviewUrl({
      actualUrl: duplicatePayStateUrl.href,
      baseUrl,
      expectedUrl: duplicatePayStateUrl.href,
      orderId,
    })
  ).toBe(false);
  expect(
    isFreshOwnedPayStateUrl(
      referredUrl.href,
      previousUrl,
      config,
      "en-US",
      orderId
    )
  ).toBe(false);
  expect(
    isOwnedReferralCheckoutReviewUrl({
      actualUrl: referredUrl.href,
      baseUrl,
      expectedUrl: referredUrl.href,
      orderId,
    })
  ).toBe(false);
  expect(
    isFreshOwnedPayStateUrl(
      submittedCodeUrl.href,
      previousUrl,
      config,
      "en-US",
      orderId
    )
  ).toBe(false);
  expect(
    isOwnedReferralCheckoutReviewUrl({
      actualUrl: submittedCodeUrl.href,
      baseUrl,
      expectedUrl: submittedCodeUrl.href,
      orderId,
    })
  ).toBe(false);
  expect(
    isFreshOwnedPayStateUrl(
      missingOrderIdUrl.href,
      previousUrl,
      config,
      "en-US",
      orderId
    )
  ).toBe(false);
  expect(
    isOwnedReferralCheckoutReviewUrl({
      actualUrl: missingOrderIdUrl.href,
      baseUrl,
      expectedUrl: missingOrderIdUrl.href,
      orderId,
    })
  ).toBe(false);
  expect(
    isFreshOwnedPayStateUrl(
      externalUrl.href,
      previousUrl,
      config,
      "en-US",
      orderId
    )
  ).toBe(false);
  expect(
    isOwnedReferralCheckoutReviewUrl({
      actualUrl: externalUrl.href,
      baseUrl,
      expectedUrl: externalUrl.href,
      orderId,
    })
  ).toBe(false);
});

test("writes checkout review PNGs into the account-review artifact bundle", () => {
  const artifact = getWorkspaceE2EReferralCheckoutReviewArtifactPath(
    "account-referral-with-voucher"
  );

  expect(dirname(artifact)).toBe(
    resolve(workspaceDir, "e2e-artifacts", "account-review")
  );
  expect(basename(artifact)).toBe("account-referral-with-voucher.png");
});
