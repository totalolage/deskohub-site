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
import { postHogFeatureFlags } from "../generated/contract";

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

  // Keep providers lazy so Context and test mocks do not initialize server-only modules.
  static Default = Layer.unwrap(
    Effect.promise(async () => {
      const [
        { areWorkspaceFeatureFlagsGlobal, getGlobalWorkspaceFeatureFlagValue },
        { nodeFeatureFlags },
        { getCurrentPostHogFeatureFlagSubject, workspaceReleaseSubject },
      ] = await Promise.all([
        import("./feature-flag-evaluation-mode.server"),
        import("./node"),
        import("./subject"),
      ]);
      const getSubject = (keys: readonly PostHogFeatureFlagKey[]) =>
        Effect.promise(() => areWorkspaceFeatureFlagsGlobal(keys)).pipe(
          Effect.flatMap((global) =>
            global
              ? Effect.succeed(workspaceReleaseSubject)
              : getCurrentPostHogFeatureFlagSubject()
          )
        );

      return WorkspaceFeatureFlagService.from({
        evaluateFlags: Effect.fn("WorkspaceFeatureFlagService.evaluateFlags")(
          (options) =>
            getSubject(options?.flagKeys ?? postHogFeatureFlags.keys).pipe(
              Effect.flatMap((subject) =>
                nodeFeatureFlags.evaluateFlags({ options, subject })
              )
            )
        ),
        isEnabled: Effect.fn("WorkspaceFeatureFlagService.isEnabled")((key) =>
          Effect.promise(() => getGlobalWorkspaceFeatureFlagValue(key)).pipe(
            Effect.flatMap((globalValue) =>
              globalValue === undefined
                ? getCurrentPostHogFeatureFlagSubject().pipe(
                    Effect.flatMap((subject) =>
                      nodeFeatureFlags.isEnabled({ key, subject })
                    )
                  )
                : Effect.succeed(globalValue)
            )
          )
        ),
      });
    })
  );
}
