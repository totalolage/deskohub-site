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

const apiOrder = (
  id: string,
  createdAt: string,
  taxRegime:
    | { kind: "not-vat-payer" }
    | { kind: "vat-payer"; vatId: string } = { kind: "not-vat-payer" }
) => ({
  id,
  publicReference: `DW-${id}`,
  createdAt,
  paymentState: "paid",
  receiptState: "sent",
  taxRegime,
  total: { value: 2500, exponent: 2, currency: "CZK" },
  items:
    taxRegime.kind === "vat-payer"
      ? [
          {
            productId: "water",
            displayName: "Water",
            quantity: 1,
            unitPrice: { value: 2500, exponent: 2, currency: "CZK" },
            lineTotal: { value: 2500, exponent: 2, currency: "CZK" },
            tax: {
              kind: "vat",
              rateBasisPoints: 2100,
              taxAmount: { value: 434, exponent: 2, currency: "CZK" },
            },
          },
        ]
      : [],
});

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

describe("mobile catalog", () => {
  test("loads and maps products from the Workspace catalog endpoint", async () => {
    const originalFetch = globalThis.fetch;
    let requestedUrl: URL | undefined;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      requestedUrl = new URL(String(input));
      return Response.json({
        ok: true,
        data: {
          generatedAt: "2026-08-12T12:00:00.000Z",
          categories: [{ id: "drinks", name: "Cold drinks" }],
          products: [
            {
              id: "water",
              categoryId: "drinks",
              name: "Sparkling water",
              description: "Mineral water",
              unitLabel: "500 ml",
              imageUrl: "https://images.example.test/water.png",
              price: { value: 39, exponent: 0, currency: "CZK" },
            },
          ],
        },
      });
    }) as unknown as typeof fetch;

    try {
      const catalog = await createHttpShopApi(
        "https://preview.example.test"
      ).getCatalog("en");

      expect(requestedUrl?.pathname).toBe("/api/v1/mobile/catalog");
      expect(requestedUrl?.searchParams.get("locale")).toBe("en-US");
      expect(catalog.products).toEqual([
        {
          id: "water",
          categoryId: "drinks",
          name: { cs: "Sparkling water", en: "Sparkling water" },
          description: {
            cs: "Mineral water · 500 ml",
            en: "Mineral water · 500 ml",
          },
          imageUrl: "https://images.example.test/water.png",
          price: { currency: "CZK", minorUnits: 3900 },
        },
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
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

describe("mobile purchase history", () => {
  test("loads every server page", async () => {
    const originalFetch = globalThis.fetch;
    const cursor = "2026-08-12T10:00:00Z";
    const requestedCursors: (string | null)[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      const cursorParameter = url.searchParams.get("cursor");
      requestedCursors.push(cursorParameter);
      return Response.json({
        ok: true,
        data: cursorParameter
          ? { orders: [apiOrder("older", "2026-08-12T09:00:00Z")] }
          : {
              orders: [apiOrder("newer", "2026-08-12T11:00:00Z")],
              nextCursor: cursor,
            },
      });
    }) as unknown as typeof fetch;

    try {
      const purchases = await createHttpShopApi(
        "https://preview.example.test"
      ).listPurchases();
      expect(purchases.map(({ id }) => id)).toEqual(["newer", "older"]);
      expect(requestedCursors).toEqual([null, cursor]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("preserves the recorded VAT treatment", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () =>
      Response.json({
        ok: true,
        data: apiOrder("vat", "2026-08-12T11:00:00Z", {
          kind: "vat-payer",
          vatId: "CZ24531596",
        }),
      })) as unknown as typeof fetch;

    try {
      const purchase = await createHttpShopApi(
        "https://preview.example.test"
      ).getPurchase("vat");
      expect(purchase.seller).toMatchObject({
        vatId: "CZ24531596",
        taxTreatment: {
          kind: "vat_included",
          rateBasisPoints: 2100,
          taxMinorUnits: 434,
        },
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
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
