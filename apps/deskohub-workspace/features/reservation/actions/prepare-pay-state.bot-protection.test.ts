import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { m } from "@/features/i18n";

// The real action boundary runs outside a Next request.
const nextServer = await import("next/server");
mock.module("server-only", () => ({}));
mock.module("next/server", () => ({ ...nextServer, after: () => {} }));
mock.module("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, getAll: () => [] }),
  headers: async () => new Headers({ referer: "https://deskohub.test/en-US" }),
}));

const checkBotId = mock(async () => ({
  isHuman: false,
  isBot: true,
  isVerifiedBot: false,
  bypassed: false,
}));
mock.module("botid/server", () => ({ checkBotId }));
mock.module("@/shared/backend/bot-protection/bot-protection.runtime", () => ({
  isWorkspaceBotIdEnforcedAtRuntime: () => true,
}));

const { preparePayState } = await import("./prepare-pay-state");

describe("preparePayState", () => {
  test("rejects a bot with BotID before the booking operation runs", async () => {
    const result = await preparePayState({
      locale: "en-US",
      checkoutSessionId: "synthetic-checkout-session",
      checkoutAttemptId: "synthetic-checkout-attempt",
      advertisedPriceToken: "synthetic-advertised-price-token",
      customer: "account",
      reservation: {
        kind: "cowork",
        entryTier: "open-space",
        date: "2099-07-01",
        coffee: false,
        name: "Synthetic Customer",
        email: testEmailAddress("synthetic.bot"),
        phone: "+420 777 777 777",
        billing: { purpose: "personal", invoice: "none" },
      },
    } as never);

    expect(checkBotId).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      serverError: m.automatedRequestRejected({}, { locale: "en-US" }),
    });
  });
});
