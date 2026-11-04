import { Effect, Layer } from "effect";
import { recordServerAnalytics } from "@/shared/backend/analytics/server-analytics.service.mock";
import {
  CheckoutAnalytics,
  type ICheckoutAnalytics,
} from "./checkout-analytics.service";

/**
 * The real checkout analytics over a recording delivery: `messages` holds
 * each event as PostHog would receive it.
 */
export const recordCheckoutAnalytics = () => {
  const recorder = recordServerAnalytics();
  return {
    layer: CheckoutAnalytics.Default.pipe(Layer.provide(recorder.layer)),
    messages: recorder.messages,
  };
};

/** Checkout analytics whose every event succeeds without being sent. */
export const silentCheckoutAnalytics: ICheckoutAnalytics = {
  reservationStarted: () => Effect.void,
  reservationAbandoned: () => Effect.void,
  reservationCompleted: () => Effect.void,
  reservationFulfilled: () => Effect.void,
  paymentStarted: () => Effect.void,
  paymentCompleted: () => Effect.void,
  paymentAbandoned: () => Effect.void,
  paymentFailed: () => Effect.void,
  availabilityResult: () => Effect.void,
  prePaymentOutcome: () => Effect.void,
};
