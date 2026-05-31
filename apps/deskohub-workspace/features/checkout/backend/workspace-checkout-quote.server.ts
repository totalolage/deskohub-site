import { DotyposService } from "@deskohub/dotypos";
import { Effect, Layer } from "effect";
import { getConfirmedDotyposCustomerDiscount } from "@/features/checkout/backend/dotypos-customer-policy";
import { buildWorkspaceCheckoutQuote } from "@/features/checkout/checkout-quote";
import type { ReservationOrderData } from "@/features/reservation/schemas/reservation";
import { DotyposRuntimeConfigLive } from "@/shared/backend/config/dotypos.config";
import { runWorkspaceEffect } from "@/shared/backend/logging/censorship";
import { getNexiCheckoutCurrencyOverride } from "./checkout.service";

export const WorkspaceCheckoutQuoteLive = Layer.provide(
  DotyposService.Default,
  DotyposRuntimeConfigLive
).pipe(Layer.orDie);

export const buildAuthoritativeWorkspaceCheckoutQuoteEffect = Effect.fn(
  "buildAuthoritativeWorkspaceCheckoutQuote"
)(function* (reservation: ReservationOrderData) {
  const customerDiscount =
    yield* getConfirmedDotyposCustomerDiscount(reservation);

  return buildWorkspaceCheckoutQuote(reservation, {
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
