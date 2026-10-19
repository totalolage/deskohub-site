import type {
  AutomationDurationUnitType as AutomationDurationUnit,
  AutomationStepType as AutomationStep,
  AutomationWaitType as AutomationWait,
  CalendarExpressionType as CalendarExpression,
} from "@deskohub/workspace-admin-api";
import { Option } from "effect";
import {
  holds,
  nextStartWithinHorizon,
} from "@/shared/utils/calendar-expression";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";
import { addCalendarDuration } from "@/shared/utils/temporal";
import type { AudienceFilterOutcome } from "../audience-filter";
import type {
  AutomationRunFailureReason,
  AutomationRunOutcome,
} from "./automation-states";

/** A run at one step, as the engine or the dry run sees it. */
export type StepState = {
  readonly step: AutomationStep;
  readonly phase: "ready" | "waiting";
  /** The engine: the transition time. The dry run: the simulated time. */
  readonly at: Temporal.Instant;
  readonly stepEnteredAt: Temporal.Instant;
  readonly dueAt: Option.Option<Temporal.Instant>;
  /** The automation's last resume. */
  readonly resumedAt: Option.Option<Temporal.Instant>;
  /** The caller's evaluation of a Condition step at `at`. */
  readonly condition: Option.Option<AudienceFilterOutcome>;
};

/** What the engine does with the run next. */
export type StepTransition =
  | { readonly _tag: "EvaluateCondition" }
  | { readonly _tag: "Advance"; readonly at: Temporal.Instant }
  | { readonly _tag: "Wait"; readonly dueAt: Temporal.Instant }
  | {
      readonly _tag: "End";
      readonly outcome: Extract<AutomationRunOutcome, "condition-failed">;
    }
  | {
      readonly _tag: "End";
      readonly outcome: Extract<AutomationRunOutcome, "failed">;
      readonly reason: Extract<
        AutomationRunFailureReason,
        "evaluation-unavailable"
      >;
    }
  | { readonly _tag: "Send" };

const timeZone = workspaceSiteConstants.location.timeZone;

const durationFields = {
  minute: "minutes",
  hour: "hours",
  day: "days",
  week: "weeks",
  month: "months",
} as const satisfies Record<
  AutomationDurationUnit,
  keyof Temporal.DurationLikeObject
>;

/**
 * `from` plus the delay in Prague time: days and longer keep the wall time
 * across DST, minutes and hours are exact.
 */
const addWaitDuration = (
  from: Temporal.Instant,
  { count, unit }: Extract<AutomationWait, { _tag: "Duration" }>
) =>
  addCalendarDuration({
    instant: from,
    duration: { [durationFields[unit]]: count },
    timeZone,
  });

const advance = (at: Temporal.Instant): StepTransition => ({
  _tag: "Advance",
  at,
});

const wait = (dueAt: Temporal.Instant): StepTransition => ({
  _tag: "Wait",
  dueAt,
});

/** The due time of a waiting run; a ready run has none yet. */
const waitingDueAt = (state: StepState) =>
  state.phase === "waiting" ? state.dueAt : Option.none();

const isDue = (dueAt: Temporal.Instant, at: Temporal.Instant) =>
  Temporal.Instant.compare(dueAt, at) <= 0;

const evaluateCondition = ({ condition, at }: StepState): StepTransition =>
  Option.match(condition, {
    onNone: () => ({ _tag: "EvaluateCondition" }),
    onSome: (outcome) =>
      outcome === "match"
        ? advance(at)
        : { _tag: "End", outcome: "condition-failed" },
  });

/**
 * A due delay advances, including one that overshot during a pause (D12).
 * The engine computed `dueAt`, so it isn't recomputed.
 */
const evaluateDurationWait = (
  duration: Extract<AutomationWait, { _tag: "Duration" }>,
  state: StepState
): StepTransition =>
  Option.match(waitingDueAt(state), {
    onNone: () => wait(addWaitDuration(state.stepEnteredAt, duration)),
    onSome: (dueAt) =>
      isDue(dueAt, state.at) ? advance(state.at) : wait(dueAt),
  });

/**
 * Advance while the expression holds, else wait for its next start. A start
 * beyond the eight-year horizon can't be stored as a due time, so the run
 * ends `failed / evaluation-unavailable` rather than waiting unbounded.
 */
const enterCalendarWait = (
  expression: CalendarExpression,
  at: Temporal.Instant
): StepTransition =>
  holds(expression, at)
    ? advance(at)
    : Option.match(nextStartWithinHorizon(expression, at), {
        onNone: () => ({
          _tag: "End",
          outcome: "failed",
          reason: "evaluation-unavailable",
        }),
        onSome: wait,
      });

/**
 * Lateness rule: a due run advances without re-checking `holds`, so a late
 * planner run or a DST gap can't strand it. The exception is a due time a
 * pause passed over, which is re-evaluated as on entry (D12).
 */
const evaluateCalendarWait = (
  expression: CalendarExpression,
  state: StepState
): StepTransition =>
  Option.match(waitingDueAt(state), {
    onNone: () => enterCalendarWait(expression, state.at),
    onSome: (dueAt) => {
      if (!isDue(dueAt, state.at)) {
        return wait(dueAt);
      }
      const overshotPause = Option.exists(
        state.resumedAt,
        (resumedAt) => Temporal.Instant.compare(dueAt, resumedAt) < 0
      );
      return overshotPause
        ? enterCalendarWait(expression, state.at)
        : advance(state.at);
    },
  });

/**
 * The next transition of a run at its step (design §5.8). Pure, so the
 * engine's timers and condition units and the dry run share it. A waiting
 * run that isn't due yet keeps its due time.
 */
export const evaluateStep = (state: StepState): StepTransition => {
  const { step } = state;
  switch (step._tag) {
    case "Condition":
      return evaluateCondition(state);
    case "Wait":
      return step.wait._tag === "Duration"
        ? evaluateDurationWait(step.wait, state)
        : evaluateCalendarWait(step.wait.expression, state);
    case "Send":
      return { _tag: "Send" };
  }
};
