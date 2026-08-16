import "@/shared/testing/workspace-test-env";
import { describe, expect, mock, test } from "bun:test";
import {
  DotyposCategoryIdSchema,
  DotyposCustomerIdSchema,
  DotyposProductIdSchema,
} from "@deskohub/dotypos";
import { Effect, Layer, Schema } from "effect";
import type { WorkspaceMoney } from "@/features/checkout/workspace-money";
import { workspaceGoodsProductIdentitySchema } from "@/features/goods";
import { CalendarDiscountProviderMock } from "./calendar-discount-provider.service.mock";
import { type Discount, discountIdSchema } from "./contracts";
import { CustomerDiscountProviderMock } from "./customer-discount-provider.service.mock";
import {
  DiscountService,
  type DisplayedGoodsBasketDiscountAffirmationInput,
} from "./discount.service";
import { DiscountReleaseGateServiceMock } from "./discount-release-gate.service.mock";
import { PromotionCodeProviderMock } from "./promotion-code-provider.service.mock";
import type {
  DiscountCandidate,
  GoodsBasketDiscountCandidate,
} from "./provider";

const money = (value: number): WorkspaceMoney => ({
  value,
  exponent: 2,
  currency: "CZK",
});
const discountId = Schema.decodeUnknownSync(discountIdSchema);
const products = ["a", "b", "c"].map((id) =>
  workspaceGoodsProductIdentitySchema.make({
    kind: "goods",
    categoryId: DotyposCategoryIdSchema.make("category"),
    productId: DotyposProductIdSchema.make(`product-${id}`),
  })
);
const lines = products.map((product, index) => ({
  product,
  discountableSubtotal: money((index + 1) * 100),
}));
const basketInput = {
  lines,
  reservationDate: "2026-08-16",
  locale: "en-US" as const,
  dotyposCustomerId: DotyposCustomerIdSchema.make("customer-1"),
};
const candidate = (
  id: string,
  adjustment: Discount["adjustment"]
): DiscountCandidate => ({
  discount: { id: discountId(id), label: id, adjustment },
  provenance: { providerNamespace: "test", providerReference: id },
});
const selection = (
  discount: DiscountCandidate,
  eligibleLineIndexes = [0, 1, 2]
): GoodsBasketDiscountCandidate => ({
  candidate: discount,
  eligibleLineIndexes,
});

const run = <A, E>(
  effect: Effect.Effect<A, E, DiscountService>,
  input: {
    readonly calendar: ReturnType<typeof CalendarDiscountProviderMock>;
    readonly customer?: ReturnType<typeof CustomerDiscountProviderMock>;
    readonly code?: ReturnType<typeof PromotionCodeProviderMock>;
  }
) =>
  effect.pipe(
    Effect.provide(
      DiscountService.Default.pipe(
        Layer.provide(
          Layer.mergeAll(
            input.calendar,
            input.customer ?? CustomerDiscountProviderMock(),
            input.code ?? PromotionCodeProviderMock(),
            DiscountReleaseGateServiceMock({
              evaluate: () =>
                Effect.succeed({
                  calendarSales: true,
                  customerDiscounts: true,
                  discountCodes: true,
                }),
            })
          )
        )
      )
    ),
    Effect.runPromise
  );

describe("DiscountService goods baskets", () => {
  test("quotes and freshly affirms each provider once per basket", async () => {
    let calendarResolution = 0;
    const revalidateGoodsBasket = mock(() => {
      calendarResolution += 1;
      return Effect.succeed([
        selection(
          candidate("sale", {
            kind: "percentage",
            basisPoints: calendarResolution === 1 ? 1000 : 2000,
          })
        ),
      ]);
    });
    const resolveGoodsBasket = mock(() => Effect.succeed([]));
    const revalidateCodeBasket = mock(() => Effect.succeed([]));
    const layers = {
      calendar: CalendarDiscountProviderMock({ revalidateGoodsBasket }),
      customer: CustomerDiscountProviderMock({ resolveGoodsBasket }),
      code: PromotionCodeProviderMock({
        revalidateGoodsBasket: revalidateCodeBasket,
      }),
    };

    const displayedQuote = await run(
      Effect.gen(function* () {
        const discounts = yield* DiscountService;
        return yield* discounts.quoteGoodsBasket(basketInput);
      }),
      layers
    );
    const affirmationInput: DisplayedGoodsBasketDiscountAffirmationInput = {
      ...basketInput,
      displayedDiscountIds: [discountId("sale")],
    };
    const affirmed = await run(
      Effect.gen(function* () {
        const discounts = yield* DiscountService;
        return yield* discounts.affirmDisplayedGoodsBasketDiscounts(
          affirmationInput
        );
      }),
      layers
    );

    expect(displayedQuote.totalDiscount.value).toBe(60);
    expect(affirmed.quote.totalDiscount.value).toBe(120);
    expect(revalidateGoodsBasket).toHaveBeenCalledTimes(2);
    expect(resolveGoodsBasket).toHaveBeenCalledTimes(2);
    expect(revalidateCodeBasket).toHaveBeenCalledTimes(2);
  });

  test("preserves displayed discount order during affirmation", async () => {
    const fixed = selection(
      candidate("fixed", { kind: "fixed", amount: money(100) })
    );
    const half = selection(
      candidate("half", { kind: "percentage", basisPoints: 5000 })
    );
    const result = await run(
      Effect.gen(function* () {
        const discounts = yield* DiscountService;
        return yield* discounts.affirmDisplayedGoodsBasketDiscounts({
          ...basketInput,
          displayedDiscountIds: [discountId("half"), discountId("fixed")],
        });
      }),
      {
        calendar: CalendarDiscountProviderMock({
          revalidateGoodsBasket: () => Effect.succeed([fixed, half]),
        }),
        customer: CustomerDiscountProviderMock({
          resolveGoodsBasket: () => Effect.succeed([]),
        }),
        code: PromotionCodeProviderMock({
          revalidateGoodsBasket: () => Effect.succeed([]),
        }),
      }
    );

    expect(result.quote.totalDiscount.value).toBe(400);
    expect(
      result.quote.lines[0]?.discounts.map(({ discount }) => discount.id)
    ).toEqual([discountId("half"), discountId("fixed")]);
  });
});
