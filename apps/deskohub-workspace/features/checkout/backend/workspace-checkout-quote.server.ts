import { DotyposService } from "@deskohub/dotypos";
import { Effect, Layer } from "effect";
import { getConfirmedDotyposCustomerDiscount } from "@/features/checkout/backend/dotypos-customer-policy";
import { buildWorkspaceCheckoutQuoteEffect } from "@/features/checkout/checkout-quote";
import type { ReservationOrderData } from "@/features/reservation/schemas/reservation";
import { DotyposRuntimeConfigLive } from "@/shared/backend/config/dotypos.config";
import { runWorkspaceEffect } from "@/shared/backend/logging/censorship";
import { getNexiCheckoutCurrencyOverride } from "./checkout.service";

export const WorkspaceCheckoutQuoteLive = Layer.provide(
  DotyposService.Default,
  DotyposRuntimeConfigLive
);

export const buildAuthoritativeWorkspaceCheckoutQuoteEffect = Effect.fn(
  "buildAuthoritativeWorkspaceCheckoutQuote"
)(function* (reservation: ReservationOrderData) {
  const customerDiscount =
    yield* getConfirmedDotyposCustomerDiscount(reservation);

  return yield* buildWorkspaceCheckoutQuoteEffect(reservation, {
    customerDiscount,
    currencyOverride: getNexiCheckoutCurrencyOverride(),
  });
});

export const buildAuthoritativeWorkspaceCheckoutQuote = (
  reservation: ReservationOrderData
) =>
  buildAuthoritativeWorkspaceCheckoutQuoteEffect(reservation).pipe(
    Effect.provide(WorkspaceCheckoutQuoteLive),
    runWorkspaceEffect
  );
