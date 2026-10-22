import { emailAutomationTickMinutes } from "@deskohub/workspace-admin-api";

/**
 * The first engine tick at or after `at`. The engine ticks every
 * `emailAutomationTickMinutes` from the hour in UTC, which are the same
 * minutes in Prague time, so no time zone is needed.
 */
export const automationTickAtOrAfter = (at: Temporal.Instant) =>
  at.round({
    smallestUnit: "minute",
    roundingIncrement: emailAutomationTickMinutes,
    roundingMode: "ceil",
  });

/**
 * The engine tick at or before `at`: the tick a planner or work unit
 * running at `at` is processing, whatever the cron's jitter or the unit's
 * lag (D36). Never after `at`, so nothing due later than `at` is due on it.
 */
export const automationTickAtOrBefore = (at: Temporal.Instant) =>
  at.round({
    smallestUnit: "minute",
    roundingIncrement: emailAutomationTickMinutes,
    roundingMode: "floor",
  });
