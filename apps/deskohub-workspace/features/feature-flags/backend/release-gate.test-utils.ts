import { Effect, Layer, Option } from "effect";
import { currentRequestHeaders } from "@/shared/backend/workspace-request-context";
import type { MeetingPoint } from "@/shared/testing/overlapping-requests.test-utils";
import type { PostHogFeatureFlagKey } from "../generated/contract";
import type { GlobalRelease } from "./global-release";
import { ReleaseGate, type ReleaseGateClass } from "./release-gate";
import { releaseGateForRun } from "./release-gate-run";
import type {
  IWorkspaceFeatureFlagService,
  WorkspaceFeatureFlagService,
} from "./workspace-feature-flag.service";
import { WorkspaceFeatureFlagServiceMock } from "./workspace-feature-flag.service.mock";

/** A gate over `webmcp_site_tools` for testing the gate machinery. */
export class TestReleaseGate extends ReleaseGate<TestReleaseGate>()(
  "@deskohub-workspace/feature-flags/TestReleaseGate",
  "webmcp_site_tools"
) {}

/** `gate` whose `Live` decides it over `featureFlags`. */
export const releaseGateOverFlags = <Self>(
  gate: ReleaseGateClass<Self> & {
    readonly Default: Layer.Layer<Self, never, WorkspaceFeatureFlagService>;
  },
  featureFlags: Layer.Layer<WorkspaceFeatureFlagService>
): ReleaseGateClass<Self> => ({
  isOpen: gate.isOpen,
  fromDecision: gate.fromDecision,
  fromEvaluation: gate.fromEvaluation,
  Live: gate.Default.pipe(Layer.provide(featureFlags)),
});

/** `TestReleaseGate` whose `Live` evaluates the flag with `isEnabled`. */
export const testReleaseGateEvaluating = (
  isEnabled: IWorkspaceFeatureFlagService["isEnabled"]
): ReleaseGateClass<TestReleaseGate> =>
  releaseGateOverFlags(
    TestReleaseGate,
    WorkspaceFeatureFlagServiceMock({ isEnabled })
  );

type FlagLookup = readonly [
  "isEnabled" | "constantValue",
  PostHogFeatureFlagKey,
];

/**
 * Decides a feature's gate and its release for every visitor against
 * PostHog that opens only `flag`, recording each flag the gate looks up, so
 * a test proves which flag a production gate reads.
 */
export const decideReleaseGateOnlyFor = async <Self>(
  gate: {
    readonly isOpen: Effect.Effect<boolean, never, Self>;
    readonly Default: Layer.Layer<Self, never, WorkspaceFeatureFlagService>;
    readonly release: Effect.Effect<
      GlobalRelease,
      never,
      WorkspaceFeatureFlagService
    >;
  },
  flag: PostHogFeatureFlagKey
) => {
  const lookups: FlagLookup[] = [];
  const featureFlags = WorkspaceFeatureFlagServiceMock({
    isEnabled: (key) =>
      Effect.sync(() => {
        lookups.push(["isEnabled", key]);
        return key === flag;
      }),
    constantValue: (key) =>
      Effect.sync(() => {
        lookups.push(["constantValue", key]);
        return Option.some(key === flag);
      }),
  });
  const [isOpen, release] = await Effect.runPromise(
    Effect.all([
      gate.isOpen.pipe(Effect.provide(gate.Default)),
      gate.release,
    ]).pipe(Effect.provide(featureFlags))
  );
  return { isOpen, release, lookups };
};

/** The test request header naming the release cohort the request is in. */
export const testReleaseCohortHeader = "x-test-release-cohort";

/**
 * PostHog as each request's own visitor sees it: every flag is on for a
 * request whose `cohort` is `open`, and off otherwise. An evaluation first
 * waits at `meetingPoint` for the other overlapping requests' evaluations of
 * the same flags, so every request holds its own decision while the others
 * make theirs.
 */
export const featureFlagsByCohort = (
  meetingPoint: MeetingPoint,
  cohort: Effect.Effect<string | undefined>
) => {
  const decide = (keys: readonly PostHogFeatureFlagKey[]) =>
    meetingPoint.arrive(keys.join(",")).pipe(
      Effect.andThen(cohort),
      Effect.map((name) => name === "open")
    );
  return WorkspaceFeatureFlagServiceMock({
    isEnabled: (key) => decide([key]),
    evaluateFlags: (options) =>
      decide(options?.flagKeys ?? []).pipe(
        Effect.map((open) => ({
          getFlag: ((key: PostHogFeatureFlagKey) =>
            options?.flagKeys?.includes(key) ? open : undefined) as never,
        }))
      ),
  });
};

/**
 * `featureFlagsByCohort` with each request's cohort named by its
 * `testReleaseCohortHeader`.
 */
export const featureFlagsByRequestCohort = (meetingPoint: MeetingPoint) =>
  featureFlagsByCohort(
    meetingPoint,
    currentRequestHeaders.pipe(
      Effect.map(
        (headers) => headers.get(testReleaseCohortHeader) ?? undefined
      ),
      Effect.orDie
    )
  );

/**
 * `gate` decided for a request served outside Next.js, as its `ForRun`
 * Layer is, over `featureFlags`.
 */
export const releaseGateForRunOverFlags = <Self>(
  gate: ReleaseGateClass<Self> & {
    readonly Default: Layer.Layer<Self, never, WorkspaceFeatureFlagService>;
  },
  featureFlags: Layer.Layer<WorkspaceFeatureFlagService>
) =>
  releaseGateForRun(releaseGateOverFlags(gate, featureFlags), {
    whenRunFails: "reject",
  });
