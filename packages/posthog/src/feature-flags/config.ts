import { Context, Layer } from "effect";
import type { PostHogProjectId } from "../identifiers";

interface IPostHogFeatureFlagConfig {
  readonly apiKey: string;
  readonly host: URL;
  readonly projectId: PostHogProjectId;
}

export class PostHogFeatureFlagConfig extends Context.Service<
  PostHogFeatureFlagConfig,
  IPostHogFeatureFlagConfig
>()("@deskohub/posthog/PostHogFeatureFlagConfig") {
  static from = (config: IPostHogFeatureFlagConfig) =>
    Layer.succeed(this, config);
}
