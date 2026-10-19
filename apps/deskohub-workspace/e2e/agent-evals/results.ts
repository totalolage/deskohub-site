import type { Locale } from "@/features/i18n";
import type { AgentEvalPerception } from "./harness-contract";
import {
  type AgentEvalFact,
  type AgentEvalFailureCategory,
  type AgentEvalHarnessOutcomeKind,
  type AgentEvalJudgementReason,
  agentEvalFailureCategories,
} from "./judges";
import type { AgentEvalBrowserObservations } from "./observations";
import type { AgentEvalTarget } from "./target";
import type { AgentEvalTaskId } from "./tasks";

/** The ticket's floor: each task, harness, and locale runs at least 5 times. */
export const agentEvalMinimumRunsPerCell = 5;

/**
 * One run's result file. It holds no transcript and no personal data: the
 * account is synthetic and the final answer is truncated.
 */
export type AgentEvalRunResult = {
  readonly version: 1;
  readonly runSetId: string;
  readonly taskId: AgentEvalTaskId;
  readonly harnessId: string;
  readonly perception: AgentEvalPerception;
  readonly locale: Locale;
  readonly repeat: number;
  readonly startedAt: string;
  readonly success: boolean;
  readonly reason: AgentEvalJudgementReason;
  /** Facts the answer missed; facts task only. */
  readonly missingFacts: readonly AgentEvalFact[] | null;
  readonly failureCategory: AgentEvalFailureCategory | null;
  readonly harnessOutcome: AgentEvalHarnessOutcomeKind;
  readonly harnessError: string | null;
  readonly finalAnswer: string | null;
  readonly steps: number | null;
  readonly costUsd: number | null;
  readonly wallTimeMs: number;
  readonly timeToPayUrlMs: number | null;
  readonly paymentPage: AgentEvalBrowserObservations["paymentPage"];
  readonly routes: AgentEvalBrowserObservations["routes"];
  readonly tabCount: number;
};

type FailureCounts = Readonly<Record<AgentEvalFailureCategory, number>>;

type AgentEvalSummaryCell = {
  readonly taskId: AgentEvalTaskId;
  readonly harnessId: string;
  readonly locale: Locale;
  readonly runs: number;
  readonly successes: number;
  readonly successRate: number;
  readonly medianSteps: number | null;
  readonly medianWallTimeMs: number | null;
  readonly medianTimeToPayUrlMs: number | null;
  readonly costUsd: number | null;
  readonly failures: FailureCounts;
};

/** How agents handled the hosted payment page, across runs that opened it. */
type AgentEvalPaymentHandoff = {
  readonly harnessId: string;
  readonly runsWithPaymentPage: number;
  readonly openedInNewTab: number;
  readonly openedInSameTab: number;
  readonly actedInPaymentPage: number;
  readonly medianOpenedAfterMs: number | null;
};

export type AgentEvalSummary = {
  readonly runSetId: string;
  /** The verified preview every run in the set targeted. */
  readonly target: AgentEvalTarget;
  readonly runs: number;
  readonly successes: number;
  readonly cells: readonly AgentEvalSummaryCell[];
  readonly failures: FailureCounts;
  readonly paymentHandoff: readonly AgentEvalPaymentHandoff[];
  /** Cells with fewer runs than the minimum; their rates are not comparable. */
  readonly cellsBelowMinimumRuns: number;
};

const median = (values: readonly number[]): number | null => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const upper = sorted[middle] ?? 0;
  return sorted.length % 2 === 1
    ? upper
    : ((sorted[middle - 1] ?? 0) + upper) / 2;
};

const countFailures = (results: readonly AgentEvalRunResult[]): FailureCounts =>
  Object.fromEntries(
    agentEvalFailureCategories.map((category) => [
      category,
      results.filter((result) => result.failureCategory === category).length,
    ])
  ) as Record<AgentEvalFailureCategory, number>;

const definedNumbers = (values: readonly (number | null)[]) =>
  values.filter((value): value is number => value !== null);

