"use client";

import { Analytics } from "@vercel/analytics/react";
import { useCookieConsent } from "../hooks/use-cookie-consent";
import { PostHogAnalytics } from "./posthog-analytics";

type ConsentAwareAnalyticsProps = {
  posthogEnvironment: string;
};

export function ConsentAwareAnalytics({
  posthogEnvironment,
}: ConsentAwareAnalyticsProps) {
  const { isAccepted } = useCookieConsent();
  const analyticsAccepted = isAccepted("analytics");

  return (
    <>
      {analyticsAccepted ? <Analytics /> : null}
      <PostHogAnalytics
        analyticsAccepted={analyticsAccepted}
        posthogEnvironment={posthogEnvironment}
      />
    </>
  );
}
