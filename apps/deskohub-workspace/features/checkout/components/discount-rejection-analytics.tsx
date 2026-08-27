"use client";

import posthog from "posthog-js";
import { useEffect, useRef } from "react";
import { useCookieConsent } from "@/features/cookie-consent";

export function DiscountRejectionAnalytics() {
  const { isAccepted } = useCookieConsent();
  const captured = useRef(false);

  useEffect(() => {
    if (captured.current || !isAccepted("analytics")) return;
    captured.current = true;
    posthog.capture("pre-payment outcome", { outcome: "discount_rejected" });
  }, [isAccepted]);

  return null;
}
