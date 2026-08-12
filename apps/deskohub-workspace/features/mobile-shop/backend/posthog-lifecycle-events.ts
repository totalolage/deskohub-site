import {
  PostHogDistinctId,
  PostHogEventId,
} from "@deskohub/posthog/identifiers";
import { Effect } from "effect";
import {
  type PostHogEventProperties,
  PostHogEventService,
} from "@/shared/backend/analytics/posthog-event.service";
import type {
  MobileShopPaymentRecord,
  MobileShopPaymentTransition,
} from "./purchase-lifecycle.repository";

const paymentProperties = (
  payment: MobileShopPaymentRecord
): PostHogEventProperties => ({
  purchase_id: payment.order.id,
  payment_attempt_id: payment.attempt.id,
  provider: "nexi",
  ...(payment.attempt.providerOrderId && {
    provider_order_id: payment.attempt.providerOrderId,
  }),
  amount_value: payment.attempt.amountValue,
  amount_exponent: payment.attempt.amountExponent,
  currency: payment.attempt.currency,
});

const capturePaymentEvent = (input: {
  readonly payment: MobileShopPaymentRecord;
  readonly event: string;
  readonly timestamp: Temporal.Instant;
  readonly properties?: PostHogEventProperties;
}) =>
  Effect.gen(function* () {
    const posthog = yield* PostHogEventService;
    yield* posthog.capture({
      distinctId: PostHogDistinctId.make(input.payment.order.id),
      event: input.event,
      properties: {
        ...paymentProperties(input.payment),
        ...input.properties,
      },
      timestamp: input.timestamp,
      uuid: PostHogEventId.make(`${input.payment.attempt.id}:${input.event}`),
    });
  });

export const captureMobileShopPaymentStarted = (
  payment: MobileShopPaymentRecord
) =>
  capturePaymentEvent({
    payment,
    event: "mobile shop payment started",
    timestamp: payment.attempt.updatedAt,
  });

export const captureMobileShopPaymentCompleted = (
  transition: MobileShopPaymentTransition
) =>
  capturePaymentEvent({
    payment: transition.payment,
    event: "mobile shop payment completed",
    timestamp: transition.timestamp,
  });

export const captureMobileShopPaymentTerminal = (
  transition: MobileShopPaymentTransition
) =>
  capturePaymentEvent({
    payment: transition.payment,
    event:
      transition.payment.attempt.state === "failed"
        ? "mobile shop payment failed"
        : "mobile shop payment abandoned",
    timestamp: transition.timestamp,
    properties: {
      failure_code: transition.payment.attempt.failureCode,
      provider_status: transition.payment.attempt.lastProviderStatus,
    },
  });
