import { Schema } from "effect";

export const automationVersionIdSchema = Schema.NonEmptyString.pipe(
  Schema.brand("AutomationVersionId")
).annotate({
  identifier: "AutomationVersionId",
  description:
    "Database-generated identifier of one published automation version.",
});
export type AutomationVersionId = typeof automationVersionIdSchema.Type;

export const automationRunIdSchema = Schema.NonEmptyString.pipe(
  Schema.brand("AutomationRunId")
).annotate({
  identifier: "AutomationRunId",
  description:
    "Database-generated identifier of one customer's pass through an automation version.",
});
export type AutomationRunId = typeof automationRunIdSchema.Type;

const automationStepIdSchema = Schema.NonEmptyString.pipe(
  Schema.brand("AutomationStepId")
).annotate({
  identifier: "AutomationStepId",
  description: "Stable identifier of one step in an automation flow.",
});
export type AutomationStepId = typeof automationStepIdSchema.Type;

export const automationWorkUnitIdSchema = Schema.NonEmptyString.pipe(
  Schema.brand("AutomationWorkUnitId")
).annotate({
  identifier: "AutomationWorkUnitId",
  description:
    "Database-generated identifier of one automation engine work unit.",
});
export type AutomationWorkUnitId = typeof automationWorkUnitIdSchema.Type;

export const automationPreviewIdSchema = Schema.NonEmptyString.pipe(
  Schema.brand("AutomationPreviewId")
).annotate({
  identifier: "AutomationPreviewId",
  description: "Database-generated identifier of one automation dry run.",
});
export type AutomationPreviewId = typeof automationPreviewIdSchema.Type;
