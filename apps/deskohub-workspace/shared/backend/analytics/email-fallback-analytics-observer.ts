import "server-only";

import type { EmailDeliveryObserver } from "@deskohub/email";
import { Effect } from "effect";
import { unclassifiedTraffic } from "@/shared/agent-traffic/agent-traffic";
import { ServerAnalytics } from "./server-analytics.service";

/**
 * Reports each email that one provider failed and the next provider in its
 * stream's chain took over: a warning log, and an `email provider fallback`
 * analytics event about no one. The event carries only the stream, category,
 * providers, and error kind and code, never a recipient or message.
 */
export const makeEmailFallbackAnalyticsObserver = Effect.map(
  ServerAnalytics,
  (analytics): EmailDeliveryObserver => ({
    onSent: () => Effect.void,
    onFallback: ({ at, ...fallback }) =>
      Effect.logWarning("Email provider fell back", fallback).pipe(
        Effect.andThen(
          analytics.capture({
            name: "email provider fallback",
            subject: { kind: "anonymous", traffic: unclassifiedTraffic },
            properties: {
              stream: fallback.stream,
              category: fallback.category,
              failed_provider: fallback.failedProvider,
              next_provider: fallback.nextProvider,
              error_kind: fallback.errorKind,
              error_code: fallback.errorCode,
            },
            timestamp: Temporal.Instant.fromEpochMilliseconds(at.getTime()),
          })
        )
      ),
  })
);
