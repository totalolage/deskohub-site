/**
 * proof(1190): temporary, never merge.
 *
 * Simulates PostHog's state on a fixed hourly UTC schedule so a throwaway
 * preview deployment can be probed through an outage. Only the definition
 * listing, the last-known/snapshot fallbacks and the remote evaluation call
 * are touched; the classification, gate, page and sitemap code above them
 * runs unchanged.
 *
 * Minute of the UTC hour:
 * - 00–11 healthy: PostHog's live definitions
 * - 12–25 undecidable: the listing fails, no last-known classification, the
 *   snapshot counts as too old, and any remote evaluation fails
 * - 26–35 healthy
 * - 36–43 off: the listing reports `meeting_room_page` constantly off
 * - 44–59 healthy
 *
 * A build always sees healthy PostHog. The clock is read only inside the
 * `"use cache"` classification; the remote evaluation reads the phase that
 * the last classification run recorded.
 */
import {
  type PostHogFeatureFlagDefinition,
  PostHogFeatureFlagError,
} from "@deskohub/posthog/feature-flags/management";
import { Effect } from "effect";

export type Proof1190Phase = "healthy" | "undecidable" | "off";

export const proof1190PhaseAt = (nowMillis: number): Proof1190Phase => {
  if (process.env.NEXT_PHASE === "phase-production-build") return "healthy";
  const minute = new Date(nowMillis).getUTCMinutes();
  if (minute >= 12 && minute < 26) return "undecidable";
  if (minute >= 36 && minute < 44) return "off";
  return "healthy";
};

const proofState = globalThis as typeof globalThis & {
  __proof1190Phase?: Proof1190Phase;
};

/** Whether the last classification run in this process saw the outage. */
export const isProof1190Outage = () =>
  proofState.__proof1190Phase === "undecidable";

/** The definition listing as PostHog would answer it at `nowMillis`. */
export const proof1190Definitions = (
  nowMillis: number,
  definitions: Effect.Effect<
    readonly PostHogFeatureFlagDefinition[],
    PostHogFeatureFlagError
  >
): Effect.Effect<
  readonly PostHogFeatureFlagDefinition[],
  PostHogFeatureFlagError
> => {
  const phase = proof1190PhaseAt(nowMillis);
  proofState.__proof1190Phase = phase;
  if (phase === "undecidable") {
    return Effect.fail(
      new PostHogFeatureFlagError({
        message: "proof(1190): simulated PostHog definition listing outage",
        failureCode: "Proof1190Outage",
        httpStatus: 503,
      })
    );
  }
  if (phase === "off") {
    return definitions.pipe(
      Effect.map((listed) =>
        listed.map((definition) =>
          definition.key === "meeting_room_page"
            ? { ...definition, constantEnabledValue: false }
            : definition
        )
      )
    );
  }
  return definitions;
};
