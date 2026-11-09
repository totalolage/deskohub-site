import { Effect, Layer } from "effect";
import {
  PostHogRuntimeConfig,
  type PostHogRuntimeConfigObj,
} from "@/shared/backend/config/posthog.config";
import {
  AnalyticsEventDelivery,
  type AnalyticsEventMessage,
} from "./analytics-event-delivery.service";
import { ServerAnalytics } from "./server-analytics.service";

export const serverAnalyticsTestConfig: PostHogRuntimeConfigObj = {
  environment: "development",
  ingestHost: "https://ingest.posthog.example",
  serviceName: "workspace-test",
  serviceNamespace: "deskohub-test",
};

/**
 * The real server analytics over a delivery that records each event as
 * PostHog would receive it, before the SDK's own fields.
 */
export const recordServerAnalytics = (
  config: PostHogRuntimeConfigObj = serverAnalyticsTestConfig
) => {
  const messages: AnalyticsEventMessage[] = [];
  const layer = ServerAnalytics.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(AnalyticsEventDelivery, {
          send: (message) => Effect.sync(() => void messages.push(message)),
        }),
        Layer.succeed(PostHogRuntimeConfig, config)
      )
    )
  );
  return { layer, messages };
};
