import {
  AdministrationCampaignRecipientSkipReason,
  AutomationEngineHealth,
  AutomationRunDetail,
  type AutomationRunOutcome,
  type AutomationRunState,
  AutomationRunStats,
  AutomationRunSummary,
  AutomationRunTimelineEntry,
  automationRunOutcomes,
  automationRunStates,
} from "@deskohub/workspace-admin-api";
import { Schema } from "effect";
import { fixtureCampaignId } from "../activation/automation-detail.test-utils";

const runFields = {
  runId: "run-1",
  campaignId: fixtureCampaignId,
  versionNumber: 1,
  customerId: "dotypos-customer-1",
  customerName: null,
  customerEmail: null,
  customerProfileStatus: "found",
  triggerKind: "account-created",
  triggerAt: "2026-10-03T08:00:00.000Z",
  state: "ended",
  phase: null,
  stepId: "send",
  dueAt: null,
  outcome: "sent",
  outcomeReason: null,
  sendId: null,
  startedAt: "2026-10-03T08:00:00.000Z",
  endedAt: "2026-10-05T08:00:00.000Z",
} satisfies typeof AutomationRunSummary.Encoded;

/** One run of the fixture campaign, decoded like the port's output. */
export const automationRunFixture = (
  overrides: Partial<typeof AutomationRunSummary.Encoded> = {}
): AutomationRunSummary =>
  Schema.decodeUnknownSync(AutomationRunSummary)({
    ...runFields,
    ...overrides,
  });

/** A timeline entry decoded like the port's output; unknown kinds decode generically. */
export const timelineEntryFixture = (
  entry: Partial<typeof AutomationRunTimelineEntry.Encoded> & {
    readonly kind: string;
    readonly detail?: unknown;
  }
): AutomationRunTimelineEntry =>
  Schema.decodeUnknownSync(AutomationRunTimelineEntry)({
    sequence: 1,
    stepId: null,
    at: "2026-10-03T08:00:00.000Z",
    detail: {},
    ...entry,
  });

/** One run with its timeline, decoded like the port's output. */
export const automationRunDetailFixture = (
  overrides: Partial<typeof AutomationRunDetail.Encoded> = {}
): AutomationRunDetail =>
  Schema.decodeUnknownSync(AutomationRunDetail)({
    ...runFields,
    timeline: [],
    ...overrides,
  });

const zeroCounts = <K extends string>(keys: readonly K[]) =>
  Object.fromEntries(keys.map((key) => [key, 0])) as Record<K, number>;

type Counts<K extends string> = Partial<Record<K, number>>;

/** Run counts of the fixture campaign; omitted counts are zero. */
export const automationRunStatsFixture = ({
  byState,
  byOutcome,
  bySkipReason,
  ...overrides
}: Omit<
  Partial<typeof AutomationRunStats.Encoded>,
  "byState" | "byOutcome" | "bySkipReason"
> & {
  readonly byState?: Counts<AutomationRunState>;
  readonly byOutcome?: Counts<AutomationRunOutcome>;
  readonly bySkipReason?: Counts<AdministrationCampaignRecipientSkipReason>;
} = {}): AutomationRunStats =>
  Schema.decodeUnknownSync(AutomationRunStats)({
    campaignId: fixtureCampaignId,
    versionNumber: null,
    byState: { ...zeroCounts(automationRunStates), ...byState },
    byOutcome: { ...zeroCounts(automationRunOutcomes), ...byOutcome },
    bySkipReason: {
      ...zeroCounts(AdministrationCampaignRecipientSkipReason.literals),
      ...bySkipReason,
    },
    ...overrides,
  });

/** A healthy engine report; override fields to raise warnings. */
export const automationEngineHealthFixture = (
  overrides: Partial<typeof AutomationEngineHealth.Encoded> = {}
): AutomationEngineHealth =>
  Schema.decodeUnknownSync(AutomationEngineHealth)({
    lastPlannedAt: "2026-10-05T07:58:00.000Z",
    sweepLagSeconds: 5,
    reconcileLagSeconds: 1800,
    oldestUnprocessedEventAt: null,
    automations: [],
    unitDurations: [],
    units: [],
    oldestPlannedUnitAt: null,
    retryingUnits: [],
    deadlineMisses: 0,
    largestCustomerBookedCount: null,
    soloThreshold: null,
    warnings: [],
    ...overrides,
  });
