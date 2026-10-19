import { Schema } from "effect";

/**
 * Kinds of engine work unit. The table has no check on `kind`: each
 * deployment claims, promotes and reaps only the kinds it supports, so a
 * newer kind waits for a deployment that can run it.
 */
export const automationWorkUnitKinds = [
  "sweep-page",
  "intake",
  "fire-chunk",
  "condition",
  "deliver",
  "preview",
] as const;
const automationWorkUnitKindSchema = Schema.Literals(automationWorkUnitKinds);
export type AutomationWorkUnitKind = typeof automationWorkUnitKindSchema.Type;

/**
 * A unit is `planned` without a slot, holds one while `enqueued` or
 * `claimed`, and frees it when it settles `done`, `dropped` or `failed`.
 */
export const automationWorkUnitStatuses = [
  "planned",
  "enqueued",
  "claimed",
  "done",
  "dropped",
  "failed",
] as const;
const automationWorkUnitStatusSchema = Schema.Literals(
  automationWorkUnitStatuses
);
export type AutomationWorkUnitStatus =
  typeof automationWorkUnitStatusSchema.Type;

/**
 * Promotion order, lowest first. Strict priority still drains every class
 * while demand stays below capacity; under overload the lowest class lags,
 * so a schedule that fires too often delays its own fires, not events,
 * conditions, sends or previews.
 */
export const automationWorkUnitPriorities = {
  "sweep-page": 1,
  intake: 2,
  deliver: 3,
  condition: 4,
  preview: 5,
  "fire-chunk": 6,
} as const satisfies Record<AutomationWorkUnitKind, number>;
