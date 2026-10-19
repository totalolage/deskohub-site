import "server-only";

import type {
  AutomationFlowType as AutomationFlow,
  AutomationStepType as AutomationStep,
} from "@deskohub/workspace-admin-api";
import { inArray, sql } from "drizzle-orm";
import { Effect, Option, Schema } from "effect";
import type { WorkspaceDatabaseClient } from "@/db/database.service";
import {
  emailCampaignAutomationRuns as runs,
  emailCampaignAutomationVersions as versions,
} from "@/db/schema";
import { automationFlowSchema } from "../automation-flow";
import type {
  AutomationStepId,
  AutomationVersionId,
} from "../automation-identifiers";

const decodeFlow = Schema.decodeUnknownOption(automationFlowSchema);

/**
 * The flows of `versionIds`, decoded. A version whose stored flow no longer
 * decodes, or that doesn't exist, maps to none: its runs can't move, so the
 * engine ends them `failed / evaluation-unavailable`.
 */
export const loadAutomationVersionFlows = Effect.fn(
  "automationVersions.loadFlows"
)(function* (
  db: WorkspaceDatabaseClient,
  versionIds: readonly AutomationVersionId[]
) {
  const found =
    versionIds.length === 0
      ? []
      : yield* db
          .select({ id: versions.id, flow: versions.flow })
          .from(versions)
          .where(inArray(versions.id, [...new Set(versionIds)]));
  const flows = new Map(found.map((row) => [row.id, decodeFlow(row.flow)]));
  return (versionId: AutomationVersionId): Option.Option<AutomationFlow> =>
    flows.get(versionId) ?? Option.none();
});

/** A step of a flow and the step after it; the send step, last, has none. */
export type AutomationStepPosition = {
  readonly step: AutomationStep;
  readonly next: Option.Option<AutomationStep>;
};

/** Where `stepId` sits in `flow`, or none if the flow has no such step. */
export const automationStepPosition = (
  flow: Option.Option<AutomationFlow>,
  stepId: AutomationStepId
): Option.Option<AutomationStepPosition> =>
  Option.flatMap(flow, ({ steps }) => {
    const index = steps.findIndex((step) => step.id === stepId);
    return Option.map(
      Option.fromUndefinedOr(index < 0 ? undefined : steps[index]),
      (step): AutomationStepPosition => ({
        step,
        next: Option.fromUndefinedOr(steps[index + 1]),
      })
    );
  });

/**
 * The kind (`_tag`) of a run's current step, read from its version's flow
 * in SQL; null when the flow has no such step. The query must join the run's
 * version.
 */
export const automationRunStepKind = sql<
  string | null
>`(select step->>'_tag' from jsonb_array_elements(${versions.flow}->'steps') as step where step->>'id' = ${runs.stepId} limit 1)`;
