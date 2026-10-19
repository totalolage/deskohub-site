import { Data, type Schema } from "effect";
import type { CalendarExpressionNeverOccurs } from "@/shared/utils/calendar-expression";
import type { AutomationStepId } from "./automation-identifiers";

/**
 * Where in a flow a rule failed: the trigger, or a step by its id. Messages
 * name it, so the operator can find the step to fix.
 */
export type AutomationFlowLocation =
  | { readonly _tag: "Trigger" }
  | { readonly _tag: "Step"; readonly stepId: AutomationStepId };

/**
 * The flow fails Workspace's flow schema, such as an unknown product
 * property, or a domain rule, such as a wait longer than a year. The message
 * is English, actionable, and holds no customer data.
 */
export class AutomationFlowInvalid extends Data.TaggedError(
  "AutomationFlowInvalid"
)<{
  readonly message: string;
  readonly location?: AutomationFlowLocation;
  readonly cause?: Schema.SchemaError;
}> {
  /** Stable across transports, so clients can tell this rejection apart. */
  static readonly code = "flow-invalid";
}

/**
 * A calendar of the flow, the schedule trigger's or a wait step's, has no
 * period start within the eight-year horizon.
 */
export class AutomationCalendarNeverOccurs extends Data.TaggedError(
  "AutomationCalendarNeverOccurs"
)<{
  readonly location: AutomationFlowLocation;
  readonly cause: CalendarExpressionNeverOccurs;
}> {
  /** Stable across transports, so clients can tell this rejection apart. */
  static readonly code = "calendar-never-occurs";
}
