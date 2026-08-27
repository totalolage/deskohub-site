"use client";

import posthog from "posthog-js";
import { useEffect, useRef } from "react";
import { useCookieConsent } from "@/features/cookie-consent";

export function DiscountRejectionAnalytics() {
  const { isAccepted } = useCookieConsent();
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;
    if (!isAccepted("analytics")) return;
    posthog.capture("pre-payment outcome", { outcome: "discount_rejected" });
  }, [isAccepted]);

  return null;
}
