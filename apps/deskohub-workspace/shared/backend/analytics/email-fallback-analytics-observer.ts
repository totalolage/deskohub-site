import "server-only";

import { Effect } from "effect";
import { unclassifiedTraffic } from "@/shared/agent-traffic/agent-traffic";
import { ServerAnalytics } from "./server-analytics.service";

// seam: replaced at integration — `EmailStream`, `EmailSentEvent`,
// `EmailFallbackEvent`, and `EmailDeliveryObserver` come from
// "@deskohub/email"; delete these local copies and import them.
type EmailStream = "transactional" | "marketing";
interface EmailSentEvent {
  readonly stream: EmailStream;
  readonly category: string | undefined;
  readonly provider: string;
  readonly at: Date;
}
export interface EmailFallbackEvent {
  readonly stream: EmailStream;
  readonly category: string | undefined;
  readonly failedProvider: string;
  readonly nextProvider: string;
  readonly errorKind: "EmailServiceError" | "NetworkError";
  readonly errorCode: string | undefined;
  readonly at: Date;
}
interface EmailDeliveryObserver {
  readonly onSent: (event: EmailSentEvent) => Effect.Effect<void>;
  readonly onFallback: (event: EmailFallbackEvent) => Effect.Effect<void>;
}

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
