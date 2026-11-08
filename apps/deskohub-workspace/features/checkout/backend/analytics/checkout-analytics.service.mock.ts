import { Effect, Layer, Option } from "effect";
import { recordServerAnalytics } from "@/shared/backend/analytics/server-analytics.service.mock";
import {
  CheckoutAnalytics,
  type ICheckoutAnalytics,
} from "./checkout-analytics.service";
import {
  type IReservationAnalyticsPerson,
  ReservationAnalyticsPerson,
} from "./reservation-analytics-person";

/** No reservation's events join a person, as for an author without consent. */
const noLinkedAccount: IReservationAnalyticsPerson["linkedAccount"] = () =>
  Effect.succeed(Option.none());

/**
 * The real checkout analytics over a recording delivery: `messages` holds
 * each event as PostHog would receive it. `linkedAccount` answers whose
 * person a reservation's lifecycle events join; by default no one's.
 */
export const recordCheckoutAnalytics = (
  linkedAccount: IReservationAnalyticsPerson["linkedAccount"] = noLinkedAccount
) => {
  const recorder = recordServerAnalytics();
  return {
    layer: CheckoutAnalytics.Default.pipe(
      Layer.provide(
        Layer.mergeAll(
          recorder.layer,
          Layer.succeed(ReservationAnalyticsPerson, { linkedAccount })
        )
      )
    ),
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
