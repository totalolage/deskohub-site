"use client";

import type { PostHogFeatureFlagOverrides } from "@deskohub/posthog/feature-flags";
import { PostHogProvider } from "@posthog/react";
import posthog, { type BeforeSendFn } from "posthog-js";
import { type ReactNode, useEffect } from "react";
import { env } from "@/env";
import type { PostHogFeatureFlagDefinitions } from "@/features/feature-flags/generated/contract";
import { applyFeatureFlagOverrides } from "@/features/feature-flags/react";
import {
  createPostHogSessionClearCookieStrings,
  createPostHogSessionCookieStrings,
  writePostHogSessionCookie,
} from "@/shared/utils/posthog-session-cookies";
import { sanitizePostHogProperties } from "../utils/posthog-url";

const DEFAULT_POSTHOG_HOST = "https://us.i.posthog.com";

let hasInitializedPostHog = false;
let analyticsSendingEnabled = false;

type PostHogBeforeSendEvent = NonNullable<Parameters<BeforeSendFn>[0]>;

function sanitizePostHogEvent(
  event: PostHogBeforeSendEvent,
  posthogEnvironment: string
) {
  event.properties = sanitizePostHogProperties(
    event.properties,
    posthogEnvironment
  );

  return event;
}

type PostHogAnalyticsProps = {
  analyticsAccepted: boolean;
  children: ReactNode;
  featureFlagOverrides?: PostHogFeatureFlagOverrides<PostHogFeatureFlagDefinitions>;
  posthogEnvironment: string;
};

export function PostHogAnalytics({
  analyticsAccepted,
  children,
  featureFlagOverrides,
  posthogEnvironment,
}: PostHogAnalyticsProps) {
  const posthogProjectToken = env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;

  return (
    <PostHogProvider client={posthog}>
      {posthogProjectToken && (
        <PostHogClient
          analyticsAccepted={analyticsAccepted}
          featureFlagOverrides={featureFlagOverrides}
          posthogEnvironment={posthogEnvironment}
          posthogHost={env.NEXT_PUBLIC_POSTHOG_HOST ?? DEFAULT_POSTHOG_HOST}
          posthogProjectToken={posthogProjectToken}
        />
      )}
      {children}
    </PostHogProvider>
  );
}

type PostHogClientProps = {
  analyticsAccepted: boolean;
  featureFlagOverrides?: PostHogFeatureFlagOverrides<PostHogFeatureFlagDefinitions>;
  posthogEnvironment: string;
  posthogHost: string;
  posthogProjectToken: string;
};

function PostHogClient({
  analyticsAccepted,
  featureFlagOverrides,
  posthogEnvironment,
  posthogHost,
  posthogProjectToken,
}: PostHogClientProps) {
  useEffect(() => {
    if (!analyticsAccepted) {
      analyticsSendingEnabled = false;
      if (hasInitializedPostHog) {
        posthog.set_config({ tracing_headers: [] });
        posthog.stopSessionRecording();
        posthog.opt_out_capturing();
        posthog.reset(true);
      }
      return;
    }

    analyticsSendingEnabled = true;

    if (!hasInitializedPostHog) {
      posthog.init(posthogProjectToken, {
        api_host: posthogHost,
        before_send: (event) => {
          if (!event) return event;

          const sanitizedEvent = sanitizePostHogEvent(
            event,
            posthogEnvironment
          );
          if (!analyticsSendingEnabled) return null;

          return sanitizedEvent;
        },
        capture_pageleave: true,
        capture_pageview: "history_change",
        defaults: "2026-01-30",
        internal_or_test_user_hostname: null,
        opt_out_useragent_filter: process.env.NODE_ENV === "development",
        person_profiles: "identified_only",
        session_recording: {
          maskAllInputs: true,
          maskTextSelector: "body",
        },
        tracing_headers: [window.location.hostname],
      });
      posthog.stopSessionRecording();
      hasInitializedPostHog = true;
    } else {
      posthog.set_config({ tracing_headers: [window.location.hostname] });
    }

    applyFeatureFlagOverrides(posthog, featureFlagOverrides);
    posthog.opt_in_capturing();
    posthog.startSessionRecording();
  }, [
    analyticsAccepted,
    featureFlagOverrides,
    posthogEnvironment,
    posthogHost,
    posthogProjectToken,
  ]);

  useEffect(() => {
    if (!analyticsAccepted) {
      for (const cookie of createPostHogSessionClearCookieStrings()) {
        writePostHogSessionCookie(cookie);
      }
      return;
    }

    if (!hasInitializedPostHog) return;

    const syncSessionCookies = (sessionId = posthog.get_session_id()) => {
      for (const cookie of createPostHogSessionCookieStrings({
        distinctId: posthog.get_distinct_id(),
        sessionId,
      })) {
        writePostHogSessionCookie(cookie);
      }
    };

    syncSessionCookies();
    const unsubscribe = posthog.onSessionId(syncSessionCookies);

    return () => {
      unsubscribe();
    };
  }, [analyticsAccepted]);

  return null;
}
