import type { DotyposService } from "@deskohub/dotypos";
import { Effect, Layer } from "effect";
import { TestClock } from "effect/testing";
import type { WorkspacePostgresSuiteDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { AudienceFactsService } from "../../backend/audience-facts.service";
import { CampaignCandidateRepository } from "../../backend/campaign-candidate.repository";
import { CampaignRecipientService } from "../../backend/campaign-recipient.service";
import type { CampaignId } from "../../campaign-identifiers";
import { AutomationConditionEvaluation } from "./automation-condition-evaluation.service";
import { AutomationDryRun } from "./automation-dry-run.service";
import { AutomationEvaluationFacts } from "./automation-evaluation-facts.service";

/**
 * `AutomationDryRun` over `dotypos` and the suite's own database, since a
 * dry run reads every active consent, with each call on a `TestClock` at
 * the instant it's given, so a dry run and an engine scenario can share one
 * Dotypos fake and one clock.
 */
export const makeAutomationDryRunner = (input: {
  readonly database: WorkspacePostgresSuiteDatabase;
  readonly dotypos: Layer.Layer<DotyposService>;
}) => {
  const candidates = CampaignCandidateRepository.Default.pipe(
    Layer.provide(input.database.layer)
  );
  const audienceFacts = AudienceFactsService.Default.pipe(
    Layer.provide(Layer.merge(candidates, input.dotypos))
  );
  const layer = AutomationDryRun.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        input.database.layer,
        input.dotypos,
        candidates,
        CampaignRecipientService.Default.pipe(
          Layer.provide(Layer.merge(candidates, audienceFacts))
        ),
        AutomationConditionEvaluation.Default.pipe(
          Layer.provide(Layer.merge(candidates, audienceFacts))
        ),
        AutomationEvaluationFacts.Default.pipe(
          Layer.provide(Layer.merge(input.database.layer, input.dotypos))
        )
      )
    )
  );

  const run = <A, E>(
    effect: Effect.Effect<A, E, AutomationDryRun>,
    at: Temporal.Instant
  ) =>
    Effect.runPromise(
      TestClock.setTime(at.epochMilliseconds).pipe(
        Effect.andThen(effect),
        Effect.provide(Layer.merge(layer, TestClock.layer()))
      )
    );

  /** Starts a dry run of `campaignId`'s working copy at `at`. */
  const start = (campaignId: CampaignId, at: Temporal.Instant) =>
    run(
      Effect.flatMap(AutomationDryRun, (dryRun) => dryRun.start(campaignId)),
      at
    );

  return { layer, run, start };
};