/** Aggregates one run set's results, one cell per task, harness, and locale. */
export const summarizeAgentEvalResults = (
  {
    runSetId,
    target,
  }: { readonly runSetId: string; readonly target: AgentEvalTarget },
  results: readonly AgentEvalRunResult[]
): AgentEvalSummary => {
  const cells = [
    ...Map.groupBy(results, (result) =>
      [result.taskId, result.harnessId, result.locale].join("\u0000")
    ).values(),
  ]
    .map((group): AgentEvalSummaryCell => {
      const [first] = group as [AgentEvalRunResult, ...AgentEvalRunResult[]];
      const successes = group.filter((result) => result.success).length;
      const costs = definedNumbers(group.map((result) => result.costUsd));
      return {
        costUsd:
          costs.length === 0
            ? null
            : costs.reduce((total, cost) => total + cost, 0),
        failures: countFailures(group),
        harnessId: first.harnessId,
        locale: first.locale,
        medianSteps: median(
          definedNumbers(group.map((result) => result.steps))
        ),
        medianTimeToPayUrlMs: median(
          definedNumbers(group.map((result) => result.timeToPayUrlMs))
        ),
        medianWallTimeMs: median(group.map((result) => result.wallTimeMs)),
        runs: group.length,
        successRate: successes / group.length,
        successes,
        taskId: first.taskId,
      };
    })
    .sort(
      (left, right) =>
        left.taskId.localeCompare(right.taskId) ||
        left.harnessId.localeCompare(right.harnessId) ||
        left.locale.localeCompare(right.locale)
    );

  const paymentHandoff = [
    ...Map.groupBy(results, (result) => result.harnessId).values(),
  ]
    .map((group): AgentEvalPaymentHandoff => {
      const pages = group.flatMap((result) =>
        result.paymentPage ? [result.paymentPage] : []
      );
      return {
        actedInPaymentPage: pages.filter((page) => page.actedIn).length,
        harnessId: group[0]?.harnessId ?? "",
        medianOpenedAfterMs: median(pages.map((page) => page.openedAfterMs)),
        openedInNewTab: pages.filter((page) => page.inNewTab).length,
        openedInSameTab: pages.filter((page) => !page.inNewTab).length,
        runsWithPaymentPage: pages.length,
      };
    })
    .sort((left, right) => left.harnessId.localeCompare(right.harnessId));

  return {
    cells,
    cellsBelowMinimumRuns: cells.filter(
      (cell) => cell.runs < agentEvalMinimumRunsPerCell
    ).length,
    failures: countFailures(results),
    paymentHandoff,
    runSetId,
    runs: results.length,
    target,
    successes: results.filter((result) => result.success).length,
  };
};

const formatPercent = (rate: number) => `${Math.round(rate * 100)}%`;

const formatSeconds = (milliseconds: number | null) =>
  milliseconds === null ? "–" : `${Math.round(milliseconds / 1000)} s`;

const formatCost = (cost: number | null) =>
  cost === null ? "–" : `$${cost.toFixed(2)}`;

const formatFailures = (failures: FailureCounts) =>
  agentEvalFailureCategories
    .filter((category) => failures[category] > 0)
    .map((category) => `${category} ${failures[category]}`)
    .join(", ") || "–";

/** The Markdown results table posted on the eval ticket. */
export const formatAgentEvalSummaryMarkdown = (
  summary: AgentEvalSummary
): string => {
  const lines = [
    `## Agent eval results: ${summary.runSetId}`,
    "",
    `Preview deployment \`${summary.target.deploymentId}\` built from \`${summary.target.sha}\`, verified ${summary.target.verifiedAt}.`,
    "",
    `${summary.successes} of ${summary.runs} runs passed (${formatPercent(summary.runs === 0 ? 0 : summary.successes / summary.runs)}).`,
  ];
  if (summary.cellsBelowMinimumRuns > 0) {
    lines.push(
      "",
      `${summary.cellsBelowMinimumRuns} task, harness, and locale combinations ran fewer than ${agentEvalMinimumRunsPerCell} times; their rates are not comparable.`
    );
  }
  lines.push(
    "",
    "| Task | Harness | Locale | Passed | Success rate | Median steps | Median wall time | Median time to Pay | Cost | Failures |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ...summary.cells.map((cell) =>
      [
        cell.taskId,
        cell.harnessId,
        cell.locale,
        `${cell.successes}/${cell.runs}`,
        formatPercent(cell.successRate),
        cell.medianSteps === null ? "–" : String(cell.medianSteps),
        formatSeconds(cell.medianWallTimeMs),
        formatSeconds(cell.medianTimeToPayUrlMs),
        formatCost(cell.costUsd),
        formatFailures(cell.failures),
      ]
        .join(" | ")
        .replace(/^/, "| ")
        .concat(" |")
    ),
    "",
    "### Failure categories",
    "",
    "| Category | Runs |",
    "| --- | --- |",
    ...agentEvalFailureCategories.map(
      (category) => `| ${category} | ${summary.failures[category]} |`
    ),
    "",
    "### Payment page handoff",
    "",
    "| Harness | Runs that opened it | New tab | Same tab | Acted in it | Median time to open |",
    "| --- | --- | --- | --- | --- | --- |",
    ...summary.paymentHandoff.map(
      (row) =>
        `| ${row.harnessId} | ${row.runsWithPaymentPage} | ${row.openedInNewTab} | ${row.openedInSameTab} | ${row.actedInPaymentPage} | ${formatSeconds(row.medianOpenedAfterMs)} |`
    ),
    ""
  );
  return lines.join("\n");
};
