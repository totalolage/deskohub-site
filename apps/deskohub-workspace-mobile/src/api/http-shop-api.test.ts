import { describe, expect, mock, test } from "bun:test";

import type { CheckoutQuote } from "../domain/shop";
import { buildMobileApiUrl } from "./mobile-api-url";

let uuidSequence = 0;
let clearedNativeSessions = 0;
mock.module("expo-constants", () => ({ default: { expoConfig: {} } }));
mock.module("expo-crypto", () => ({
  randomUUID: () => `attempt-${++uuidSequence}`,
}));
mock.module("expo-secure-store", () => ({
  deleteItemAsync: async () => {
    clearedNativeSessions += 1;
  },
  getItemAsync: async () => null,
  setItemAsync: async () => undefined,
}));
mock.module("react-native", () => ({ Platform: { OS: "android" } }));

const { createHttpShopApi } = await import("./http-shop-api");

describe("mobile API URL building", () => {
  test("preserves deployment-scoped preview query parameters", () => {
    const url = buildMobileApiUrl(
      "https://preview.example.test/some/page?share=value&mode=preview",
      "/api/v1/mobile/catalog"
    );

    expect(url.pathname).toBe("/api/v1/mobile/catalog");
    expect(url.searchParams.get("share")).toBe("value");
    expect(url.searchParams.get("mode")).toBe("preview");
  });

  test("preserves duplicate parameters", () => {
    const url = buildMobileApiUrl(
      "https://preview.example.test?flag=one&flag=two",
      "/api/v1/mobile/session"
    );

    expect(url.searchParams.getAll("flag")).toEqual(["one", "two"]);
  });
});

describe("mobile checkout retries", () => {
  test("reuses the checkout attempt ID after an ambiguous order response", async () => {
    const originalFetch = globalThis.fetch;
    const attemptIds: string[] = [];
    let requestNumber = 0;
    globalThis.fetch = (async (
      _input: RequestInfo | URL,
      init?: RequestInit
    ) => {
      requestNumber += 1;
      if (requestNumber === 1) {
        return Response.json({
          ok: true,
          data: {
            authenticated: true,
            webMutation: { headerName: "x-shop-csrf", headerValue: "proof" },
            entitlement: {
              kind: "eligible",
              day: "2026-08-12",
              validUntil: "2026-08-12T22:00:00.000Z",
            },
          },
        });
      }

      const body = (init?.body ? JSON.parse(String(init.body)) : {}) as {
        checkoutAttemptId?: string;
      };
      if (body.checkoutAttemptId) attemptIds.push(body.checkoutAttemptId);
      if (requestNumber === 2) throw new Error("response lost");
      if (requestNumber === 3) {
        return Response.json({
          ok: true,
          data: {
            id: "order-1",
            publicReference: "DW-1",
            createdAt: "2026-08-12T12:00:00.000Z",
            paymentState: "not_started",
            receiptState: "not_started",
            total: { value: 39, exponent: 0, currency: "CZK" },
            items: [],
          },
        });
      }
      return Response.json({
        ok: true,
        data: {
          orderId: "order-1",
          hostedPageUrl: "https://payments.example.test/order-1",
        },
      });
    }) as unknown as typeof fetch;

    const quote: CheckoutQuote = {
      id: "quote-1",
      expiresAt: "2026-08-12T12:05:00.000Z",
      lines: [],
      total: { currency: "CZK", minorUnits: 3900 },
      seller: {
        legalName: "Desktechub s.r.o.",
        identificationNumber: "24531596",
        taxTreatment: { kind: "not_vat_payer" },
      },
    };
    const api = createHttpShopApi("https://preview.example.test");

    try {
      await expect(
        api.createHostedPayment(
          quote,
          [{ productId: "product-1", quantity: 1 }],
          "en"
        )
      ).rejects.toThrow("Network request failed");
      await api.createHostedPayment(
        quote,
        [{ productId: "product-1", quantity: 1 }],
        "en"
      );
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(attemptIds).toHaveLength(2);
    expect(attemptIds[1]).toBe(attemptIds[0]);
  });
});

describe("mobile sign out", () => {
  test("clears native state when the server cannot be reached", async () => {
    const originalFetch = globalThis.fetch;
    clearedNativeSessions = 0;
    let requestNumber = 0;
    globalThis.fetch = (async () => {
      requestNumber += 1;
      if (requestNumber === 1) {
        return Response.json({
          ok: true,
          data: {
            authenticated: true,
            webMutation: { headerName: "x-shop-csrf", headerValue: "proof" },
            entitlement: { kind: "locked", reason: "no_active_reservation" },
          },
        });
      }
      if (requestNumber === 2) throw new Error("offline");
      return Response.json(
        { ok: false, error: { code: "unauthorized" } },
        { status: 401 }
      );
    }) as unknown as typeof fetch;

    const api = createHttpShopApi("https://preview.example.test");

    try {
      expect((await api.getSession()).kind).toBe("signed_in");
      await expect(api.signOut()).rejects.toThrow("Network request failed");
      expect((await api.getSession()).kind).toBe("signed_out");
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(clearedNativeSessions).toBe(1);
  });
});
