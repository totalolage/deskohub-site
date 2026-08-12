import { describe, expect, test } from "bun:test";
import {
  DotyposCategoryIdSchema,
  DotyposProductIdSchema,
  DotyposReservationIdSchema,
} from "@deskohub/dotypos";
import { Effect, Layer } from "effect";
import {
  instantStringSchema,
  plainDateStringSchema,
} from "@/shared/utils/temporal";
import type {
  MobileShopAccount,
  MobileShopCatalog,
  MobileShopQuote,
} from "./contracts";
import { MobileShopFailure } from "./errors";
import { handleMobileShopApiRequest } from "./mobile-api.server";
import {
  type IMobileShopService,
  MobileShopService,
} from "./mobile-shop.service";

const categoryId = DotyposCategoryIdSchema.make("drinks");
const productId = DotyposProductIdSchema.make("water");
const catalog: MobileShopCatalog = {
  version: "catalog-v1",
  generatedAt: instantStringSchema.make("2026-08-11T10:00:00Z"),
  categories: [{ id: categoryId, name: "Drinks", order: 0 }],
  products: [
    {
      id: productId,
      categoryId,
      name: "Water",
      canonicalName: "Water",
      price: { value: 2500, exponent: 2, currency: "CZK" },
      version: "water-v1",
    },
  ],
};
const account: MobileShopAccount = {
  authenticated: true,
  webMutation: {
    headerName: "x-deskohub-csrf",
    headerValue: "1",
  },
  commerceIdentity: { kind: "linked" },
  entitlement: {
    kind: "eligible",
    day: plainDateStringSchema.make("2026-08-11"),
    reservationId: DotyposReservationIdSchema.make("reservation"),
    validUntil: instantStringSchema.make("2026-08-11T22:00:00Z"),
  },
};
const quote: MobileShopQuote = {
  fingerprint: "quote-v1",
  expiresAt: instantStringSchema.make("2026-08-11T10:05:00Z"),
  locale: "en-US",
  taxRegime: {
    kind: "not-vat-payer",
    version: "non-vat-v1",
    effectiveFrom: plainDateStringSchema.make("2026-01-01"),
  },
  items: [
    {
      productId,
      categoryId,
      productVersion: "water-v1",
      canonicalName: "Water",
      displayName: "Water",
      quantity: 1,
      unitPrice: { value: 2500, exponent: 2, currency: "CZK" },
      lineTotal: { value: 2500, exponent: 2, currency: "CZK" },
      tax: { kind: "not-applicable" },
    },
  ],
  total: { value: 2500, exponent: 2, currency: "CZK" },
};

const makeService = (
  overrides: Partial<IMobileShopService> = {}
): IMobileShopService => ({
  account: () => Effect.succeed(account),
  catalog: () => Effect.succeed(catalog),
  quote: () => Effect.succeed(quote),
  createOrder: () =>
    Effect.fail(new MobileShopFailure({ code: "payment_unavailable" })),
  history: () => Effect.succeed({ orders: [] }),
  order: () => Effect.fail(new MobileShopFailure({ code: "order_not_found" })),
  payment: () =>
    Effect.fail(new MobileShopFailure({ code: "payment_unavailable" })),
  ...overrides,
});

const runRequest = (request: Request, service = makeService()) =>
  Effect.runPromise(
    handleMobileShopApiRequest(request).pipe(
      Effect.provide(Layer.succeed(MobileShopService, service))
    )
  );

describe("mobile shop API boundary", () => {
  test("rejects foreign origins without reflecting them", async () => {
    const response = await runRequest(
      new Request("https://workspace.deskohub.cz/api/v1/mobile/account", {
        headers: { Origin: "https://evil.example" },
      })
    );
    expect(response.status).toBe(401);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(await response.json()).toEqual({
      ok: false,
      error: { code: "unauthorized" },
    });
  });

  test("supports credentialed canonical PWA preflight with a bounded cache", async () => {
    const response = await runRequest(
      new Request("https://workspace.deskohub.cz/api/v1/mobile/quotes", {
        method: "OPTIONS",
        headers: { Origin: "https://app.workspace.deskohub.cz" },
      })
    );
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(
      "https://app.workspace.deskohub.cz"
    );
    expect(response.headers.get("access-control-allow-credentials")).toBe(
      "true"
    );
    expect(response.headers.get("access-control-max-age")).toBe("600");
  });

  test("requires a same-site custom CSRF header for browser mutations", async () => {
    let called = false;
    const service = makeService({
      quote: () => {
        called = true;
        return Effect.succeed(quote);
      },
    });
    const response = await runRequest(
      new Request("https://app.workspace.deskohub.cz/api/v1/mobile/quotes", {
        method: "POST",
        headers: {
          Origin: "https://app.workspace.deskohub.cz",
          "Content-Type": "application/json",
          "Sec-Fetch-Site": "same-origin",
        },
        body: JSON.stringify({
          locale: "en-US",
          cart: [{ productId, quantity: 1 }],
        }),
      }),
      service
    );
    expect(response.status).toBe(401);
    expect(called).toBe(false);
  });

  test("allows native requests without an Origin and returns no-store envelopes", async () => {
    const response = await runRequest(
      new Request("https://workspace.deskohub.cz/api/v1/mobile/quotes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          locale: "en-US",
          cart: [{ productId, quantity: 1 }],
        }),
      })
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe(
      "private, no-store, max-age=0"
    );
    expect(await response.json()).toMatchObject({
      ok: true,
      data: { fingerprint: "quote-v1" },
    });
  });

  test("decodes a stable purchase-history cursor", async () => {
    let receivedCursor: unknown;
    const cursor = JSON.stringify(["2026-08-11T10:00:00Z", "purchase-2"]);
    const response = await runRequest(
      new Request(
        `https://workspace.deskohub.cz/api/v1/mobile/orders?cursor=${encodeURIComponent(cursor)}`
      ),
      makeService({
        history: (input) => {
          receivedCursor = Reflect.get(input, "cursor");
          return Effect.succeed({ orders: [] });
        },
      })
    );

    expect(response.status).toBe(200);
    expect(receivedCursor).toMatchObject({ id: "purchase-2" });
    expect(Reflect.get(receivedCursor as object, "createdAt").toString()).toBe(
      "2026-08-11T10:00:00Z"
    );
  });

  test("authenticates before honoring catalog ETags and marks them private", async () => {
    const response = await runRequest(
      new Request(
        "https://workspace.deskohub.cz/api/v1/mobile/catalog?locale=en-US",
        { headers: { "If-None-Match": '"catalog-v1"' } }
      )
    );
    expect(response.status).toBe(304);
    expect(response.headers.get("etag")).toBe('"catalog-v1"');
    expect(response.headers.get("cache-control")).toBe(
      "private, max-age=0, stale-while-revalidate=900"
    );
    expect(response.headers.get("vary")).toContain("Authorization");
    expect(response.headers.get("vary")).toContain("Accept-Language");
  });

  test("returns stable safe error codes without internal causes", async () => {
    const response = await runRequest(
      new Request("https://workspace.deskohub.cz/api/v1/mobile/catalog"),
      makeService({
        catalog: () =>
          Effect.fail(
            new MobileShopFailure({
              code: "catalog_unavailable",
              cause: new Error("provider details must stay private"),
            })
          ),
      })
    );
    const body = await response.text();
    expect(response.status).toBe(503);
    expect(body).toBe(
      JSON.stringify({
        ok: false,
        error: { code: "catalog_unavailable" },
      })
    );
    expect(body).not.toContain("provider details");
  });
});
