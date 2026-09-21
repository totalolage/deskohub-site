import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { Effect, Schema } from "effect";
import {
  buildSignedPayState,
  openPayState,
  payStateTokenQueryParam,
  sealPayState,
} from "@/features/checkout/backend/checkout/pay-state";
import { buildCoworkReservationQuote } from "@/features/checkout/checkout-quote.test-utils";
import { canonicalPromotionCodeSchema } from "@/features/discounts/contracts";
import type { WorkspaceActionOptions } from "@/shared/backend/workspace-action";
import type { ApplyDiscountCodeResult } from "./apply-discount-code-to-pay-state";

mock.module("server-only", () => ({}));

const reservation = {
  kind: "cowork" as const,
  entryTier: "basic" as const,
  coffee: false,
  date: "2026-08-04",
  name: "Ada Lovelace",
  email: "ada@example.test",
  phone: "+420777000111",
};
const quote = buildCoworkReservationQuote(reservation);

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
}));

let operationResult: ApplyDiscountCodeResult;

const makeTokenWithRequestedIntent = async () => {
  const state = await Effect.runPromise(
    Effect.gen(function* () {
      return yield* buildSignedPayState({
        locale: "en-US",
        reservation,
        quote,
        orderId: "reservation-id",
        checkoutSessionId: "checkout-session-id",
        requestedDiscountCode: Schema.decodeUnknownSync(
          canonicalPromotionCodeSchema
        )("SAVE20"),
      });
    })
  );
  return await Effect.runPromise(sealPayState(state));
};

const runForm = async (
  result: ApplyDiscountCodeResult,
  input: { readonly payStateToken: string; readonly submittedCode?: string }
) => {
  operationResult = result;
  redirectMock.mockClear();
  const { applyDiscountCodeForm } = await import("./apply-discount-code");
  const formData = new FormData();
  formData.set("submittedCode", input.submittedCode ?? "save20");

  let redirectError: unknown;
  try {
    await applyDiscountCodeForm("en-US", input.payStateToken, formData);
  } catch (error) {
    redirectError = error;
  }

  expect(redirectError).toBeInstanceOf(Error);
  expect((redirectError as Error).message).toBe("NEXT_REDIRECT");
  expect(redirectMock).toHaveBeenCalledTimes(1);
  return redirectMock.mock.calls[0]?.[0] as string;
};

describe("applyDiscountCodeForm", () => {
  test("routes an invalid canonical attempt to the replacement token without plaintext", async () => {
    const replacementToken = await makeTokenWithRequestedIntent();
    const freshPayUrl = `/en-US/checkout/pay?${payStateTokenQueryParam}=${replacementToken}&discountCodeError=unavailable&discountCodeErrorId=attempt-1`;

    const redirectedUrl = await runForm(
      { status: "unavailable", freshPayUrl },
      { payStateToken: "original-token", submittedCode: " save20 " }
    );

    expect(redirectedUrl).toBe(freshPayUrl);
    expect(redirectedUrl).toContain("discountCodeError=unavailable");
    expect(redirectedUrl).not.toContain("SAVE20");
    expect(redirectedUrl).not.toContain("save20");
    const opened = await Effect.runPromise(openPayState(replacementToken));
    expect(opened.requestedDiscountCode).toBe("SAVE20");
    expect(opened.submittedCode).toBeUndefined();
    expect(opened.submittedCodeDiscountId).toBeUndefined();
  });

  test("keeps the original-token correction route for a malformed code", async () => {
    const redirectedUrl = await runForm(
      { status: "unavailable" },
      { payStateToken: "original-token", submittedCode: "not valid!" }
    );

    expect(redirectedUrl).toContain("payState=original-token");
    expect(redirectedUrl).toContain("discountCodeError=unavailable");
    expect(redirectedUrl).toContain("discountCodeErrorId=");
  });
});
