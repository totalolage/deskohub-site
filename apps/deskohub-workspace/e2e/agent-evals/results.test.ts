import { describe, expect, test } from "bun:test";
import {
  type AgentEvalRunResult,
  formatAgentEvalSummaryMarkdown,
  summarizeAgentEvalResults,
} from "./results";

const run = (overrides: Partial<AgentEvalRunResult>): AgentEvalRunResult => ({
  costUsd: null,
  failureCategory: null,
  finalAnswer: null,
  harnessError: null,
  harnessId: "playwright-mcp",
  harnessOutcome: "completed",
  locale: "en-US",
  missingFacts: null,
  paymentPage: null,
  perception: "accessibility-tree",
  reason: "matched",
  repeat: 0,
  routes: [],
  runSetId: "set",
  startedAt: "2026-10-18T10:00:00Z",
  steps: 10,
  success: true,
  tabCount: 1,
  taskId: "open-space-to-pay",
  timeToPayUrlMs: 60_000,
  version: 1,
  wallTimeMs: 90_000,
  ...overrides,
});

const failedRun = (
  failureCategory: AgentEvalRunResult["failureCategory"],
  overrides: Partial<AgentEvalRunResult> = {}
) =>
  run({ failureCategory, reason: "wrong-date", success: false, ...overrides });

const target = {
  deploymentId: "dpl_synthetic",
  sha: "a".repeat(40),
  verifiedAt: "2026-10-18T12:00:00.000Z",
};

describe("summarizeAgentEvalResults", () => {
  const results = [
    run({ costUsd: 0.5, steps: 8, wallTimeMs: 60_000 }),
    run({ costUsd: 0.25, steps: 12, wallTimeMs: 120_000 }),
    failedRun("date-picker", { steps: 30, timeToPayUrlMs: null }),
    run({ locale: "cs-CZ" }),
    failedRun("payment-tab", {
      harnessId: "screenshot-only",
      paymentPage: { actedIn: true, inNewTab: true, openedAfterMs: 100_000 },
      perception: "screenshot",
      taskId: "open-space-payment",
    }),
    run({
      harnessId: "screenshot-only",
      paymentPage: { actedIn: false, inNewTab: false, openedAfterMs: 50_000 },
      perception: "screenshot",
      taskId: "open-space-payment",
    }),
  ];
  const summary = summarizeAgentEvalResults(
    { runSetId: "set", target },
    results
  );

  test("gives one cell per task, harness, and locale", () => {
    expect(
      summary.cells.map((cell) => [
        cell.taskId,
        cell.harnessId,
        cell.locale,
        cell.successes,
        cell.runs,
      ])
    ).toEqual([
      ["open-space-payment", "screenshot-only", "en-US", 1, 2],
      ["open-space-to-pay", "playwright-mcp", "cs-CZ", 1, 1],
      ["open-space-to-pay", "playwright-mcp", "en-US", 2, 3],
    ]);
  });

  test("reports medians over every run and cost only when reported", () => {
    const cell = summary.cells.find(
      (entry) =>
        entry.taskId === "open-space-to-pay" && entry.locale === "en-US"
    );
    expect(cell).toMatchObject({
      costUsd: 0.75,
      medianSteps: 12,
      medianTimeToPayUrlMs: 60_000,
      medianWallTimeMs: 90_000,
      successRate: 2 / 3,
    });
    expect(cell?.failures["date-picker"]).toBe(1);
    expect(summary.cells[1]?.costUsd).toBeNull();
  });

  test("counts failure categories and the payment-page handoff", () => {
    expect(summary.failures).toMatchObject({
      "date-picker": 1,
      navigation: 0,
      "payment-tab": 1,
    });
    expect(summary.paymentHandoff).toEqual([
      {
        actedInPaymentPage: 0,
        harnessId: "playwright-mcp",
        medianOpenedAfterMs: null,
        openedInNewTab: 0,
        openedInSameTab: 0,
        runsWithPaymentPage: 0,
      },
      {
        actedInPaymentPage: 1,
        harnessId: "screenshot-only",
        medianOpenedAfterMs: 75_000,
        openedInNewTab: 1,
        openedInSameTab: 1,
        runsWithPaymentPage: 2,
      },
    ]);
    expect(summary).toMatchObject({ runs: 6, successes: 4 });
  });

  test("flags cells below the five-run minimum", () => {
    expect(summary.cellsBelowMinimumRuns).toBe(3);
    expect(
      summarizeAgentEvalResults(
        { runSetId: "set", target },
        Array.from({ length: 5 }, (_, repeat) => run({ repeat }))
      ).cellsBelowMinimumRuns
    ).toBe(0);
  });
});

describe("formatAgentEvalSummaryMarkdown", () => {
  test("renders the success table, failure categories, and payment handoff", () => {
    const markdown = formatAgentEvalSummaryMarkdown(
      summarizeAgentEvalResults({ runSetId: "20261018-120000-abcd", target }, [
        run({ costUsd: 0.5 }),
        failedRun("date-picker"),
      ])
    );
    expect(markdown).toContain("## Agent eval results: 20261018-120000-abcd");
    expect(markdown).toContain(
      `Preview deployment \`dpl_synthetic\` built from \`${"a".repeat(40)}\``
    );
    expect(markdown).toContain("1 of 2 runs passed (50%).");
    expect(markdown).toContain(
      "| open-space-to-pay | playwright-mcp | en-US | 1/2 | 50% | 10 | 90 s | 60 s | $0.50 | date-picker 1 |"
    );
    expect(markdown).toContain("| date-picker | 1 |");
    expect(markdown).toContain("ran fewer than 5 times");
  });
});
