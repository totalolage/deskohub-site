import "@/shared/testing/workspace-test-env";

import { expect, test } from "bun:test";
import { basename, dirname, resolve } from "node:path";
import { DotyposCustomerIdSchema } from "@deskohub/dotypos";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect } from "effect";
import { buildFreshCheckoutPayPath } from "@/features/checkout/backend/checkout/checkout-pay-url";
import { checkoutSessionIdSchema } from "@/features/checkout/checkout-identifiers";
import { buildCoworkReservationQuote } from "@/features/checkout/checkout-quote.test-utils";
import { formatDiscountAdjustment } from "@/features/checkout/format-discount-adjustment";
import { getWorkspaceProductByTier } from "@/features/checkout/product-catalog";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { getReservationCustomerQueryMode } from "@/features/reservation/reservation-checkout-query";
import { currencyCZK } from "@/shared/money/currencies";
import { instantStringSchema } from "@/shared/utils/temporal";
import { makeCoworkCheckoutData } from "../checkout/data";
import type { WorkspaceE2EConfig } from "../config";
import { workspaceDir } from "../runtime";
import {
  bindCheckoutContact,
  calculateSingleInviteeReferralDiscount,
  isFreshOwnedPayStateUrl,
  isReferralAppliedPayUrl,
  isRejectedReferralCodeUrl,
} from "./checkout";
import {
  getWorkspaceE2EReferralCheckoutReviewArtifactPath,
  isOwnedReferralCheckoutReviewUrl,
} from "./checkout-review";

const customerId = DotyposCustomerIdSchema.make("workspace-e2e-referral-owner");
const contact = {
  customerId,
  email: testEmailAddress("delivered+account-referral"),
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

test("opens a bound checkout on the signed-in account card, not for someone else", () => {
  const planned = makeCoworkCheckoutData(
    "https://workspace.example.test",
    "2099-09-01"
  );
  const contactOnly = new URL(planned.checkoutUrl);
  for (const [key, value] of Object.entries({
    email: contact.email,
    name: contact.name,
    phone: contact.phone,
  })) {
    contactOnly.searchParams.set(key, value);
  }
  // Contact fields alone book for someone else, which only prefills a
  // remembered referral instead of applying it.
  expect(getReservationCustomerQueryMode(contactOnly.searchParams)).toBe(
    "contact"
  );

  const bound = new URL(bindCheckoutContact(planned, contact).checkoutUrl);

  expect(getReservationCustomerQueryMode(bound.searchParams)).toBe("account");
});

test("accepts only fresh signed pay URLs for the owned order and preview host", () => {
  const config = {
    baseUrl: "https://workspace.example.test",
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
    email: testEmailAddress("delivered+referral-url"),
    phone: "+420 555 000 111",
  };
  const input = {
    locale: "en-US" as const,
    orderId,
    checkoutSessionId: checkoutSessionIdSchema.make(
      "checkout-session-referral-url"
    ),
    bookedAt: instantStringSchema.make("2026-06-01T09:58:00.000Z"),
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

test("accepts only the owned first pay page that reports the share-link referral", () => {
  const baseUrl = "https://workspace.example.test";
  const orderId = "workspace-reservation-123" as WorkspaceReservationId;
  const payUrl = (query: string) =>
    `${baseUrl}/en-US/checkout/pay?payState=signed&orderId=${orderId}${query}`;
  const accepts = (currentUrl: string) =>
    isReferralAppliedPayUrl({ baseUrl, currentUrl, locale: "en-US", orderId });

  expect(accepts(payUrl("&referralApplied=1"))).toBe(true);
  for (const rejected of [
    payUrl(""),
    payUrl("&referralApplied=0"),
    payUrl("&referralApplied=1&referralApplied=1"),
    payUrl("&referralApplied=1&ref=RFL12345"),
    payUrl("&referralApplied=1&submittedCode=RFL12345"),
    payUrl("&referralApplied=1&discountCodeError=referral-ineligible"),
    payUrl("&referralApplied=1").replace(orderId, "workspace-reservation-456"),
    payUrl("&referralApplied=1").replace("/en-US/", "/cs-CZ/"),
    payUrl("&referralApplied=1").replace(baseUrl, "https://other.example.test"),
    `${baseUrl}/en-US/checkout/pay?orderId=${orderId}&referralApplied=1`,
    "not a url",
  ]) {
    expect(accepts(rejected)).toBe(false);
  }
});

test("accepts only a rejected referral code on a re-signed pay state", () => {
  const baseUrl = "https://workspace.example.test";
  const orderId = "workspace-reservation-123" as WorkspaceReservationId;
  const previousUrl = `${baseUrl}/en-US/checkout/pay?payState=signed&orderId=${orderId}`;
  const accepts = (currentUrl: string) =>
    isRejectedReferralCodeUrl({
      baseUrl,
      currentUrl,
      error: "referral-already-attributed",
      locale: "en-US",
      orderId,
      previousUrl,
    });
  const rejected = `${baseUrl}/en-US/checkout/pay?payState=fresh&orderId=${orderId}&discountCodeError=referral-already-attributed&discountCodeErrorId=synthetic`;

  expect(accepts(rejected)).toBe(true);
  for (const candidate of [
    previousUrl,
    rejected.replace("payState=fresh", "payState=signed"),
    rejected.replace("referral-already-attributed", "referral-ineligible"),
    `${rejected}&discountCodeError=referral-already-attributed`,
    `${rejected}&referralApplied=1`,
    `${rejected}&ref=RFL12345`,
    `${rejected}&submittedCode=RFL12345`,
    rejected.replace(orderId, "workspace-reservation-456"),
    "not a url",
  ]) {
    expect(accepts(candidate)).toBe(false);
  }
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
