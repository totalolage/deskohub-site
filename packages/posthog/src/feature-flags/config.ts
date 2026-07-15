import { Context } from "effect";

interface IPostHogFeatureFlagConfig {
  readonly apiKey: string;
  readonly host: URL;
  readonly projectId: string;
}

export class PostHogFeatureFlagConfig extends Context.Service<
  PostHogFeatureFlagConfig,
  IPostHogFeatureFlagConfig
>()("@deskohub/posthog/PostHogFeatureFlagConfig") {}
