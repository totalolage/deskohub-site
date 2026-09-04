import { describe, expect, test } from "bun:test";
import {
  magicLinkOperationWindowMs,
  makeMagicLinkRateBudget,
} from "./rate-budget";
import { workspaceE2ETimeouts } from "../timeouts";

const originalAccountWorkBudgetMs = 8 * 60_000;

describe("magic-link rate budget", () => {
  test("admits up to the configured operations per rolling window", () => {
    let nowMs = 0;
    const budget = makeMagicLinkRateBudget({
      maxPerWindow: 2,
      now: () => nowMs,
      windowMs: 600_000,
    });

    expect(budget.tryReserve("send")).toBe(true);
    expect(budget.tryReserve("send")).toBe(true);
    nowMs = 1;
    expect(budget.tryReserve("send")).toBe(false);
  });

  test("tracks send and verification budgets independently", () => {
    let nowMs = 0;
    const budget = makeMagicLinkRateBudget({
      maxPerWindow: 1,
      now: () => nowMs,
      windowMs: 600_000,
    });

    expect(budget.tryReserve("send")).toBe(true);
    expect(budget.tryReserve("verify")).toBe(true);
    nowMs = 599_999;
    expect(budget.tryReserve("send")).toBe(false);
  });

  test("releases capacity once the rolling window has passed", () => {
    let nowMs = 0;
    const budget = makeMagicLinkRateBudget({
      maxPerWindow: 1,
      now: () => nowMs,
      windowMs: 600_000,
    });

    expect(budget.tryReserve("send")).toBe(true);
    nowMs = 600_000;
    expect(budget.tryReserve("send")).toBe(true);
  });

  test("blocks a full production rolling window before releasing capacity", () => {
    let nowMs = 0;
    const budget = makeMagicLinkRateBudget({
      maxPerWindow: 1,
      now: () => nowMs,
    });

    expect(budget.tryReserve("send")).toBe(true);
    nowMs = magicLinkOperationWindowMs - 1;
    expect(budget.tryReserve("send")).toBe(false);
    nowMs = magicLinkOperationWindowMs;
    expect(budget.tryReserve("send")).toBe(true);
  });

  test("accountCase leaves the original work budget after one full rate window", () => {
    expect(workspaceE2ETimeouts.accountCase).toBeGreaterThanOrEqual(
      magicLinkOperationWindowMs + originalAccountWorkBudgetMs
    );
  });
});
