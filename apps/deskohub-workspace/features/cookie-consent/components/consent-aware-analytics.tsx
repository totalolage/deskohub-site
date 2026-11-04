"use client";

import type { PostHogFeatureFlagOverrides } from "@deskohub/posthog/feature-flags";
import { Analytics } from "@vercel/analytics/react";
import type { PostHogFeatureFlagDefinitions } from "@/features/feature-flags/generated/contract";
import type { DeploymentEnvironment } from "@/shared/deployment/deployment-stage";
import { sanitizeVercelAnalyticsEvent } from "../utils/vercel-analytics";
import { useVisitorConsent } from "../visitor-consent";
import { PostHogAnalytics } from "./posthog-analytics";

type ConsentAwareAnalyticsProps = {
  featureFlagOverrides?: PostHogFeatureFlagOverrides<PostHogFeatureFlagDefinitions>;
  posthogEnvironment: DeploymentEnvironment;
};

export function ConsentAwareAnalytics({
  featureFlagOverrides,
  posthogEnvironment,
}: ConsentAwareAnalyticsProps) {
  const analyticsAccepted = useVisitorConsent("analytics");

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
