import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { Duration } from "effect";
import { payStateTokenQueryParam } from "@/features/checkout/backend/checkout/pay-state";
import type { WorkspaceActionOptions } from "@/shared/backend/workspace-action";
import type { ApplyDiscountCodeResult } from "./apply-discount-code-to-pay-state";

mock.module("server-only", () => ({}));

const redirectMock = mock((_url: string) => {
  throw new Error("NEXT_REDIRECT");
});

mock.module("next/navigation", () => ({
  redirect: redirectMock,
  RedirectType: { replace: "replace" },
  unstable_rethrow: () => undefined,
  notFound: () => {
    throw new Error("NEXT_HTTP_ERROR_FALLBACK;404");
  },
  permanentRedirect: () => {
    throw new Error("NEXT_REDIRECT");
  },
}));

// The wrapper's action pipeline is covered by the pay-state action tests;
// here the sealed result is stubbed so the redirect routing is what runs.
mock.module("@/shared/backend/workspace-action", () => ({
  defineWorkspaceAction:
    (_options: WorkspaceActionOptions<never>, _handler: never) => async () => ({
      data: operationResult,
    }),
  workspaceActionDeadline: Duration.seconds(45),
}));

let operationResult: ApplyDiscountCodeResult;

const runForm = async (
  result: ApplyDiscountCodeResult,
  input: {
    readonly locale?: string;
    readonly payStateToken: string;
    readonly submittedCode?: string;
  }
) => {
  operationResult = result;
  redirectMock.mockClear();
  const { applyDiscountCodeForm } = await import("./apply-discount-code");
  const formData = new FormData();
  formData.set("submittedCode", input.submittedCode ?? "save20");

  let redirectError: unknown;
  try {
    await applyDiscountCodeForm(
      // Server Action arguments are untrusted; tests may tamper with them.
      (input.locale ?? "en-US") as Parameters<typeof applyDiscountCodeForm>[0],
      input.payStateToken,
      formData
    );
  } catch (error) {
    redirectError = error;
  }

  expect(redirectError).toBeInstanceOf(Error);
  expect((redirectError as Error).message).toBe("NEXT_REDIRECT");
  expect(redirectMock).toHaveBeenCalledTimes(1);
  return redirectMock.mock.calls[0]?.[0] as string;
};

describe("applyDiscountCodeForm", () => {
  test.each(["accepted", "already_accepted"] as const)(
    "redirects a referral %s result to its fresh signed summary",
    async (status) => {
      const freshPayUrl = "/en-US/checkout/pay?payState=fresh-referral-state";
      const redirectedUrl = await runForm(
        { status, freshPayUrl },
        { payStateToken: "original-token", submittedCode: "RFL12345" }
      );

      expect(redirectedUrl).toBe(`${freshPayUrl}&referralApplied=1`);
    }
  );

  test.each(["applied", "pricing_changed"] as const)(
    "does not carry referral feedback onto an ordinary %s URL",
    async (status) => {
      const freshPayUrl = "/en-US/checkout/pay?payState=fresh-ordinary-state";
      const redirectedUrl = await runForm(
        { status, freshPayUrl },
        { payStateToken: "original-token", submittedCode: "SAVE20" }
      );

      expect(redirectedUrl).toBe(freshPayUrl);
    }
  );

  test("falls back to the original-token pay URL when no replacement is returned", async () => {
    const redirectedUrl = await runForm(
      { status: "unavailable" },
      { payStateToken: "original-token" }
    );

    expect(redirectedUrl).toContain("payState=original-token");
    expect(redirectedUrl).toContain("discountCodeError=unavailable");
    expect(redirectedUrl).toContain("discountCodeErrorId=");
  });

  test("routes an automated request back to the Pay path with its error", async () => {
    const redirectedUrl = await runForm(
      { status: "automated_request" },
      { payStateToken: "original-token" }
    );
    const url = new URL(redirectedUrl, "https://deskohub.test");

    expect(url.pathname).toBe("/en-US/checkout/pay");
    expect(url.searchParams.get(payStateTokenQueryParam)).toBe(
      "original-token"
    );
    expect(url.searchParams.get("discountCodeError")).toBe("automated-request");
    expect(url.searchParams.get("discountCodeErrorId")).toBeTruthy();
  });

  test.each([
    ["already_attributed", "referral-already-attributed"],
    ["ineligible", "referral-ineligible"],
  ] as const)(
    "routes the %s referral rejection to its explained field error",
    async (status, discountCodeError) => {
      const redirectedUrl = await runForm(
        { status },
        { payStateToken: "original-token", submittedCode: "RFL12345" }
      );
      const url = new URL(redirectedUrl, "https://deskohub.test");

      expect(url.pathname).toBe("/en-US/checkout/pay");
      expect(url.searchParams.get(payStateTokenQueryParam)).toBe(
        "original-token"
      );
      expect(url.searchParams.get("discountCodeError")).toBe(discountCodeError);
      expect(url.searchParams.get("discountCodeErrorId")).toBeTruthy();
      expect(url.searchParams.has("referralApplied")).toBe(false);
      expect(redirectedUrl).not.toContain("RFL12345");
    }
  );

  test("never redirects off-site when the action is invoked with a tampered locale", async () => {
    const redirectedUrl = await runForm(
      { status: "unavailable" },
      { locale: "/evil.example", payStateToken: "original-token" }
    );

    expect(redirectedUrl.startsWith("//")).toBe(false);
    expect(redirectedUrl).not.toContain("evil.example");
    expect(redirectedUrl).toMatch(/^\/[a-z]{2}(-[A-Z]{2})?\/checkout\/pay\?/);
  });
});
