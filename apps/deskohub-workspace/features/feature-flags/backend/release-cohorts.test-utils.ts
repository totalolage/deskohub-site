import { Effect, type Layer } from "effect";
import { currentRequestHeaders } from "@/shared/backend/workspace-request-context";
import type { MeetingPoint } from "@/shared/testing/overlapping-requests.test-utils";
import type { PostHogFeatureFlagKey } from "../generated/contract";
import type { ReleaseGateClass } from "./release-gate";
import { releaseGateOverFlags } from "./release-gate.test-utils";
import { releaseGateForRun } from "./release-gate-run";
import type { WorkspaceFeatureFlagService } from "./workspace-feature-flag.service";
import { WorkspaceFeatureFlagServiceMock } from "./workspace-feature-flag.service.mock";

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
