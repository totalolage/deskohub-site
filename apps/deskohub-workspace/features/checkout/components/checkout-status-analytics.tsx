"use client";

import { useEffect, useRef } from "react";
import type { CheckoutStatusKind } from "@/features/checkout/checkout-status-kind";
import { useVisitorConsent } from "@/features/cookie-consent";
import { captureAnalyticsEvent } from "@/features/cookie-consent/analytics-events";
import { CHECKOUT_STATUS_VIEWED_EVENT } from "@/features/reservation/reservation-analytics";

/**
 * Captures each status the page shows to a consented browser, once per page
 * visit. Polling refreshes the route in place and keeps this component, so a
 * refresh that shows the same status captures nothing. A status seen before
 * the visitor consents is captured once they do. A page the router restores
 * from its cache, such as on back navigation, keeps what it captured.
 */
export function CheckoutStatusAnalytics({
  status,
}: {
  readonly status: CheckoutStatusKind;
}) {
  const analyticsAccepted = useVisitorConsent("analytics");
  const captured = useRef(new Set<CheckoutStatusKind>());

  useEffect(() => {
    if (!analyticsAccepted || captured.current.has(status)) return;
    captured.current.add(status);
    captureAnalyticsEvent(CHECKOUT_STATUS_VIEWED_EVENT, { status });
  }, [analyticsAccepted, status]);

  return null;
}
