import { describe, expect, test } from "bun:test";
import { Effect, Exit, Layer } from "effect";
import { ReferralServiceWithoutData } from "@/features/referrals/referral.service.mock";
import { ReferralReleaseGate } from "@/features/referrals/referral-release-gate";
import { DiscountService, makeDiscountServiceLayer } from "./discount.service";
import { DiscountReleaseGateService } from "./discount-release-gate.service";

// The composition DiscountService.Live uses, with its process-wide provider
// cache, over the real referral service on unavailable data.
const discountsLive = makeDiscountServiceLayer({
  service: DiscountService.Default,
  releaseGates: Layer.succeed(DiscountReleaseGateService, {
    evaluate: () =>
      Effect.succeed({
        calendarSales: false,
        customerDiscounts: false,
        discountCodes: false,
      }),
  }),
  referrals: ReferralServiceWithoutData,
});

/** One request: its own referral decision, recorded each time it is read. */
const quoteInRequest = (
  request: string,
  released: boolean,
  consulted: string[]
) =>
  DiscountService.pipe(
    Effect.flatMap((discounts) =>
      discounts.quote({
        product: { kind: "cowork", tier: "basic" },
        discountableSubtotal: { value: 10_000, exponent: 2, currency: "CZK" },
        lastServiceDate: "2026-07-20",
        bookedAt: Temporal.Instant.from("2026-07-20T10:00:00Z"),
        locale: "en-US",
        dotyposCustomerId: "customer-lifetime" as never,
      })
    ),
    Effect.provide(
      discountsLive.pipe(
        Layer.provide(
          ReferralReleaseGate.fromEvaluation(
            Effect.sync(() => {
              consulted.push(request);
              return released;
            })
          )
        )
      )
    ),
    Effect.exit,
    Effect.runPromise
  );

describe("DiscountService.Live lifetime", () => {
  test("gives every request its own referral decision", async () => {
    const consulted: string[] = [];

    // Released: referral pricing reads recorded referrals, which this test
    // makes unavailable, so the quote dies there.
    const first = await quoteInRequest("first", true, consulted);
    // Withheld: no referral read, so the quote succeeds without referrals.
    const second = await quoteInRequest("second", false, consulted);
    const third = await quoteInRequest("third", true, consulted);

    expect(Exit.isFailure(first)).toBe(true);
    expect(second).toMatchObject({ _tag: "Success", value: { discounts: [] } });
    expect(Exit.isFailure(third)).toBe(true);
    // Each request read only its own decision.
    expect([...new Set(consulted)]).toEqual(["first", "second", "third"]);
  });
});
