import "@/shared/testing/workspace-test-env";

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { GoogleCalendarAPIError } from "@deskohub/google-calendar";
import { Effect, Layer } from "effect";
import type { PublicPriceListOffering } from "@/features/checkout/public-offerings";
import { calendarSaleDiscountServiceLayer } from "@/features/discounts/calendar-sale.test-utils";
import type { DiscountReleaseGates } from "@/features/discounts/discount-release-gate.service";
import type { PostHogFeatureFlagKey } from "@/features/feature-flags/generated/contract";
import { getCurrentWorkspaceDate } from "@/features/reservation/reservation-date";
import { recordNextCache } from "@/shared/testing/next-cache-recorder.test-utils";

// Outside a Next.js render there is no cache; record what each load asks of
// it instead.
const nextCacheModule = await import("next/cache");
const nextCache = recordNextCache();
mock.module("next/cache", () => ({ ...nextCacheModule, ...nextCache.module }));

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

// Record the discount gates the shared list prices under. Pricing reads a
// synthetic 20% Calendar sale on every product while the Calendar answers.
const pricedUnder: DiscountReleaseGates[] = [];
let calendarDown = false;
let pricingDefect: Error | undefined;
const pricing = await import(
  "@/features/checkout/backend/checkout/checkout-pricing.service"
);
class TestCheckoutPricingService extends pricing.CheckoutPricingService {
  static override withDiscountReleaseGates = (gates: DiscountReleaseGates) => {
    pricedUnder.push(gates);
    if (pricingDefect) {
      return Layer.effect(
        pricing.CheckoutPricingService,
        Effect.die(pricingDefect)
      );
    }
    return pricing.CheckoutPricingService.Default.pipe(
      Layer.provide(
        calendarSaleDiscountServiceLayer({
          calendarId: "shared-price-list-sale",
          firstDay: getCurrentWorkspaceDate(),
          lastDay: getCurrentWorkspaceDate(),
          labels: { "en-US": "Sale", "cs-CZ": "Sleva" },
          products: [
            { kind: "cowork" },
            { kind: "meeting-room" },
            { kind: "office" },
          ],
          listEvents: (saleEvents) =>
            calendarDown
              ? Effect.fail(
                  new GoogleCalendarAPIError({
                    operation: "listEvents",
                    message: "Calendar is unavailable.",
                  })
                )
              : Effect.succeed(saleEvents),
        })
      )
    );
  };
}
mock.module(
  "@/features/checkout/backend/checkout/checkout-pricing.service",
  () => ({ ...pricing, CheckoutPricingService: TestCheckoutPricingService })
);

const { loadSharedPriceList } = await import("./price-list.server");

const kinds = (offerings: ReadonlyArray<{ readonly kind: string }>) =>
  new Set(offerings.map(({ kind }) => kind));

const discounted = (offerings: ReadonlyArray<PublicPriceListOffering>) =>
  offerings.filter(({ advertisedPrice }) => advertisedPrice?.discount.value);

/** What the loader set for its own entry, after any nested cache's. */
const entryCalls = () => nextCache.calls.slice(-1);

beforeEach(() => {
  constantFlags = {};
  calendarDown = false;
  pricingDefect = undefined;
  pricedUnder.length = 0;
  nextCache.clear();
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
    expect(entryCalls()).toEqual([{ cacheLife: "minutes" }]);
    expect(headers).not.toHaveBeenCalled();
  });

  test("never keeps catalog fallback prices as long as advertised ones, and advertises the sale once the Calendar answers again", async () => {
    constantFlags = {
      office_page: true,
      calendar_sales: true,
      customer_discounts: false,
      discount_codes: false,
    };
    calendarDown = true;

    const failed = await loadSharedPriceList("en-US");

    expect(kinds(failed.offerings)).toEqual(
      new Set(["cowork", "meeting-room", "office"])
    );
    expect(discounted(failed.offerings)).toEqual([]);
    expect(failed.complete).toBe(false);
    // The page streams a fresh list over the fallback one.
    expect(failed.variesByVisitor).toBe(true);
    // Revalidated on the next request, yet still in the App Shell.
    expect(entryCalls()).toEqual([
      { cacheLife: { stale: 300, revalidate: 1, expire: 300 } },
    ]);

    calendarDown = false;
    nextCache.clear();

    const recovered = await loadSharedPriceList("en-US");

    expect(discounted(recovered.offerings)).toHaveLength(
      recovered.offerings.length
    );
    expect(recovered.complete).toBe(true);
    expect(recovered.variesByVisitor).toBe(false);
    expect(entryCalls()).toEqual([{ cacheLife: "minutes" }]);
  });

  test("shares the catalog prices as an incomplete list when the load fails", async () => {
    constantFlags = { office_page: true, calendar_sales: true };
    pricingDefect = new Error("synthetic pricing defect");

    const fallback = await loadSharedPriceList("en-US");

    expect(kinds(fallback.offerings)).toEqual(
      new Set(["cowork", "meeting-room"])
    );
    expect(discounted(fallback.offerings)).toEqual([]);
    expect(fallback.complete).toBe(false);
    expect(fallback.variesByVisitor).toBe(true);
    expect(entryCalls()).toEqual([
      { cacheLife: { stale: 300, revalidate: 1, expire: 300 } },
    ]);
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
