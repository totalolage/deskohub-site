"use client";

import posthog, { type BeforeSendFn, type Properties } from "posthog-js";
import { useEffect } from "react";
import { env } from "@/env";
import {
  createPostHogSessionClearCookieStrings,
  createPostHogSessionCookieStrings,
  writePostHogSessionCookie,
} from "@/shared/utils/posthog-session-cookies";
import { createPostHogPageUrl } from "../utils/posthog-url";

const DEFAULT_POSTHOG_HOST = "https://us.i.posthog.com";
const MAX_QUEUED_EVENTS = 100;

let hasInitializedPostHog = false;
let analyticsSendingEnabled = false;
let queuedEvents: QueuedPostHogEvent[] = [];

type PostHogBeforeSendEvent = NonNullable<Parameters<BeforeSendFn>[0]>;

type QueuedPostHogEvent = {
  event: string;
  properties?: Properties;
};

function sanitizePostHogEvent(
  event: PostHogBeforeSendEvent,
  posthogEnvironment: string
) {
  event.properties = {
    ...event.properties,
    "deployment.environment.name": posthogEnvironment,
  };

  const currentUrl = event.properties?.$current_url;
  if (typeof currentUrl === "string") {
    event.properties.$current_url = createPostHogPageUrl(currentUrl);
  }

  return event;
}

function queuePostHogEvent(event: PostHogBeforeSendEvent) {
  if (queuedEvents.length >= MAX_QUEUED_EVENTS) {
    queuedEvents.shift();
  }

  queuedEvents.push({
    event: String(event.event),
    properties: event.properties ? { ...event.properties } : undefined,
  });
}

function flushQueuedPostHogEvents() {
  const events = queuedEvents;
  queuedEvents = [];

  for (const event of events) {
    posthog.capture(event.event, event.properties, { send_instantly: true });
  }
}

type PostHogAnalyticsProps = {
  analyticsAccepted: boolean;
  posthogEnvironment: string;
};

export function PostHogAnalytics({
  analyticsAccepted,
  posthogEnvironment,
}: PostHogAnalyticsProps) {
  const posthogProjectToken = env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;

  if (!posthogProjectToken) return null;

  return (
    <PostHogClient
      analyticsAccepted={analyticsAccepted}
      posthogEnvironment={posthogEnvironment}
      posthogHost={env.NEXT_PUBLIC_POSTHOG_HOST ?? DEFAULT_POSTHOG_HOST}
      posthogProjectToken={posthogProjectToken}
    />
  );
}

type PostHogClientProps = {
  analyticsAccepted: boolean;
  posthogEnvironment: string;
  posthogHost: string;
  posthogProjectToken: string;
};

function PostHogClient({
  analyticsAccepted,
  posthogEnvironment,
  posthogHost,
  posthogProjectToken,
}: PostHogClientProps) {
  useEffect(() => {
    if (!hasInitializedPostHog) {
      posthog.init(posthogProjectToken, {
        api_host: posthogHost,
        before_send: (event) => {
          if (!event) return event;

          const sanitizedEvent = sanitizePostHogEvent(
            event,
            posthogEnvironment
          );
          if (!analyticsSendingEnabled) {
            queuePostHogEvent(sanitizedEvent);
            return null;
          }

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
      });
      posthog.stopSessionRecording();
      hasInitializedPostHog = true;
    }

    if (analyticsAccepted) {
      analyticsSendingEnabled = true;
      posthog.startSessionRecording();
      flushQueuedPostHogEvents();
      return;
    }

    analyticsSendingEnabled = false;
    queuedEvents = [];
    posthog.stopSessionRecording();
  }, [analyticsAccepted, posthogEnvironment, posthogHost, posthogProjectToken]);

  useEffect(() => {
    if (!hasInitializedPostHog) return;

    if (!analyticsAccepted) {
      for (const cookie of createPostHogSessionClearCookieStrings()) {
        writePostHogSessionCookie(cookie);
      }
      return;
    }

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
