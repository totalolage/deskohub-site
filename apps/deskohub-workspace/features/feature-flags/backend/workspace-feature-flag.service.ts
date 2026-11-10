import {
  PostHogFeatureFlagEvaluationError,
  type PostHogFeatureFlagEvaluationOptions,
  type TypedPostHogFeatureFlagEvaluationSnapshot,
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
  /**
   * The flag's value: a constant, else the request's evaluation, which also
   * stands in for a classification that couldn't be read.
   */
  readonly isEnabled: <Key extends PostHogFeatureFlagKey>(
    key: Key
  ) => Effect.Effect<boolean, PostHogFeatureFlagEvaluationError>;
  /**
   * The flag's value for output that can be stored: a constant, else the
   * request's evaluation of a flag decided per visitor. Fails without
   * reading the request when no classification could be read, since a
   * prerender can't read the request.
   */
  readonly decision: <Key extends PostHogFeatureFlagKey>(
    key: Key
  ) => Effect.Effect<boolean, PostHogFeatureFlagEvaluationError>;
  /**
   * The flag's value when it is the same for every visitor, read without the
   * request; none when the flag is decided per visitor. Fails when no
   * classification could be read.
   */
  readonly constantValue: <Key extends PostHogFeatureFlagKey>(
    key: Key
  ) => Effect.Effect<Option.Option<boolean>, PostHogFeatureFlagEvaluationError>;
}

const unclassifiedFlag = () =>
  new PostHogFeatureFlagEvaluationError({
    message: "PostHog feature flag definitions are unavailable.",
    cause: undefined,
  });

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
          getWorkspaceFeatureFlagConstancy,
        },
        { evaluateRequestFlags, isFlagEnabled, makeRunEvaluations },
      ] = await Promise.all([
        import("./feature-flag-evaluation-mode.server"),
        import("./request-flag-evaluation.server"),
      ]);
      // One remote evaluation per request, or per build outside any request.
      const requestFlags = evaluateRequestFlags(makeRunEvaluations());
      const constancyOf = (key: PostHogFeatureFlagKey) =>
        Effect.promise(() => getWorkspaceFeatureFlagConstancy(key));

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
        decision: Effect.fn("WorkspaceFeatureFlagService.decision")((key) =>
          constancyOf(key).pipe(
            Effect.flatMap((constancy) => {
              if (constancy.kind === "constant") {
                return Effect.succeed(constancy.value);
              }
              if (constancy.kind === "unclassified") {
                return Effect.fail(unclassifiedFlag());
              }
              return requestFlags.pipe(
                Effect.flatMap((flags) => isFlagEnabled(flags, key))
              );
            })
          )
        ),
        constantValue: Effect.fn("WorkspaceFeatureFlagService.constantValue")(
          (key) =>
            constancyOf(key).pipe(
              Effect.flatMap((constancy) => {
                if (constancy.kind === "unclassified") {
                  return Effect.fail(unclassifiedFlag());
                }
                return Effect.succeed(
                  constancy.kind === "constant"
                    ? Option.some(constancy.value)
                    : Option.none()
                );
              })
            )
        ),
      });
    })
  );
}
