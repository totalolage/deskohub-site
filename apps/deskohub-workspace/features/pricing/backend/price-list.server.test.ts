import "@/shared/testing/workspace-test-env";

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { Effect } from "effect";
import type { DiscountReleaseGates } from "@/features/discounts/discount-release-gate.service";
import type { PostHogFeatureFlagKey } from "@/features/feature-flags/generated/contract";

// Outside a Next.js render there is no cache; record what each load asks of
// it instead.
const nextCache = await import("next/cache");
const cacheLife = mock(
  (_profile: Parameters<typeof nextCache.cacheLife>[0]) => {}
);
mock.module("next/cache", () => ({ ...nextCache, cacheLife }));

// Inside `"use cache"`, Next.js fails the render on any request read, even
// one the app catches. Record each read instead.
const headers = mock(() => {
  throw new Error("headers() was read inside a cached render");
});
const nextHeaders = await import("next/headers");
mock.module("next/headers", () => ({ ...nextHeaders, headers }));

// The flags that are the same for every visitor; any other is decided per
// visitor.
let constantFlags: Partial<Record<PostHogFeatureFlagKey, boolean>> = {};
mock.module(
  "@/features/feature-flags/backend/feature-flag-evaluation-mode.server",
  () => ({
    getGlobalWorkspaceFeatureFlagValues: () => Promise.resolve(undefined),
    getGlobalWorkspaceFeatureFlagValue: (key: PostHogFeatureFlagKey) =>
      Promise.resolve(constantFlags[key]),
  })
);

// Record the discount gates the shared list prices under. No quote answers,
// so every product keeps its catalog price.
const pricedUnder: DiscountReleaseGates[] = [];
const { CheckoutPricingServiceMock } = await import(
  "@/features/checkout/backend/checkout/checkout-pricing.service.mock"
);
const pricing = await import(
  "@/features/checkout/backend/checkout/checkout-pricing.service"
);
class TestCheckoutPricingService extends pricing.CheckoutPricingService {
  static override withDiscountReleaseGates = (gates: DiscountReleaseGates) => {
    pricedUnder.push(gates);
    return CheckoutPricingServiceMock({
      quoteAdvertisement: () => Effect.die(new Error("Pricing is unavailable")),
    });
  };
}
mock.module(
  "@/features/checkout/backend/checkout/checkout-pricing.service",
  () => ({ ...pricing, CheckoutPricingService: TestCheckoutPricingService })
);

const { loadSharedPriceList } = await import("./price-list.server");

const kinds = (offerings: ReadonlyArray<{ readonly kind: string }>) =>
  new Set(offerings.map(({ kind }) => kind));

beforeEach(() => {
  constantFlags = {};
  pricedUnder.length = 0;
  cacheLife.mockClear();
  headers.mockClear();
});

describe("loadSharedPriceList", () => {
  test("lists the office and prices sales under gates that are the same for every visitor", async () => {
    constantFlags = {
      office_page: true,
      calendar_sales: true,
      customer_discounts: false,
      discount_codes: false,
    };

    const { offerings, variesByVisitor } = await loadSharedPriceList("en-US");

    expect(kinds(offerings)).toEqual(
      new Set(["cowork", "meeting-room", "office"])
    );
    expect(pricedUnder).toEqual([
      { calendarSales: true, customerDiscounts: false, discountCodes: false },
    ]);
    expect(variesByVisitor).toBe(false);
    expect(cacheLife.mock.calls).toEqual([["minutes"]]);
    expect(headers).not.toHaveBeenCalled();
  });

  test("keeps a gate decided per visitor closed without reading the request", async () => {
    constantFlags = {
      calendar_sales: true,
      customer_discounts: false,
      discount_codes: false,
    };

    const { offerings, variesByVisitor } = await loadSharedPriceList("cs-CZ");

    expect(kinds(offerings)).toEqual(new Set(["cowork", "meeting-room"]));
    expect(variesByVisitor).toBe(true);
    expect(headers).not.toHaveBeenCalled();
  });

  test("withholds sales while the Calendar sales gate is decided per visitor", async () => {
    constantFlags = {
      office_page: false,
      customer_discounts: false,
      discount_codes: false,
    };

    const { offerings, variesByVisitor } = await loadSharedPriceList("en-US");

    expect(kinds(offerings)).toEqual(new Set(["cowork", "meeting-room"]));
    expect(pricedUnder).toEqual([
      { calendarSales: false, customerDiscounts: false, discountCodes: false },
    ]);
    expect(variesByVisitor).toBe(true);
    expect(headers).not.toHaveBeenCalled();
  });
});
