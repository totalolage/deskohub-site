import { Layer } from "effect";
import { PostHogRuntimeConfig } from "./posthog.config";

export const PostHogRuntimeConfigMock = Layer.mock(PostHogRuntimeConfig);
