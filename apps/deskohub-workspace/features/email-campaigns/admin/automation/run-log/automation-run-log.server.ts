import "server-only";

import type {
  AutomationEngineHealth,
  AutomationFlow,
  AutomationRunDetail,
  AutomationRunPage,
  AutomationRunStats,
  AutomationVersionSummary,
} from "@deskohub/workspace-admin-api";
import { Array as Arr, Clock, Effect, Option, Result, Schema } from "effect";
import {
  AdministrationRecordNotFound,
  runAdministrationPage,
} from "@/features/administrators/server/administration-request.server";
import { automationRunIdSchema } from "../../../automation/automation-identifiers";
import type { CampaignId } from "../../../campaign-identifiers";
import { loadAudienceValueLookups } from "../../audiences/audience-value-lookups.server";
import {
  campaignOperationCapabilities,
  invokeCampaignOperation,
} from "../../campaign-operation-query.server";
import type { AutomatedCampaign } from "../automated-campaign.server";
import type { ConditionWording } from "./automation-condition-failures";
import type { AutomationRunFilters } from "./automation-run-filters";

/** A port failure the run log words by its code. */
export interface AutomationRunLogFailure {
  readonly code: string;
}

type Loaded<A> = Result.Result<A, AutomationRunLogFailure>;

/** Each published version's flow, to name the steps runs are at. */
export type AutomationFlowsByVersion = ReadonlyMap<number, AutomationFlow>;

export interface AutomationRunLog {
  /** The counts and the versions they can be narrowed to. */
  readonly summary: Loaded<{
    readonly stats: AutomationRunStats;
    readonly versions: readonly AutomationVersionSummary[];
  }>;
  readonly runs: Loaded<AutomationRunPage>;
  readonly health: Loaded<AutomationEngineHealth>;
  /** When the page read the engine's health, in epoch milliseconds. */
  readonly checkedAt: number;
  readonly flows: AutomationFlowsByVersion;
  /** The flow the counts and the step filter name steps by. */
  readonly flow: AutomationFlow | null;
}

const optionalField = <K extends string, A>(key: K, value: Option.Option<A>) =>
  Option.match(value, {
    onNone: () => ({}),
    onSome: (present) => ({ [key]: present }) as { readonly [P in K]: A },
  });

/** The flows of `versionNumbers`; a version that fails to load names no steps. */
const loadFlows = (campaignId: CampaignId, versionNumbers: Iterable<number>) =>
  Effect.forEach(
    new Set(versionNumbers),
    (versionNumber) =>
      invokeCampaignOperation("getAutomationVersion", {
        campaignId,
        versionNumber,
      }).pipe(
        Effect.map(({ flow }) => [versionNumber, flow] as const),
        Effect.option
      ),
    { concurrency: "unbounded" }
  ).pipe(Effect.map((entries) => new Map(Arr.getSomes(entries))));

const latestVersionNumber = (
  versions: readonly AutomationVersionSummary[]
): number | undefined =>
  versions.length === 0
    ? undefined
    : Math.max(...versions.map(({ versionNumber }) => versionNumber));

