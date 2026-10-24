import type { Properties } from "posthog-js";
import { isConsentCategoryAcceptedInCookie } from "@/shared/utils/consent-cookie";
import { createOutbox } from "@/shared/utils/outbox";

/** A browser analytics event, captured in PostHog once analytics is ready. */
export interface AnalyticsEvent {
  readonly event: string;
  readonly properties?: Properties;
}

// The PostHog SDK loads only after consent, so events captured before it is
// ready wait here instead of being lost.
const outbox = createOutbox<AnalyticsEvent>({ capacity: 50 });

/**
 * Captures a browser analytics event. Without analytics consent nothing is
 * kept. With consent, the event goes out once PostHog is loaded and its
 * identity has settled, after any events captured earlier on this page.
 */
export const captureAnalyticsEvent = (
  event: string,
  properties?: Properties
): void => {
  if (
    globalThis.document === undefined ||
    !isConsentCategoryAcceptedInCookie(globalThis.document.cookie, "analytics")
  ) {
    return;
  }

  outbox.post(properties === undefined ? { event } : { event, properties });
};

/**
 * Attaches the sink that sends analytics events, first those captured while
 * no sink was attached. Returns the detach function.
 */
export const deliverAnalyticsEvents = (
  sink: (event: AnalyticsEvent) => void
): (() => void) => outbox.attach(sink);

/** Drops events still waiting for a sink, such as after consent withdrawal. */
export const discardAnalyticsEvents = (): void => outbox.discard();
