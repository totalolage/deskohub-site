import type {
  PostHogFeatureFlagEvaluationError,
  PostHogFeatureFlagEvaluationOptions,
  TypedPostHogFeatureFlagEvaluationSnapshot,
} from "@deskohub/posthog/feature-flags/node";
import { Context, Effect, Layer, Option } from "effect";
import type {
  PostHogFeatureFlagDefinitions,
  PostHogFeatureFlagKey,
} from "../generated/contract";
import { postHogFeatureFlags } from "../generated/contract";

type WorkspaceFeatureFlagSnapshot = Pick<
  TypedPostHogFeatureFlagEvaluationSnapshot<PostHogFeatureFlagDefinitions>,
  "getFlag"
>;

export interface IWorkspaceFeatureFlagService {
  readonly evaluateFlags: (
    options?: PostHogFeatureFlagEvaluationOptions<PostHogFeatureFlagDefinitions>
  ) => Effect.Effect<
    WorkspaceFeatureFlagSnapshot,
    PostHogFeatureFlagEvaluationError
  >;
  readonly isEnabled: <Key extends PostHogFeatureFlagKey>(
    key: Key
  ) => Effect.Effect<boolean, PostHogFeatureFlagEvaluationError>;
  /**
   * The flag's value when it is the same for every visitor, read without the
   * request; none when the flag is decided per visitor.
   */
  readonly constantValue: <Key extends PostHogFeatureFlagKey>(
    key: Key
  ) => Effect.Effect<Option.Option<boolean>>;
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
        {
          getGlobalWorkspaceFeatureFlagValue,
          getGlobalWorkspaceFeatureFlagValues,
        },
        { evaluateRequestFlags, isFlagEnabled, makeRunEvaluations },
      ] = await Promise.all([
        import("./feature-flag-evaluation-mode.server"),
        import("./request-flag-evaluation.server"),
      ]);
      // One remote evaluation per request, or per build outside any request.
      const requestFlags = evaluateRequestFlags(makeRunEvaluations());

      return WorkspaceFeatureFlagService.from({
        evaluateFlags: Effect.fn("WorkspaceFeatureFlagService.evaluateFlags")(
          (options) =>
            Effect.promise(() =>
              getGlobalWorkspaceFeatureFlagValues(
                options?.flagKeys ?? postHogFeatureFlags.keys
              )
            ).pipe(
              Effect.flatMap(
                (
                  globalValues
                ): ReturnType<IWorkspaceFeatureFlagService["evaluateFlags"]> =>
                  globalValues === undefined
                    ? requestFlags
                    : Effect.succeed({ getFlag: (key) => globalValues[key] })
              )
            )
        ),
        isEnabled: Effect.fn("WorkspaceFeatureFlagService.isEnabled")((key) =>
          Effect.promise(() => getGlobalWorkspaceFeatureFlagValue(key)).pipe(
            Effect.flatMap((globalValue) =>
              globalValue === undefined
                ? requestFlags.pipe(
                    Effect.flatMap((flags) => isFlagEnabled(flags, key))
                  )
                : Effect.succeed(globalValue)
            )
          )
        ),
        constantValue: Effect.fn("WorkspaceFeatureFlagService.constantValue")(
          (key) =>
            Effect.promise(() => getGlobalWorkspaceFeatureFlagValue(key)).pipe(
              Effect.map(Option.fromUndefinedOr)
            )
        ),
      });
    })
  );
}
