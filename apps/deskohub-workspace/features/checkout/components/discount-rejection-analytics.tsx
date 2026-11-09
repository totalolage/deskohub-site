"use client";

import { useEffect, useRef } from "react";
import { visitorConsent } from "@/features/cookie-consent";
import { captureAnalyticsEvent } from "@/features/cookie-consent/analytics-events";

export function DiscountRejectionAnalytics() {
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;
    if (!visitorConsent.accepts("analytics")) return;
    captureAnalyticsEvent("pre-payment outcome", {
      outcome: "discount_rejected",
    });
  }, []);

  return null;
}
