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

/** The engine tick after the one at or after `at`. */
export const automationTickAfter = (at: Temporal.Instant) =>
  automationTickAtOrAfter(at).add({ minutes: emailAutomationTickMinutes });

/** The engine tick before the one at or after `at`. */
export const automationTickBefore = (at: Temporal.Instant) =>
  automationTickAtOrAfter(at).subtract({ minutes: emailAutomationTickMinutes });
