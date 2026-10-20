import { describe, expect, test } from "bun:test";
import type {
  AutomationStepType as AutomationStep,
  AutomationStepIdType as AutomationStepId,
  AutomationWaitType as AutomationWait,
  CalendarExpressionType as CalendarExpression,
  InSavedAudienceType as InSavedAudience,
} from "@deskohub/workspace-admin-api";
import { Option } from "effect";
import type { AudienceFilterOutcome } from "../audience-filter";
import {
  evaluateStep,
  type StepState,
  type StepTransition,
} from "./automation-step-evaluation";

const timeZone = "Europe/Prague";

/** A Prague wall time ("2026-12-01T09:00") as an instant. */
const prague = (dateTime: string) =>
  Temporal.PlainDateTime.from(dateTime).toZonedDateTime(timeZone).toInstant();

/** An instant from a wall time with an explicit offset, for DST hours. */
const offsetTime = (dateTime: string) => Temporal.Instant.from(dateTime);

const stepId = "step" as AutomationStepId;

const conditionStep: AutomationStep = {
  _tag: "Condition",
  id: stepId,
  filter: {
    _tag: "InAudience",
    audienceId: "audience" as InSavedAudience["audienceId"],
    operator: "in",
  },
};
const sendStep: AutomationStep = { _tag: "Send", id: stepId };
const waitStep = (wait: AutomationWait): AutomationStep => ({
  _tag: "Wait",
  id: stepId,
  wait,
});
const durationStep = (
  count: number,
  unit: Extract<AutomationWait, { _tag: "Duration" }>["unit"]
) => waitStep({ _tag: "Duration", count, unit });
const calendarStep = (expression: CalendarExpression) =>
  waitStep({ _tag: "Calendar", expression });

/** A just-entered run at `at`. */
const ready = (
  step: AutomationStep,
  at: Temporal.Instant,
  overrides: Partial<StepState> = {}
): StepState => ({
  step,
  phase: "ready",
  at,
  stepEnteredAt: at,
  dueAt: Option.none(),
  resumedAt: Option.none(),
  condition: Option.none(),
  ...overrides,
});

/** A waiting run, entered earlier and due at `dueAt`, evaluated at `at`. */
const waiting = (
  step: AutomationStep,
  dueAt: Temporal.Instant,
  at: Temporal.Instant,
  overrides: Partial<StepState> = {}
): StepState => ({
  ...ready(step, at, { stepEnteredAt: prague("2026-01-01T00:00") }),
  phase: "waiting",
  dueAt: Option.some(dueAt),
  ...overrides,
});

const advance = (at: Temporal.Instant): StepTransition => ({
  _tag: "Advance",
  at,
});
const wait = (dueAt: Temporal.Instant): StepTransition => ({
  _tag: "Wait",
  dueAt,
});

const at = prague("2026-11-16T09:00");

describe("Condition step", () => {
  test("asks for an evaluation before one is given", () => {
    expect(evaluateStep(ready(conditionStep, at))).toEqual({
      _tag: "EvaluateCondition",
    });
  });

  test("advances at the evaluation time on a match", () => {
    expect(
      evaluateStep(
        ready(conditionStep, at, { condition: Option.some("match") })
      )
    ).toEqual(advance(at));
  });

  test.each<AudienceFilterOutcome>(["noMatch", "unknown"])(
    "ends condition-failed on %s",
    (outcome) => {
      expect(
        evaluateStep(
          ready(conditionStep, at, { condition: Option.some(outcome) })
        )
      ).toEqual({ _tag: "End", outcome: "condition-failed" });
    }
  );
});

describe("Send step", () => {
  test("sends when ready", () => {
    expect(evaluateStep(ready(sendStep, at))).toEqual({ _tag: "Send" });
  });

  test("sends when a deferred send is due", () => {
    expect(
      evaluateStep(waiting(sendStep, prague("2026-11-16T08:00"), at))
    ).toEqual({ _tag: "Send" });
  });
});

