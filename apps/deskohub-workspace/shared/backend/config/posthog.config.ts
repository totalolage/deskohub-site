import type { PostHogFeatureFlagOverrides } from "@deskohub/posthog/feature-flags";
import { Context, Layer } from "effect";
import { env } from "@/env";
import type { PostHogFeatureFlagDefinitions } from "@/features/feature-flags/generated/contract";

const defaultPostHogHost = "https://us.i.posthog.com";

export interface PostHogRuntimeConfigObj {
  readonly environment: string;
  readonly featureFlagOverrides?: PostHogFeatureFlagOverrides<PostHogFeatureFlagDefinitions>;
  readonly host: string;
  readonly projectToken?: string;
  readonly serviceName: string;
  readonly serviceNamespace: string;
}

export class PostHogRuntimeConfig extends Context.Service<
  PostHogRuntimeConfig,
  PostHogRuntimeConfigObj
>()("@deskohub-workspace/analytics/PostHogRuntimeConfig") {}

export const postHogRuntimeConfig: PostHogRuntimeConfigObj = {
  environment: env.VERCEL_ENV,
  featureFlagOverrides: env.POSTHOG_FEATURE_FLAG_OVERRIDES,
  host: env.NEXT_PUBLIC_POSTHOG_HOST ?? defaultPostHogHost,
  projectToken: env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN,
  serviceName: env.POSTHOG_SERVICE_NAME,
  serviceNamespace: env.POSTHOG_SERVICE_NAMESPACE,
};

export const PostHogRuntimeConfigLive = Layer.succeed(
  PostHogRuntimeConfig,
  postHogRuntimeConfig
);
