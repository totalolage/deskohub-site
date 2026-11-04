import { Layer } from "effect";
import { recordServerAnalytics } from "@/shared/backend/analytics/server-analytics.service.mock";
import { CheckoutAnalytics } from "./checkout-analytics.service";

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