describe("Duration wait", () => {
  test.each([
    [2, "minute", "2026-11-16T08:02"],
    [2, "hour", "2026-11-16T10:00"],
    [3, "day", "2026-11-19T08:00"],
    [1, "week", "2026-11-23T08:00"],
    [1, "month", "2026-12-16T08:00"],
  ] as const)("waits %i %s from step entry", (count, unit, due) => {
    // `at` is later than the entry, so the delay counts from the entry.
    const later = prague("2026-11-16T08:00:30");
    expect(
      evaluateStep(
        ready(durationStep(count, unit), later, {
          stepEnteredAt: prague("2026-11-16T08:00"),
        })
      )
    ).toEqual(wait(prague(due)));
  });

  test("a wait first checked a tick after entry advances at once when due", () => {
    // Entered after the 10:15 tick's timers, so first checked at 10:30.
    const tick = prague("2026-11-16T10:30");
    expect(
      evaluateStep(
        ready(durationStep(7, "minute"), tick, {
          stepEnteredAt: prague("2026-11-16T10:15:05"),
        })
      )
    ).toEqual(advance(tick));
  });

  test("counts a wait due within the tolerance as due", () => {
    const tick = prague("2026-11-16T12:15");
    expect(
      evaluateStep(
        waiting(durationStep(2, "hour"), prague("2026-11-16T12:15:59"), tick)
      )
    ).toEqual(advance(tick));
    expect(
      evaluateStep(
        ready(durationStep(2, "hour"), tick, {
          stepEnteredAt: prague("2026-11-16T10:15:05"),
        })
      )
    ).toEqual(advance(tick));
    const later = prague("2026-11-16T12:16:01");
    expect(evaluateStep(waiting(durationStep(2, "hour"), later, tick))).toEqual(
      wait(later)
    );
  });

  test("advances at the transition time once due", () => {
    expect(
      evaluateStep(
        waiting(durationStep(2, "hour"), prague("2026-11-16T08:30"), at)
      )
    ).toEqual(advance(at));
  });

  test("keeps the due time while not due", () => {
    const dueAt = prague("2026-11-16T10:00");
    expect(evaluateStep(waiting(durationStep(2, "hour"), dueAt, at))).toEqual(
      wait(dueAt)
    );
  });

  test("proceeds at once after a delay that a pause overshot", () => {
    const resumedAt = prague("2026-11-20T14:00");
    expect(
      evaluateStep(
        waiting(durationStep(1, "day"), prague("2026-11-17T08:00"), resumedAt, {
          resumedAt: Option.some(resumedAt),
        })
      )
    ).toEqual(advance(resumedAt));
  });

  describe("across the 2026 spring gap (29 March)", () => {
    test("a day keeps the wall time, 23 hours later", () => {
      expect(
        evaluateStep(ready(durationStep(1, "day"), prague("2026-03-28T10:00")))
      ).toEqual(wait(offsetTime("2026-03-29T10:00+02:00")));
    });

    test("a day from a wall time the gap skips moves forward by the gap", () => {
      expect(
        evaluateStep(ready(durationStep(1, "day"), prague("2026-03-28T02:30")))
      ).toEqual(wait(offsetTime("2026-03-29T03:30+02:00")));
    });

    test("hours are exact", () => {
      expect(
        evaluateStep(
          ready(durationStep(24, "hour"), prague("2026-03-28T10:00"))
        )
      ).toEqual(wait(offsetTime("2026-03-29T11:00+02:00")));
    });
  });

  describe("across the 2026 autumn overlap (25 October)", () => {
    test("a day keeps the wall time, 25 hours later", () => {
      expect(
        evaluateStep(ready(durationStep(1, "day"), prague("2026-10-24T10:00")))
      ).toEqual(wait(offsetTime("2026-10-25T10:00+01:00")));
    });

    test("an hour from the first 02:30 lands on the second", () => {
      expect(
        evaluateStep(
          ready(durationStep(1, "hour"), offsetTime("2026-10-25T02:30+02:00"))
        )
      ).toEqual(wait(offsetTime("2026-10-25T02:30+01:00")));
    });

    test("minutes are exact", () => {
      expect(
        evaluateStep(
          ready(
            durationStep(90, "minute"),
            offsetTime("2026-10-25T01:45+02:00")
          )
        )
      ).toEqual(wait(offsetTime("2026-10-25T02:15+01:00")));
    });
  });
});

