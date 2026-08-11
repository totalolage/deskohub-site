import "@/shared/testing/workspace-test-env";
import { describe, expect, mock, test } from "bun:test";
import { Cause, Effect, Exit, Layer, Schema } from "effect";
import { buildCoworkReservationQuote } from "@/features/checkout/reservation-quote-cowork";
import { buildOfficeReservationQuote } from "@/features/checkout/reservation-quote-office";
import {
  discountAdvertisementQuoteCodec,
  discountIdSchema,
} from "@/features/discounts/contracts";
import { WorkspaceFeatureFlagServiceMock } from "@/features/feature-flags/backend/workspace-feature-flag.service.mock";
import { OfficeReservationFeatureFlagService } from "@/features/office/backend/office-reservation-feature-flag.service";
import { CheckoutPricingServiceMock } from "./checkout-pricing.service.mock";

mock.module("server-only", () => ({}));

const { openAdvertisedPriceState } = await import("./advertised-price-state");
const { buildAdvertisedPrice } = await import("./advertised-price.server");

const money = (value: number) => ({
  value,
  exponent: 2,
  currency: "CZK",
});

describe("buildAdvertisedPrice", () => {
  test("rejects office price issuance while the office flag is disabled", async () => {
    const input = {
      locale: "en-US" as const,
      reservation: {
        kind: "office" as const,
        details: {
          kind: "office" as const,
          startsOn: "2099-06-10",
          endsOn: "2099-06-11",
          seats: 3,
        },
      },
    };
    const quoteAdvertisement = mock((request) =>
      buildOfficeReservationQuote(request.reservation.details).pipe(
        Effect.map((quote) => ({
          kind: "office" as const,
          reservation: input.reservation,
          quote,
        }))
      )
    );

    const result = await buildAdvertisedPrice(input).pipe(
      Effect.provide(
        Layer.merge(
          CheckoutPricingServiceMock({ quoteAdvertisement }),
          OfficeReservationFeatureFlagService.Live.pipe(
            Layer.provide(
              WorkspaceFeatureFlagServiceMock({
                isEnabled: mock(() => Effect.succeed(false)),
              })
            )
          )
        )
      ),
      Effect.runPromiseExit
    );

    expect(Exit.isFailure(result)).toBe(true);
    if (Exit.isFailure(result)) {
      expect(Cause.squash(result.cause)).toMatchObject({
        _tag: "OfficeReservationsDisabledError",
      });
    }
    expect(quoteAdvertisement).not.toHaveBeenCalled();
  });

  test("seals the source-neutral quote returned by pricing", async () => {
    const discountQuote = discountAdvertisementQuoteCodec.make({
      product: { kind: "cowork", tier: "basic" },
      discountableSubtotal: money(35_000),
      discounts: [
        {
          discount: {
            id: Schema.decodeUnknownSync(discountIdSchema)("summer-sale"),
            label: "Summer sale",
            adjustment: { kind: "percentage", basisPoints: 5000 },
          },
          subtotalBefore: money(35_000),
          amount: money(17_500),
          subtotalAfter: money(17_500),
        },
      ],
      totalDiscount: money(17_500),
      discountedSubtotal: money(17_500),
    });
    const quoteAdvertisement = mock((request) =>
      buildCoworkReservationQuote(request.reservation.details, {
        discountQuote,
      }).pipe(
        Effect.map((quote) => ({
          kind: "cowork" as const,
          reservation: request.reservation,
          quote,
        }))
      )
    );
    const input = {
      locale: "en-US" as const,
      reservation: {
        kind: "cowork" as const,
        details: {
          kind: "cowork" as const,
          entryTier: "basic" as const,
          coffee: true,
          date: "2026-07-30",
        },
      },
    };
    const evaluateOfficeReservationsEnabled = mock(() => false);

    const result = await buildAdvertisedPrice(input).pipe(
      Effect.provide(
        Layer.merge(
          CheckoutPricingServiceMock({ quoteAdvertisement }),
          OfficeReservationFeatureFlagService.Live.pipe(
            Layer.provide(
              WorkspaceFeatureFlagServiceMock({
                isEnabled: () => Effect.sync(evaluateOfficeReservationsEnabled),
              })
            )
          )
        )
      ),
      Effect.runPromise
    );
    const state = await openAdvertisedPriceState(
      result.advertisedPriceToken
    ).pipe(Effect.runPromise);

    expect(quoteAdvertisement).toHaveBeenCalledWith({
      reservation: input.reservation,
      locale: "en-US",
    });
    expect(evaluateOfficeReservationsEnabled).not.toHaveBeenCalled();
    expect(result.kind).toBe("cowork");
    if (result.kind !== "cowork") {
      throw new Error("Expected a cowork advertised price.");
    }
    expect(result.summary.total).toEqual(money(22_500));
    expect(state.kind).toBe("cowork");
    expect(state.reservation).toEqual(input.reservation);
    expect(state.quote).toEqual(result.quote);
    expect(JSON.stringify(result)).not.toMatch(
      /providerNamespace|providerReference|calendarId|eventReference|storedDiscountId|operatorTitle|dotyposCustomerId|submittedCode/
    );
  });
});
