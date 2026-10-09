import "@/shared/polyfills/temporal";
import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { GoogleCalendarServiceMock } from "@deskohub/google-calendar/backend/service.mock";
import { Effect, Layer, Schema } from "effect";
import { getWorkspaceOfficePrice } from "@/features/checkout/product-catalog";
import { CalendarDiscountProvider } from "@/features/discounts/calendar-discount-provider.service";
import { discountAdvertisementQuoteCodec } from "@/features/discounts/contracts";
import { CustomerDiscountProviderMock } from "@/features/discounts/customer-discount-provider.service.mock";
import { DiscountService } from "@/features/discounts/discount.service";
import { DiscountServiceMock } from "@/features/discounts/discount.service.mock";
import { DiscountDefinitionRepositoryMock } from "@/features/discounts/discount-definition.repository.mock";
import { DiscountReleaseGateServiceMock } from "@/features/discounts/discount-release-gate.service.mock";
import { storedDiscountIdSchema } from "@/features/discounts/persistence-contracts";
import { PromotionCodeProviderMock } from "@/features/discounts/promotion-code-provider.service.mock";
import {
  getOfficeAdvertisedPriceReservation,
  officeReservationOrderSchema,
} from "@/features/reservation/office-reservation";
import { getCurrentWorkspaceDate } from "@/features/reservation/reservation-date";
import {
  CalendarResourceConfig,
  salesCalendarIdSchema,
  workspaceLimitationsCalendarIdSchema,
} from "@/shared/backend/config/calendar-resource.config";
import { officeCheckoutPricing } from "./office-checkout-pricing";

const startsOn = getCurrentWorkspaceDate().add({ days: 1 });
const reservation = Schema.decodeUnknownSync(officeReservationOrderSchema)({
  kind: "office",
  startsOn: startsOn.toString(),
  endsOn: startsOn.add({ days: 1 }).toString(),
  seats: 3,
  name: "Ada Lovelace",
  email: "ada@example.com",
  phone: "+420 777 777 777",
});
const advertisedReservation = getOfficeAdvertisedPriceReservation(reservation);
const product = { kind: "office", seats: 3, dayCount: 2 } as const;
const money = getWorkspaceOfficePrice(product);
const advertisementQuote = discountAdvertisementQuoteCodec.make({
  product,
  discountableSubtotal: money,
  discounts: [],
  totalDiscount: { ...money, value: 0 },
  discountedSubtotal: money,
});

const saleDiscountId = Schema.decodeUnknownSync(storedDiscountIdSchema)(
  "019bfe6e-8ef0-7def-8b16-55cfbc82edc1"
);
const saleLastDay = startsOn.add({ days: 1 });

/**
 * Real discount service and calendar provider over a synthetic all-day sale
 * that started yesterday and whose last day is the day after `startsOn`.
 */
const calendarSaleDiscounts = Layer.mergeAll(
  CalendarDiscountProvider.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        GoogleCalendarServiceMock({
          listEvents: () =>
            Effect.succeed([
              {
                id: "office-range-sale",
                summary: "Synthetic office sale",
                description: saleDiscountId,
                start: { date: startsOn.subtract({ days: 2 }).toString() },
                end: { date: saleLastDay.add({ days: 1 }).toString() },
              },
            ]),
        }),
        DiscountDefinitionRepositoryMock({
          loadById: ({ discountId }) =>
            Effect.succeed({
              id: discountId,
              labels: { "en-US": "Office sale", "cs-CZ": "Sleva na kanceláře" },
              adjustment: { kind: "percentage", basisPoints: 2000 },
              products: [{ kind: "office" }],
            }),
        }),
        Layer.succeed(CalendarResourceConfig, {
          salesCalendarId: Schema.decodeUnknownSync(salesCalendarIdSchema)(
            "office-range-sales-calendar"
          ),
          workspaceLimitationsCalendarId: Schema.decodeUnknownSync(
            workspaceLimitationsCalendarIdSchema
          )("office-range-limitations-calendar"),
        })
      )
    )
  ),
  CustomerDiscountProviderMock(),
  PromotionCodeProviderMock(),
  DiscountReleaseGateServiceMock({
    evaluate: () =>
      Effect.succeed({
        calendarSales: true,
        customerDiscounts: true,
        discountCodes: true,
      }),
  })
);

const runWithDiscounts = <A, E>(
  effect: Effect.Effect<A, E, DiscountService>,
  discounts: ReturnType<typeof DiscountServiceMock>
) => effect.pipe(Effect.provide(discounts), Effect.runPromise);

describe("office checkout pricing", () => {
  test("quotes with the exact seat and inclusive-day product identity", async () => {
    const discoverAdvertisedDiscounts = mock(() =>
      Effect.succeed(advertisementQuote)
    );

    const result = await runWithDiscounts(
      Effect.gen(function* () {
        const pricing = yield* officeCheckoutPricing;
        return yield* pricing.quoteAdvertisement({
          reservation: advertisedReservation,
          locale: "en-US",
        });
      }),
      DiscountServiceMock({ discoverAdvertisedDiscounts })
    );

    expect(discoverAdvertisedDiscounts).toHaveBeenCalledWith({
      product,
      discountableSubtotal: money,
      lastServiceDate: reservation.endsOn,
      locale: "en-US",
      bookedAt: expect.any(Temporal.Instant),
    });
    expect(result.quote.payment.expectedPrice).toEqual(money);
  });

  test.each([
    ["ends on the sale's last day", 1, 1],
    ["extends past the sale's last day", 2, 0],
  ] as const)(
    "applies a calendar sale only when the office range %s",
    async (_label, extraDays, expectedDiscounts) => {
      const rangeReservation = Schema.decodeUnknownSync(
        officeReservationOrderSchema
      )({
        ...reservation,
        endsOn: startsOn.add({ days: extraDays }).toString(),
      });

      const result = await Effect.gen(function* () {
        const pricing = yield* officeCheckoutPricing;
        return yield* pricing.quoteAdvertisement({
          reservation: getOfficeAdvertisedPriceReservation(rangeReservation),
          locale: "en-US",
        });
      }).pipe(
        Effect.provide(
          DiscountService.Default.pipe(Layer.provide(calendarSaleDiscounts))
        ),
        Effect.runPromise
      );

      expect(result.quote.payment.discounts).toHaveLength(expectedDiscounts);
    }
  );
});
