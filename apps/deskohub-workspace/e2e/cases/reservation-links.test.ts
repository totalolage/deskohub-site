import { expect, test } from "bun:test";
import { discountCodeQueryParam } from "@/features/discounts/promotion-code";
import {
  parseReferralCode,
  referralCodeQueryParam,
} from "@/features/referrals/client";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { makeUnusableReferralCode } from "../account/referral-fixture";
import { validateSignedPayUrl } from "./reservation-links";

const signedPayOrderId = "reservation-id" as WorkspaceReservationId;

const makeSignedPayUrl = ({
  includePayState = true,
  params = {},
  pathname = "/en-US/checkout/pay",
}: {
  readonly includePayState?: boolean;
  readonly params?: Readonly<Record<string, string>>;
  readonly pathname?: string;
} = {}) => {
  const url = new URL(`https://workspace.example.test${pathname}`);
  if (includePayState) {
    url.searchParams.set("payState", "signed-test-token");
  }
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
};

const validateSignedPayUrlForTest =
  (url: string, publicOrderIdPolicy: "required" | "optional") => () =>
    validateSignedPayUrl({
      locale: "en-US",
      orderId: signedPayOrderId,
      publicOrderIdPolicy,
      url,
    });

test.each([
  [
    "required public ID matches",
    "required",
    { orderId: "reservation-id" },
    true,
  ],
  ["required public ID is missing", "required", {}, false],
  [
    "required public ID mismatches",
    "required",
    { orderId: "other-reservation-id" },
    false,
  ],
  ["optional public ID is missing", "optional", {}, true],
  [
    "optional public ID matches",
    "optional",
    { orderId: "reservation-id" },
    true,
  ],
  [
    "optional public ID mismatches",
    "optional",
    { orderId: "other-reservation-id" },
    false,
  ],
] as const)(
  "%s",
  (_description: string, publicOrderIdPolicy:
    | "required"
    | "optional", params: Readonly<
    Record<string, string>
  >, shouldPass: boolean) => {
    const assertion = validateSignedPayUrlForTest(
      makeSignedPayUrl({ params }),
      publicOrderIdPolicy
    );
    if (shouldPass) {
      expect(assertion).not.toThrow();
    } else {
      expect(assertion).toThrow("signed pay URL order id mismatch");
    }
  }
);

test.each([
  [
    "pay state token is missing",
    {},
    false,
    "/en-US/checkout/pay",
    "pay state token missing",
  ],
  [
    "pay state token is empty",
    { payState: "" },
    true,
    "/en-US/checkout/pay",
    "pay state token missing",
  ],
  [
    "pay path does not match",
    { orderId: "reservation-id" },
    true,
    "/en-US/checkout/not-pay",
    "signed pay URL path mismatch",
  ],
])(
  "rejects %s",
  (_description: string, params: Readonly<
    Record<string, string>
  >, includePayState: boolean, pathname: string, message: string) => {
    const url = makeSignedPayUrl({
      includePayState,
      params,
      pathname,
    });
    expect(validateSignedPayUrlForTest(url, "required")).toThrow(message);
  }
);

test.each([
  discountCodeQueryParam,
  "duration",
  "email",
  "message",
  "name",
  "phone",
  referralCodeQueryParam,
  "startDateTime",
] as const)("rejects leaked public query parameter %s", (key: string) => {
  expect(
    validateSignedPayUrlForTest(
      makeSignedPayUrl({
        params: { orderId: "reservation-id", [key]: "leaked-value" },
      }),
      "required"
    )
  ).toThrow(`signed pay URL leaked public query parameter ${key}`);
});

test("makes a fresh well-formed referral code for the unusable link", () => {
  const first = makeUnusableReferralCode();
  const second = makeUnusableReferralCode();
  expect(first).toMatch(/^RFL[0-9A-F]{12}$/);
  expect<string | undefined>(parseReferralCode(first)).toBe(first);
  expect(second).not.toBe(first);
});
