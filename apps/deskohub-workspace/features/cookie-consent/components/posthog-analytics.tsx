"use client";

import type { PostHogFeatureFlagOverrides } from "@deskohub/posthog/feature-flags";
import { PostHogClientProvider } from "@deskohub/posthog/feature-flags/react";
import { usePathname } from "next/navigation";
import { type ReactNode, useEffect } from "react";
import { getClientEnv } from "@/client-env";
import type { PostHogFeatureFlagDefinitions } from "@/features/feature-flags/generated/contract";
import type { DeploymentEnvironment } from "@/shared/deployment/deployment-stage";
import {
  type BrowserAnalyticsSettings,
  createBrowserAnalyticsSession,
} from "../browser-analytics-session";

const browserAnalyticsSession = createBrowserAnalyticsSession();

export function PostHogProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  return (
    <PostHogClientProvider client={browserAnalyticsSession.featureFlagClient}>
      {children}
    </PostHogClientProvider>
  );
}

type PostHogAnalyticsProps = {
  analyticsAccepted: boolean;
  children: ReactNode;
  featureFlagOverrides?: PostHogFeatureFlagOverrides<PostHogFeatureFlagDefinitions>;
  posthogEnvironment: DeploymentEnvironment;
};

export function PostHogAnalytics({
  analyticsAccepted,
  children,
  featureFlagOverrides,
  posthogEnvironment,
}: PostHogAnalyticsProps) {
  const pathname = usePathname();
  const clientEnv = getClientEnv();
  const posthogProjectToken = clientEnv.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;

  if (!posthogProjectToken) return children;

  return (
    <>
      <PostHogSession
        analyticsAccepted={analyticsAccepted}
        featureFlagOverrides={featureFlagOverrides}
        pathname={pathname}
        posthogEnvironment={posthogEnvironment}
        posthogHost={clientEnv.NEXT_PUBLIC_POSTHOG_HOST}
        posthogProjectToken={posthogProjectToken}
      />
      {children}
    </>
  );
}

function PostHogSession({
  analyticsAccepted,
  featureFlagOverrides,
  pathname,
  posthogEnvironment,
  posthogHost,
  posthogProjectToken,
}: BrowserAnalyticsSettings) {
  // Settings sync first, so connecting starts the SDK with this render's
  // consent, telemetry host, and flag overrides.
  useEffect(() => {
    browserAnalyticsSession.sync({
      analyticsAccepted,
      featureFlagOverrides,
      pathname,
      posthogEnvironment,
      posthogHost,
      posthogProjectToken,
    });
  }, [
    analyticsAccepted,
    featureFlagOverrides,
    pathname,
    posthogEnvironment,
    posthogHost,
    posthogProjectToken,
  ]);

  useEffect(() => browserAnalyticsSession.connect(), []);

  return null;
}
