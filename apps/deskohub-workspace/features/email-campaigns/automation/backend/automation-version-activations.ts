import { AutomationTrigger } from "@deskohub/workspace-admin-api";
import { asc, eq, sql } from "drizzle-orm";
import { Effect, Schema } from "effect";
import { WorkspaceTransaction } from "@/db/database.service";
import { emailCampaignAutomationVersions as versions } from "@/db/schema";
import type { CampaignId } from "../../campaign-identifiers";
import type { AutomationVersionActivation } from "../automation-versions";

const decodeTrigger = Schema.decodeUnknownEffect(AutomationTrigger);

const decodeActivation = (row: {
  readonly id: AutomationVersionActivation["id"];
  readonly activatedAt: Temporal.Instant;
  readonly trigger: unknown;
}) =>
  decodeTrigger(row.trigger).pipe(
    Effect.map((trigger): AutomationVersionActivation => ({ ...row, trigger })),
    Effect.orDie
  );

/**
 * Every version of one automation with its activation and trigger, for
 * `versionInForce` and `nextFireAfter`. Versions are immutable and were
 * validated when published, so an undecodable trigger is a defect.
 */
export const loadAutomationVersionActivations = (campaignId: CampaignId) =>
  Effect.flatMap(WorkspaceTransaction, ({ db }) =>
    db
      .select({
        id: versions.id,
        activatedAt: versions.activatedAt,
        trigger: sql<unknown>`${versions.flow}->'trigger'`,
      })
      .from(versions)
      .where(eq(versions.campaignId, campaignId))
      .orderBy(asc(versions.activatedAt))
      .pipe(
        Effect.flatMap(Effect.forEach(decodeActivation)),
        Effect.withSpan("automationVersions.loadActivations")
      )
  );
