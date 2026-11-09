import { Context, Effect } from "effect";
import type { EmailDeliveryId } from "../types/email.types";
import type { EmailSendError } from "./capabilities";
import type { EmailStream } from "./email-providers";

/** A provider accepted one message. */
export interface EmailSentEvent {
  readonly provider: string;
  readonly deliveryId: EmailDeliveryId;
  readonly stream: EmailStream;
  readonly category: string | undefined;
  readonly tags: readonly string[];
  readonly metadata: Readonly<Record<string, unknown>> | undefined;
  readonly idempotencyKey: string | undefined;
  readonly at: Date;
}

/** A provider failed one message at the provider level and the next one tries it. */
export interface EmailFallbackEvent {
  readonly stream: EmailStream;
  readonly category: string | undefined;
  readonly failedProvider: string;
  readonly nextProvider: string;
  readonly errorKind: EmailSendError["_tag"];
  readonly errorCode: string | undefined;
  readonly at: Date;
}

/**
 * Watches deliveries. The email service awaits each call before it returns,
 * and logs and drops any failure or defect, so an observer never fails a
 * send.
 */
export interface EmailDeliveryObserver {
  readonly onSent: (event: EmailSentEvent) => Effect.Effect<void>;
  readonly onFallback: (event: EmailFallbackEvent) => Effect.Effect<void>;
}

/**
 * Runs one observer call; a failure, a defect, or a synchronous throw while
 * building the call is logged, never raised.
 */
export const observeEmailDelivery = (observation: () => Effect.Effect<void>) =>
  Effect.suspend(observation).pipe(
    Effect.catchCause(() => Effect.logWarning("Email delivery observer failed"))
  );

const sentLogFacts = (event: EmailSentEvent) => ({
  provider: event.provider,
  deliveryId: event.deliveryId,
  stream: event.stream,
  category: event.category,
});

const fallbackLogFacts = (event: EmailFallbackEvent) => ({
  stream: event.stream,
  category: event.category,
  failedProvider: event.failedProvider,
  nextProvider: event.nextProvider,
  errorKind: event.errorKind,
  errorCode: event.errorCode,
});

/** Observes nothing beyond a log line of non-personal facts per event. */
const none: EmailDeliveryObserver = {
  onSent: (event) =>
    Effect.logDebug("Email delivery observed", sentLogFacts(event)),
  onFallback: (event) =>
    Effect.logInfo("Email provider fallback observed", fallbackLogFacts(event)),
};

/** Passes each event to every observer in order; one failing skips none. */
const all = (
  observers: ReadonlyArray<EmailDeliveryObserver>
): EmailDeliveryObserver => ({
  onSent: (event) =>
    Effect.forEach(
      observers,
      (observer) => observeEmailDelivery(() => observer.onSent(event)),
      { discard: true }
    ),
  onFallback: (event) =>
    Effect.forEach(
      observers,
      (observer) => observeEmailDelivery(() => observer.onFallback(event)),
      { discard: true }
    ),
});

/** The delivery observer; without one provided, `EmailDeliveryObserver.none`. */
export const EmailDeliveryObserver = Object.assign(
  Context.Reference<EmailDeliveryObserver>(
    "@deskohub/email/EmailDeliveryObserver",
    { defaultValue: () => none }
  ),
  { none, all }
);
