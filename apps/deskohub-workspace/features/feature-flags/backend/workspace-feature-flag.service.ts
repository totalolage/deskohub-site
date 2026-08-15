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

  static Default = Layer.unwrap(
    Effect.promise(async () => {
      const [{ nodeFeatureFlags }, { workspaceReleaseSubject }] =
        await Promise.all([import("./node"), import("./subject")]);

      return WorkspaceFeatureFlagService.from({
        evaluateFlags: Effect.fn("WorkspaceFeatureFlagService.evaluateFlags")(
          (options) =>
            nodeFeatureFlags.evaluateFlags({
              options,
              subject: workspaceReleaseSubject,
            })
        ),
        isEnabled: Effect.fn("WorkspaceFeatureFlagService.isEnabled")((key) =>
          nodeFeatureFlags.isEnabled({ key, subject: workspaceReleaseSubject })
        ),
      });
    })
  );
}
