"use client";

import { Analytics } from "@vercel/analytics/react";
import type { ReactNode } from "react";
import { useCookieConsent } from "../hooks/use-cookie-consent";
import { PostHogAnalytics } from "./posthog-analytics";

type ConsentAwareAnalyticsProps = {
  children: ReactNode;
  posthogEnvironment: string;
};

export function ConsentAwareAnalytics({
  children,
  posthogEnvironment,
}: ConsentAwareAnalyticsProps) {
  const { isAccepted } = useCookieConsent();
  const analyticsAccepted = isAccepted("analytics");

  return (
    <PostHogAnalytics
      analyticsAccepted={analyticsAccepted}
      posthogEnvironment={posthogEnvironment}
    >
      {analyticsAccepted && <Analytics />}
      {children}
    </PostHogAnalytics>
  );
}
