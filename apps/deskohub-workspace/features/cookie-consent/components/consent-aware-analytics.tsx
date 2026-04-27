"use client";

import { Analytics } from "@vercel/analytics/react";
import { useCookieConsent } from "../hooks/use-cookie-consent";

export function ConsentAwareAnalytics() {
  const { isAccepted } = useCookieConsent();

  if (!isAccepted("analytics")) {
    return null;
  }

  return <Analytics />;
}
