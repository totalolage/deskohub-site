"use client";

import type { PostHogFeatureFlagOverrides } from "@deskohub/posthog/feature-flags";
import { Analytics } from "@vercel/analytics/react";
import type { PostHogFeatureFlagDefinitions } from "@/features/feature-flags/generated/contract";
import { useCookieConsent } from "../hooks/use-cookie-consent";
import { sanitizeVercelAnalyticsEvent } from "../utils/vercel-analytics";
import { PostHogAnalytics } from "./posthog-analytics";

type ConsentAwareAnalyticsProps = {
  featureFlagOverrides?: PostHogFeatureFlagOverrides<PostHogFeatureFlagDefinitions>;
  posthogEnvironment: string;
};

export function ConsentAwareAnalytics({
  featureFlagOverrides,
  posthogEnvironment,
}: ConsentAwareAnalyticsProps) {
  const { isAccepted } = useCookieConsent();
  const analyticsAccepted = isAccepted("analytics");

  return (
    <PostHogAnalytics
      analyticsAccepted={analyticsAccepted}
      featureFlagOverrides={featureFlagOverrides}
      posthogEnvironment={posthogEnvironment}
    >
      {analyticsAccepted && (
        <Analytics beforeSend={sanitizeVercelAnalyticsEvent} />
      )}
    </PostHogAnalytics>
  );
}