const loadRunLog = Effect.fn("AutomationRunLog.load")(function* (
  { campaign, automation }: AutomatedCampaign,
  filters: AutomationRunFilters
) {
  const campaignId = campaign.id;
  const version = optionalField("versionNumber", filters.versionNumber);
  const [summary, runs, health, checkedAt] = yield* Effect.all(
    [
      Effect.result(
        Effect.all(
          {
            stats: invokeCampaignOperation("getAutomationRunStats", {
              campaignId,
              ...version,
            }),
            versions: invokeCampaignOperation("listAutomationVersions", {
              campaignId,
            }),
          },
          { concurrency: "unbounded" }
        )
      ),
      Effect.result(
        invokeCampaignOperation("listAutomationRuns", {
          campaignId,
          ...version,
          ...optionalField("state", filters.state),
          ...optionalField("outcome", filters.outcome),
          ...optionalField("skipReason", filters.skipReason),
          ...optionalField("stepId", filters.stepId),
          ...optionalField("customerId", filters.customerId),
          ...optionalField("cursor", filters.cursor),
        })
      ),
      Effect.result(invokeCampaignOperation("getAutomationEngineHealth", {})),
      Clock.currentTimeMillis,
    ],
    { concurrency: "unbounded" }
  );
  const flowVersion = Option.orElse(filters.versionNumber, () =>
    Option.fromNullishOr(
      automation.activeVersion?.versionNumber ??
        latestVersionNumber(Result.getOrUndefined(summary)?.versions ?? [])
    )
  );
  const flows = yield* loadFlows(campaignId, [
    ...Option.toArray(flowVersion),
    ...(Result.getOrUndefined(runs)?.runs.map(
      ({ versionNumber }) => versionNumber
    ) ?? []),
  ]);
  return {
    summary,
    runs,
    health,
    checkedAt,
    flows,
    flow: Option.match(flowVersion, {
      onNone: () => automation.flow,
      onSome: (versionNumber) => flows.get(versionNumber) ?? automation.flow,
    }),
  } satisfies AutomationRunLog;
});

/** The run log of an automated campaign: counts, one page of runs, engine health. */
export const loadAutomationRunLog = (
  automated: AutomatedCampaign,
  filters: AutomationRunFilters
): Promise<AutomationRunLog> =>
  runAdministrationPage(
    "email-campaigns.admin.load-automation-run-log",
    loadRunLog(automated, filters),
    campaignOperationCapabilities
  );

export interface AutomationRunRecord {
  readonly run: AutomationRunDetail;
  /** The flow of the run's own version, or `null` when it fails to load. */
  readonly flow: AutomationFlow | null;
  /** The names a failed condition's clauses are worded with. */
  readonly conditionWording: ConditionWording;
}

const loadRun = Effect.fn("AutomationRun.load")(function* (
  campaignId: CampaignId,
  routeRunId: string
) {
  const runId = yield* Option.match(
    Schema.decodeOption(automationRunIdSchema)(routeRunId),
    {
      onNone: () => Effect.fail(new AdministrationRecordNotFound()),
      onSome: Effect.succeed,
    }
  );
  const run = yield* invokeCampaignOperation("getAutomationRun", { runId });
  if (run.campaignId !== campaignId) {
    return yield* new AdministrationRecordNotFound();
  }
  const conditionFailed = run.timeline.some(
    ({ kind }) => kind === "condition-failed"
  );
  const [flows, audiences] = yield* Effect.all(
    [
      loadFlows(campaignId, [run.versionNumber]),
      conditionFailed
        ? invokeCampaignOperation("listCampaignAudiences", {}).pipe(
            Effect.map(
              (list) => new Map(list.map(({ id, title }) => [id, title]))
            ),
            Effect.orElseSucceed(() => new Map<string, string>())
          )
        : Effect.succeed(new Map<string, string>()),
    ],
    { concurrency: "unbounded" }
  );
  return {
    run,
    flow: flows.get(run.versionNumber) ?? null,
    conditionFailed,
    audiences,
  };
});

/**
 * One run of the campaign with its version's flow, or the not-found page for
 * a malformed id, a missing run, or a run of another campaign.
 */
export const loadAutomationRun = async (
  campaignId: CampaignId,
  routeRunId: string
): Promise<AutomationRunRecord> => {
  const { run, flow, conditionFailed, audiences } = await runAdministrationPage(
    "email-campaigns.admin.load-automation-run",
    loadRun(campaignId, routeRunId).pipe(
      Effect.catchTag("OperationNotFound", () =>
        Effect.fail(new AdministrationRecordNotFound())
      )
    ),
    campaignOperationCapabilities
  );
  return {
    run,
    flow,
    conditionWording: {
      audiences,
      lookups: conditionFailed ? await loadAudienceValueLookups() : {},
    },
  };
};