describe("Calendar wait", () => {
  const mondayMorning = calendarStep({ weekdays: ["monday"], hours: [10] });

  test("advances at once when the next start is within the tolerance", () => {
    const tick = prague("2026-11-16T09:59:30");
    expect(evaluateStep(ready(mondayMorning, tick))).toEqual(advance(tick));
    expect(
      evaluateStep(waiting(mondayMorning, prague("2026-11-16T10:00"), tick))
    ).toEqual(advance(tick));
  });

  test("advances at once while the expression holds", () => {
    const monday = prague("2026-11-16T10:40");
    expect(evaluateStep(ready(mondayMorning, monday))).toEqual(advance(monday));
  });

  test("waits for the next start otherwise", () => {
    expect(evaluateStep(ready(mondayMorning, at))).toEqual(
      wait(prague("2026-11-16T10:00"))
    );
  });

  test("ends failed when no start falls within eight years", () => {
    expect(
      evaluateStep(ready(calendarStep({ daysOfMonth: [31], months: [2] }), at))
    ).toEqual({
      _tag: "End",
      outcome: "failed",
      reason: "evaluation-unavailable",
    });
  });

  test("advances when due", () => {
    const dueAt = prague("2026-11-16T10:00");
    expect(evaluateStep(waiting(mondayMorning, dueAt, dueAt))).toEqual(
      advance(dueAt)
    );
  });

  test("advances a late run without re-checking the expression", () => {
    // The planner ran after the period ended; the computed due time stands.
    const late = prague("2026-11-16T11:30");
    expect(
      evaluateStep(waiting(mondayMorning, prague("2026-11-16T10:00"), late))
    ).toEqual(advance(late));
  });

  test("keeps the due time while not due", () => {
    const dueAt = prague("2026-11-16T10:00");
    expect(evaluateStep(waiting(mondayMorning, dueAt, at))).toEqual(
      wait(dueAt)
    );
  });

  test("advances a run due after the last resume", () => {
    const dueAt = prague("2026-11-16T10:00");
    const late = prague("2026-11-16T11:30");
    expect(
      evaluateStep(
        waiting(mondayMorning, dueAt, late, {
          resumedAt: Option.some(prague("2026-11-12T09:00")),
        })
      )
    ).toEqual(advance(late));
  });

  describe("after a pause overshot the due time", () => {
    const dueAt = prague("2026-11-16T10:00");

    test("waits for the next start when the expression no longer holds", () => {
      const resumedAt = prague("2026-11-17T09:00");
      expect(
        evaluateStep(
          waiting(mondayMorning, dueAt, resumedAt, {
            resumedAt: Option.some(resumedAt),
          })
        )
      ).toEqual(wait(prague("2026-11-23T10:00")));
    });

    test("advances when the expression holds again at resume", () => {
      const resumedAt = prague("2026-11-23T10:20");
      expect(
        evaluateStep(
          waiting(mondayMorning, dueAt, resumedAt, {
            resumedAt: Option.some(resumedAt),
          })
        )
      ).toEqual(advance(resumedAt));
    });
  });

  describe("in the 2026 spring gap (29 March, 02:00 → 03:00)", () => {
    const twoOClock = calendarStep({ hours: [2] });

    test("waits for 03:00 CEST, where the skipped hour starts", () => {
      expect(
        evaluateStep(ready(twoOClock, prague("2026-03-29T01:30")))
      ).toEqual(wait(offsetTime("2026-03-29T03:00+02:00")));
    });

    test("a skipped wall time starts shifted by the gap", () => {
      expect(
        evaluateStep(
          ready(
            calendarStep({ hours: [2], minutes: [30] }),
            prague("2026-03-29T01:00")
          )
        )
      ).toEqual(wait(offsetTime("2026-03-29T03:30+02:00")));
    });

    test("the stored due time advances although the expression doesn't hold", () => {
      const dueAt = offsetTime("2026-03-29T03:00+02:00");
      expect(evaluateStep(waiting(twoOClock, dueAt, dueAt))).toEqual(
        advance(dueAt)
      );
    });
  });

  describe("in the 2026 autumn overlap (25 October, 03:00 → 02:00)", () => {
    const twoOClock = calendarStep({ hours: [2] });

    test("waits for the first 02:00 only", () => {
      expect(
        evaluateStep(ready(twoOClock, offsetTime("2026-10-25T01:30+02:00")))
      ).toEqual(wait(offsetTime("2026-10-25T02:00+02:00")));
    });

    test("a run reaching the wait in the repeated hour proceeds at once", () => {
      const repeated = offsetTime("2026-10-25T02:15+01:00");
      expect(evaluateStep(ready(twoOClock, repeated))).toEqual(
        advance(repeated)
      );
    });

    test("after the repeated hour it waits for the next day", () => {
      expect(
        evaluateStep(ready(twoOClock, offsetTime("2026-10-25T03:00+01:00")))
      ).toEqual(wait(prague("2026-10-26T02:00")));
    });
  });
});
