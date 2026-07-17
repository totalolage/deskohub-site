import { Effect } from "effect";
import {
  calculateWorkspaceCheckoutQuote,
  normalizeWorkspaceCheckoutOrder,
} from "@/features/checkout/checkout-quote";
import { getWorkspaceProductByTier } from "@/features/checkout/product-catalog";
import { withWorkspaceMoneyCurrency } from "@/features/checkout/workspace-money";
import {
  type CanonicalDiscountCode,
  DiscountService,
} from "@/features/discounts";
import type { Locale } from "@/features/i18n";
import type { NormalizedCoworkReservationOrder } from "@/features/reservation/cowork-reservation";
import { getNexiCheckoutCurrencyOverride } from "./checkout.service";

export const buildAuthoritativeWorkspaceCheckoutQuote = Effect.fn(
  "buildAuthoritativeWorkspaceCheckoutQuote"
)(
  function* (input: {
    readonly reservation: NormalizedCoworkReservationOrder;
    readonly dotyposCustomerId: string;
    readonly locale: Locale;
    readonly submittedCode: CanonicalDiscountCode | undefined;
  }) {
    yield* Effect.annotateLogsScoped({
      reservation: input.reservation,
      dotyposCustomerId: input.dotyposCustomerId,
      submittedCode: input.submittedCode,
    });
    yield* Effect.logInfo(
      "Workspace checkout quote discount resolution started"
    );

    const order = yield* normalizeWorkspaceCheckoutOrder(input.reservation);
    const currencyOverride = getNexiCheckoutCurrencyOverride();
    const product = getWorkspaceProductByTier(order.entryTier);
    const discountableSubtotal = withWorkspaceMoneyCurrency(
      product.price,
      currencyOverride
    );
    const discounts = yield* DiscountService;
    const discountQuote = yield* discounts.quote({
      product: { kind: "cowork", tier: order.entryTier },
      discountableSubtotal,
      reservationDate: input.reservation.date,
      dotyposCustomerId: input.dotyposCustomerId,
      locale: input.locale,
      submittedCode: input.submittedCode,
    });
    yield* Effect.annotateLogsScoped({ discountQuote });
    yield* Effect.logInfo("Workspace checkout quote discount resolved");

    const quote = yield* calculateWorkspaceCheckoutQuote(order, {
      discountQuote,
      currencyOverride,
    });
    yield* Effect.annotateLogsScoped({ quote });
    yield* Effect.logInfo("Authoritative workspace checkout quote built");

    return quote;
  },
  (effect) =>
    effect.pipe(
      Effect.scoped,
      Effect.tapError((cause) =>
        Effect.logError("Authoritative workspace checkout quote failed", {
          cause,
        })
      )
    )
);
