import { Context, Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { ReservationActivitySweep } from "@/features/reservation/backend/reservation-activity-sweep.service";
import { WorkspaceDotyposLayer } from "@/shared/backend/config/dotypos.config";
import { CampaignCandidateRepository } from "../../backend/campaign-candidate.repository";
import { CampaignDeliveryService } from "../../backend/campaign-delivery.service";
import { CampaignRecipientService } from "../../backend/campaign-recipient.service";
import type { AutomationWorkUnitKind } from "../automation-work-units";
import { AutomationConditionEvaluation } from "./automation-condition-evaluation.service";
import { AutomationEvaluationFacts } from "./automation-evaluation-facts.service";
import { makePreviewUnitHandler } from "./automation-preview-unit";
import type { RegisteredAutomationUnitHandler } from "./automation-unit-handler";
import { makeConditionHandler } from "./condition";
import { makeDeliverHandler } from "./deliver";
import { makeFireChunkHandler } from "./fire-chunk";
import { makeIntakeHandler } from "./intake";
import { makeSweepPageHandler } from "./sweep-page";

interface IAutomationUnitHandlers {
  readonly byKind: ReadonlyMap<
    AutomationWorkUnitKind,
    RegisteredAutomationUnitHandler
  >;
  /**
   * The kinds this deployment claims, promotes and reaps. A unit of any
   * other kind waits for a deployment that supports it (§9.1).
   */
  readonly supportedKinds: ReadonlyArray<AutomationWorkUnitKind>;
}

/** The unit kinds this deployment runs. */
export class AutomationUnitHandlers extends Context.Service<
  AutomationUnitHandlers,
  IAutomationUnitHandlers
>()("@deskohub-workspace/email-campaigns/AutomationUnitHandlers") {
  static layer = <R>(
    handlers: Effect.Effect<
      ReadonlyArray<RegisteredAutomationUnitHandler>,
      never,
      R
    >
  ) =>
    Layer.effect(
      this,
      Effect.map(handlers, (registered) => ({
        byKind: new Map(registered.map((handler) => [handler.kind, handler])),
        supportedKinds: registered.map((handler) => handler.kind),
      }))
    );

  /**
   * Sweep pages, dry-run previews, intake, schedule fire chunks, conditions
   * and deliveries, with one provider list for all of them.
   */
  static Live = this.layer(
    Effect.all([
      makeSweepPageHandler,
      makePreviewUnitHandler,
      makeIntakeHandler,
      makeFireChunkHandler,
      makeConditionHandler,
      makeDeliverHandler,
    ])
  ).pipe(
    Layer.provide(
      Layer.mergeAll(
        ReservationActivitySweep.Default,
        WorkspaceDatabase.Default,
        WorkspaceDotyposLayer,
        CampaignRecipientService.Live,
        AutomationEvaluationFacts.Live,
        AutomationConditionEvaluation.Live,
        CampaignCandidateRepository.Live,
        CampaignDeliveryService.Live
      )
    )
  );
}
