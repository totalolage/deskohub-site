import { Context, Layer } from "effect";
import { env } from "@/env";

const defaultPostHogHost = "https://us.i.posthog.com";

export interface PostHogRuntimeConfigObj {
  readonly environment: string;
  readonly host: string;
  readonly projectToken?: string;
  readonly serviceName: string;
  readonly serviceNamespace: string;
}

export class PostHogRuntimeConfig extends Context.Service<
  PostHogRuntimeConfig,
  PostHogRuntimeConfigObj
>()("@deskohub-workspace/analytics/PostHogRuntimeConfig") {}

export const PostHogRuntimeConfigLive = Layer.succeed(PostHogRuntimeConfig, {
  environment: env.VERCEL_ENV,
  host: env.NEXT_PUBLIC_POSTHOG_HOST ?? defaultPostHogHost,
  projectToken: env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN,
  serviceName: env.POSTHOG_SERVICE_NAME,
  serviceNamespace: env.POSTHOG_SERVICE_NAMESPACE,
});
