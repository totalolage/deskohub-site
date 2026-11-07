import "@/shared/testing/workspace-test-env";

import { beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { Effect, Predicate } from "effect";
import { payStateTokenQueryParam } from "@/features/checkout/backend/checkout/pay-state";
import { customerAgentNames } from "@/shared/bot-protection/customer-agents";
import { mockWorkspaceActionRequest } from "@/shared/testing/workspace-action-request.test-utils";

mock.module("server-only", () => ({}));
// The real action boundary runs outside a Next request.
const request = await mockWorkspaceActionRequest({ botId: "bot" });

const { BotProtectionService } = await import(
  "@/shared/backend/bot-protection/bot-protection.service"
);
// The action boundary provides this same service object, so the spy sees the
// wrapper's call and still runs the real screening.
const botProtection = Effect.runSync(
  Effect.service(BotProtectionService).pipe(
    Effect.provide(BotProtectionService.Default)
  )
);
const verifyHuman = spyOn(botProtection, "verifyHuman");

const { applyDiscountCodeForm } = await import("./apply-discount-code");

/** Not a sealed Pay state: opening it fails if the action gets that far. */
const unsealedPayStateToken = "not-a-sealed-pay-state";

/** Submits the form and returns where it redirected. */
const submitCode = async () => {
  const formData = new FormData();
  formData.set("submittedCode", "SAVE20");
  try {
    await applyDiscountCodeForm("en-US", unsealedPayStateToken, formData);
  } catch (signal) {
    const digest = Predicate.hasProperty(signal, "digest")
      ? signal.digest
      : undefined;
    if (!Predicate.isString(digest)) throw signal;
    const redirectPath = /^NEXT_REDIRECT;\w+;(.*);\d+;$/.exec(digest)?.[1];
    if (redirectPath !== undefined) {
      return new URL(redirectPath, "https://deskohub.test");
    }
    throw signal;
  }
  throw new Error("Expected a redirect");
};

beforeEach(() => {
  request.reset();
  verifyHuman.mockClear();
});

describe("applyDiscountCodeForm", () => {
  test("rejects a bot with BotID before the Pay state or the code is checked", async () => {
    const url = await submitCode();

    expect(request.checkBotId).toHaveBeenCalledTimes(1);
    expect(verifyHuman).toHaveBeenCalledTimes(1);
    expect(verifyHuman).toHaveBeenCalledWith({
      verificationFailurePolicy: "deny",
      verifiedBots: { allow: customerAgentNames },
      callSite: "checkout.apply-discount-code",
    });
    expect(url.pathname).toBe("/en-US/checkout/pay");
    expect(url.searchParams.get(payStateTokenQueryParam)).toBe(
      unsealedPayStateToken
    );
    expect(url.searchParams.get("discountCodeError")).toBe("automated-request");
  });

  test("lets a verified customer agent through to the Pay-state check", async () => {
    request.checkBotId.mockImplementation(() =>
      Promise.resolve({
        isHuman: false,
        isBot: true,
        isVerifiedBot: true,
        verifiedBotName: customerAgentNames[0],
        verifiedBotCategory: "ai_assistant",
        bypassed: false,
      } as never)
    );

    const url = await submitCode();

    expect(request.checkBotId).toHaveBeenCalledTimes(1);
    // The unsealed token fails as an ordinary unavailable code.
    expect(url.searchParams.get("discountCodeError")).toBe("unavailable");
  });
});
