import "server-only";

import type { DotyposCustomerId } from "@deskohub/dotypos";
import type { AutomationFlowType as AutomationFlow } from "@deskohub/workspace-admin-api";
import { and, eq, inArray, ne } from "drizzle-orm";
import { Effect, Option, Schema } from "effect";
import {
  emailCampaignAutomationTriggerReceipts as receipts,
  emailCampaignAutomationRuns as runs,
  emailCampaignAutomationVersions as versions,
} from "@/db/schema";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import type { CustomerEventId } from "@/shared/backend/customer-events/customer-event";
import type { AudienceFilter } from "../../audience-filter";
import type { CampaignPurpose } from "../../body/campaign-content";
import type { CampaignId } from "../../campaign-identifiers";
import { automationFlowSchema } from "../automation-flow";
import type {
  AutomationRunId,
  AutomationVersionId,
} from "../automation-identifiers";
import type {
  AutomationTriggerDisposition,
  AutomationTriggerKind,
} from "../automation-states";
import type { AutomationEvaluationFacts } from "./automation-evaluation-facts.service";
import { planReachedStep } from "./automation-reached-step";
import { appendAutomationRunProgress } from "./automation-run-timeline";
import {
  type AutomationEngineTransaction,
  AutomationUnitRecheckFailed,
} from "./automation-unit-handler";

/** One trigger occurrence for one customer of one automation. */
export type AutomationTriggerOccurrence = {
  readonly dotyposCustomerId: DotyposCustomerId;
  /** The receipt key (§1.2.7): per reservation, account, or fire and customer. */
  readonly dedupKey: string;
  readonly kind: AutomationTriggerKind;
  /** The run's `trigger_at`: the event's occurrence, or the fire time. */
  readonly at: Temporal.Instant;
  readonly eventId: CustomerEventId | null;
  readonly reservationId: WorkspaceReservationId | null;
};

/** An occurrence that starts no run, with the receipt that records why. */
type AutomationTriggerRejection = AutomationTriggerOccurrence & {
  readonly disposition: Exclude<
    AutomationTriggerDisposition,
    "started" | "already-active"
  >;
};

/** What one automation's entry recorded. */
type AutomationRunEntry = {
  readonly started: number;
  readonly alreadyActive: number;
  readonly rejected: number;
};

/**
 * Enters customers into one automation version (§5.6, §5.7). Each admitted
 * occurrence starts a run at the flow's first step, `ready` and due at
 * `at`, unless the customer already has an open run (D4), which records
 * `already-active`; a customer admitted twice starts once, from the
 * earliest occurrence. Every occurrence gets one receipt. The started runs'
 * first step is planned in the same transaction (`planReachedStep`), so
 * their conditions and due waits run within the entry's tick (D36). Call it
 * under the lifecycle lock after the caller's rechecks.
 *
 * Runs insert before receipts, so a concurrent entry of the same customer
 * waits on the one-open-run index and then sees the run. A receipt key a
 * concurrent commit took meanwhile fails the commit with
 * `AutomationUnitRecheckFailed`, rolling the runs back: the unit drops and
 * its subjects are replanned, when the key is no longer free.
 */
