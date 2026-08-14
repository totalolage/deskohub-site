import "server-only";

import type {
  PostHogFeatureFlagEvaluationError,
  PostHogFeatureFlagEvaluationOptions,
  TypedPostHogFeatureFlagEvaluationSnapshot,
} from "@deskohub/posthog/feature-flags/node";
import { Context, Effect, Layer } from "effect";
import type {
  PostHogFeatureFlagDefinitions,
  PostHogFeatureFlagKey,
} from "../generated/contract";
import { nodeFeatureFlags } from "./node";
import { getCurrentPostHogFeatureFlagSubject } from "./subject";

export interface IWorkspaceFeatureFlagService {
  readonly evaluateFlags: (
    options?: PostHogFeatureFlagEvaluationOptions<PostHogFeatureFlagDefinitions>
  ) => Effect.Effect<
    TypedPostHogFeatureFlagEvaluationSnapshot<PostHogFeatureFlagDefinitions>,
    PostHogFeatureFlagEvaluationError
  >;
  readonly isEnabled: <Key extends PostHogFeatureFlagKey>(
    key: Key
  ) => Effect.Effect<boolean, PostHogFeatureFlagEvaluationError>;
}

export class WorkspaceFeatureFlagService extends Context.Service<
  WorkspaceFeatureFlagService,
  IWorkspaceFeatureFlagService
>()("@deskohub-workspace/feature-flags/WorkspaceFeatureFlagService") {
  static from = (implementation: IWorkspaceFeatureFlagService) =>
    Layer.succeed(this, implementation);

  static Live = this.from({
    evaluateFlags: Effect.fn("WorkspaceFeatureFlagService.evaluateFlags")(
      (options) =>
        getCurrentPostHogFeatureFlagSubject().pipe(
          Effect.flatMap((subject) =>
            nodeFeatureFlags.evaluateFlags({ options, subject })
          )
        )
    ),
    isEnabled: Effect.fn("WorkspaceFeatureFlagService.isEnabled")((key) =>
      getCurrentPostHogFeatureFlagSubject().pipe(
        Effect.flatMap((subject) =>
          nodeFeatureFlags.isEnabled({ key, subject })
        )
      )
    ),
  });
}
import "server-only";
