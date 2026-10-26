"use client";

import { useEffect, useRef } from "react";
import { useCookieConsent } from "@/features/cookie-consent";
import { captureAnalyticsEvent } from "@/features/cookie-consent/analytics-events";

export function DiscountRejectionAnalytics() {
  const { isAccepted } = useCookieConsent();
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;
    if (!isAccepted("analytics")) return;
    captureAnalyticsEvent("pre-payment outcome", {
      outcome: "discount_rejected",
    });
  }, [isAccepted]);

  return null;
}
