import { Context, Layer } from "effect";
import type { PostHogProjectId } from "../identifiers";

export interface PostHogFeatureFlagConfigInput {
  readonly apiKey: string;
  readonly host: URL;
  readonly projectId: PostHogProjectId;
}

export class PostHogFeatureFlagConfig extends Context.Service<
  PostHogFeatureFlagConfig,
  PostHogFeatureFlagConfigInput
>()("@deskohub/posthog/PostHogFeatureFlagConfig") {
  static from = (config: PostHogFeatureFlagConfigInput) =>
    Layer.succeed(this, config);
}