export const enterAutomationRuns = Effect.fn("automationRuns.enter")(function* (
  tx: AutomationEngineTransaction,
  input: {
    readonly campaignId: CampaignId;
    readonly versionId: AutomationVersionId;
    /** Occurrences that start runs at the version's first step. */
    readonly admitted?: {
      /** The version's flow; its first step is where runs start. */
      readonly flow: AutomationFlow;
      readonly occurrences: readonly AutomationTriggerOccurrence[];
      /** Plans a first Condition step's units. */
      readonly facts: AutomationEvaluationFacts["Service"];
    };
    readonly rejected: readonly AutomationTriggerRejection[];
    readonly at: Temporal.Instant;
  }
) {
  const admitted = input.admitted?.occurrences ?? [];
  const firstStepId = input.admitted?.flow.steps[0]?.id;
  const firstByCustomer = new Map<
    DotyposCustomerId,
    AutomationTriggerOccurrence
  >();
  for (const occurrence of admitted.toSorted(byOccurrence)) {
    if (!firstByCustomer.has(occurrence.dotyposCustomerId)) {
      firstByCustomer.set(occurrence.dotyposCustomerId, occurrence);
    }
  }
  const candidates = [...firstByCustomer.values()];

  const inserted =
    firstStepId === undefined || candidates.length === 0
      ? []
      : yield* tx
          .insert(runs)
          .values(
            candidates.map((occurrence) => ({
              campaignId: input.campaignId,
              versionId: input.versionId,
              dotyposCustomerId: occurrence.dotyposCustomerId,
              triggerKind: occurrence.kind,
              triggerAt: occurrence.at,
              triggerEventId: occurrence.eventId,
              triggerReservationId: occurrence.reservationId,
              status: "active" as const,
              stepId: firstStepId,
              phase: "ready" as const,
              stepEnteredAt: input.at,
              dueAt: input.at,
              workUnitId: null,
            }))
          )
          .onConflictDoNothing({
            target: [runs.campaignId, runs.dotyposCustomerId],
            where: ne(runs.status, "ended"),
          })
          .returning({
            id: runs.id,
            dotyposCustomerId: runs.dotyposCustomerId,
          });
  const startedRuns = new Map<DotyposCustomerId, AutomationRunId>(
    inserted.map((run) => [run.dotyposCustomerId, run.id])
  );

  const receiptRows = [
    ...admitted.map((occurrence) => {
      const runId =
        firstByCustomer.get(occurrence.dotyposCustomerId) === occurrence
          ? startedRuns.get(occurrence.dotyposCustomerId)
          : undefined;
      return receiptRow(input, occurrence, {
        disposition: runId === undefined ? "already-active" : "started",
        runId: runId ?? null,
      });
    }),
    ...input.rejected.map((rejection) =>
      receiptRow(input, rejection, {
        disposition: rejection.disposition,
        runId: null,
      })
    ),
  ];
  const written =
    receiptRows.length === 0
      ? []
      : yield* tx
          .insert(receipts)
          .values(receiptRows)
          .onConflictDoNothing()
          .returning({ dedupKey: receipts.dedupKey, runId: receipts.runId });
  const startedReceipts = written.filter(({ runId }) => runId !== null).length;
  if (startedReceipts < startedRuns.size) {
    return yield* new AutomationUnitRecheckFailed({ code: "receipt-taken" });
  }

  yield* appendAutomationRunProgress(
    tx,
    inserted.map((run) => ({
      runId: run.id,
      kind: "started" as const,
      stepId: firstStepId ?? null,
      at: input.at,
    }))
  );
  if (input.admitted !== undefined && firstStepId !== undefined) {
    yield* planReachedStep(tx, input.admitted.facts, {
      campaignId: input.campaignId,
      versionId: input.versionId,
      flow: Option.some(input.admitted.flow),
      stepId: firstStepId,
      runs: inserted.flatMap((run) =>
        Option.toArray(
          Option.fromUndefinedOr(firstByCustomer.get(run.dotyposCustomerId))
        ).map((occurrence) => ({
          runId: run.id,
          dotyposCustomerId: run.dotyposCustomerId,
          triggerKind: occurrence.kind,
          triggerAt: occurrence.at,
          triggerReservationId: occurrence.reservationId,
        }))
      ),
      at: input.at,
      chainedSteps: 0,
    });
  }
  return {
    started: startedRuns.size,
    alreadyActive: admitted.length - startedRuns.size,
    rejected: input.rejected.length,
  } satisfies AutomationRunEntry;
});

/** Receipt keys among `dedupKeys` the automation already recorded. */
export const takenReceiptKeys = (
  tx: AutomationEngineTransaction,
  campaignId: CampaignId,
  dedupKeys: readonly string[]
) =>
  dedupKeys.length === 0
    ? Effect.succeed(new Set<string>())
    : tx
        .select({ dedupKey: receipts.dedupKey })
        .from(receipts)
        .where(
          and(
            eq(receipts.campaignId, campaignId),
            inArray(receipts.dedupKey, [...new Set(dedupKeys)])
          )
        )
        .pipe(
          Effect.map((rows) => new Set(rows.map(({ dedupKey }) => dedupKey)))
        );

const byOccurrence = (
  left: AutomationTriggerOccurrence,
  right: AutomationTriggerOccurrence
) =>
  Temporal.Instant.compare(left.at, right.at) ||
  left.dedupKey.localeCompare(right.dedupKey);

const receiptRow = (
  input: {
    readonly campaignId: CampaignId;
    readonly versionId: AutomationVersionId;
    readonly at: Temporal.Instant;
  },
  occurrence: AutomationTriggerOccurrence,
  outcome: {
    readonly disposition: AutomationTriggerDisposition;
    readonly runId: AutomationRunId | null;
  }
) => ({
  campaignId: input.campaignId,
  dedupKey: occurrence.dedupKey,
  versionId: input.versionId,
  customerEventId: occurrence.eventId,
  dotyposCustomerId: occurrence.dotyposCustomerId,
  disposition: outcome.disposition,
  runId: outcome.runId,
  receivedAt: input.at,
});

/** What entering a version needs: its entry audience, purpose and flow. */
type AutomationEntryVersion = {
  readonly id: AutomationVersionId;
  readonly campaignId: CampaignId;
  readonly purpose: CampaignPurpose;
  readonly audienceFilter: AudienceFilter;
  /** None when the stored flow no longer decodes, or has no step: a domain defect. */
  readonly flow: Option.Option<AutomationFlow>;
};

const decodeFlow = Schema.decodeUnknownOption(automationFlowSchema);

/** The versions by id, with their flows decoded. */
export const loadAutomationEntryVersions = Effect.fn(
  "automationVersions.loadEntryVersions"
)(function* (
  tx: AutomationEngineTransaction,
  versionIds: readonly AutomationVersionId[]
) {
  const rows =
    versionIds.length === 0
      ? []
      : yield* tx
          .select({
            id: versions.id,
            campaignId: versions.campaignId,
            purpose: versions.purpose,
            audienceFilter: versions.audienceFilter,
            flow: versions.flow,
          })
          .from(versions)
          .where(inArray(versions.id, [...new Set(versionIds)]));
  const loaded: ReadonlyMap<AutomationVersionId, AutomationEntryVersion> =
    new Map(
      rows.map(({ flow, ...version }) => [
        version.id,
        {
          ...version,
          flow: decodeFlow(flow).pipe(
            Option.filter(({ steps }) => steps.length > 0)
          ),
        },
      ])
    );
  return loaded;
});
