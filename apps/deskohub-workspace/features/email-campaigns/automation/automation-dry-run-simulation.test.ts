import { describe, expect, test } from "bun:test";
import {
  type AutomationStepType as AutomationStep,
  AutomationStepId,
  type AutomationWaitType as AutomationWait,
  type InSavedAudienceType as InSavedAudience,
} from "@deskohub/workspace-admin-api";
import { Effect, Option } from "effect";
import type { AudienceFilterOutcome } from "../audience-filter";
import {
  type ReplayedEvent,
  replayCustomerEvents,
  simulateRun,
} from "./automation-dry-run-simulation";

const at = (instant: string) => Temporal.Instant.from(instant);

const send: AutomationStep = {
  _tag: "Send",
  id: AutomationStepId.make("send"),
};

const condition = (id: string): AutomationStep => ({
  _tag: "Condition",
  id: AutomationStepId.make(id),
  filter: {
    _tag: "InAudience",
    audienceId: "audience" as InSavedAudience["audienceId"],
    operator: "in",
  },
});

const wait = (wait: AutomationWait): AutomationStep => ({
  _tag: "Wait",
  id: AutomationStepId.make("wait"),
  wait,
});

/** Simulates `steps` from `triggerAt`, every condition matching, and records when each was asked. */
const simulate = (steps: readonly AutomationStep[], triggerAt: string) => {
  const asked: string[] = [];
  const end = Effect.runSync(
    simulateRun({
      steps: [...steps, send],
      triggerAt: at(triggerAt),
      evaluateCondition: (step, conditionAt) => {
        asked.push(`${step.id}@${conditionAt.toString()}`);
        return Effect.succeed<AudienceFilterOutcome>("match");
      },
    })
  );
  return { end, asked };
};

describe("simulateRun on engine ticks", () => {
  test("an event at 10:07 with a two-hour delay sends at 12:15, not 12:07", () => {
    const { end } = simulate(
      [wait({ _tag: "Duration", count: 2, unit: "hour" })],
      "2026-10-21T10:07:00Z"
    );
    expect(end).toMatchObject({ outcome: "would-send" });
    expect(end.at).toEqual(at("2026-10-21T12:15:00Z"));
  });

  test("conditions and the send happen on the trigger's tick", () => {
    const { end, asked } = simulate(
      [condition("first"), condition("second")],
      "2026-10-21T10:07:00Z"
    );
    expect(asked).toEqual([
      "first@2026-10-21T10:15:00Z",
      "second@2026-10-21T10:15:00Z",
    ]);
    expect(end.at).toEqual(at("2026-10-21T10:15:00Z"));
  });

  test("a calendar wait for a non-tick minute completes on the tick after it", () => {
    const { end } = simulate(
      [wait({ _tag: "Calendar", expression: { minutes: [7] } })],
      "2026-10-21T10:00:00Z"
    );
    expect(end.at).toEqual(at("2026-10-21T10:15:00Z"));
  });

  test("a calendar wait that holds on the tick it's entered completes then", () => {
    const { end } = simulate(
      [wait({ _tag: "Calendar", expression: { hours: [11] } })],
      "2026-10-21T08:52:00Z"
    );
    // 11:00 in Prague.
    expect(end.at).toEqual(at("2026-10-21T09:00:00Z"));
  });

  test("a schedule fire on a tick enters on that tick", () => {
    const { end } = simulate(
      [wait({ _tag: "Duration", count: 1, unit: "day" })],
      "2026-10-21T08:30:00Z"
    );
    expect(end.at).toEqual(at("2026-10-22T08:30:00Z"));
  });

  test("a condition after a wait is asked on the tick the wait completes", () => {
    const { asked } = simulate(
      [
        wait({ _tag: "Duration", count: 50, unit: "minute" }),
        condition("after"),
      ],
      "2026-10-21T10:00:00Z"
    );
    expect(asked).toEqual(["after@2026-10-21T11:00:00Z"]);
  });

  test("a one-minute wait entered on a tick sends on the next tick", () => {
    const { end } = simulate(
      [wait({ _tag: "Duration", count: 1, unit: "minute" })],
      "2026-10-21T12:00:00Z"
    );
    expect(end).toMatchObject({ outcome: "would-send" });
    expect(end.at).toEqual(at("2026-10-21T12:15:00Z"));
  });

  test("a calendar wait for a minute after the tick sends on the next tick", () => {
    const { end } = simulate(
      [wait({ _tag: "Calendar", expression: { minutes: [1] } })],
      "2026-10-21T12:00:00Z"
    );
    expect(end).toMatchObject({ outcome: "would-send" });
    expect(end.at).toEqual(at("2026-10-21T12:15:00Z"));
  });

  test("an event just after a tick waits two hours from the next tick", () => {
    const { end } = simulate(
      [wait({ _tag: "Duration", count: 2, unit: "hour" })],
      "2026-10-21T12:00:20Z"
    );
    expect(end.at).toEqual(at("2026-10-21T14:15:00Z"));
  });

  test("a two-hour delay entered on a tick sends two hours later", () => {
    const { end } = simulate(
      [wait({ _tag: "Duration", count: 2, unit: "hour" })],
      "2026-10-21T12:00:00Z"
    );
    expect(end.at).toEqual(at("2026-10-21T14:00:00Z"));
  });

  test("a day's wait across the autumn DST change keeps Prague's wall time", () => {
    // Taken in on the 00:00 CEST tick, sent at 00:00 CET, 25 hours later.
    const { end } = simulate(
      [wait({ _tag: "Duration", count: 1, unit: "day" })],
      "2026-10-24T21:52:00Z"
    );
    expect(end.at).toEqual(at("2026-10-25T23:00:00Z"));
  });

  test("a 7-minute wait entered at 10:15 completes at 10:30", () => {
    const { end } = simulate(
      [wait({ _tag: "Duration", count: 7, unit: "minute" })],
      "2026-10-21T10:15:00Z"
    );
    expect(end.at).toEqual(at("2026-10-21T10:30:00Z"));
  });
});

describe("replayCustomerEvents on engine ticks", () => {
  /** Replays events where every run sends on its entry tick. */
  const replay = (events: readonly string[]) =>
    Effect.runSync(
      replayCustomerEvents({
        events: events.map(at),
        occurredAt: (event) => event,
        now: at("2026-10-22T00:00:00Z"),
        steps: [send],
        approximation: {
          undatedChangeAt: Option.none(),
          countsSimulatedSends: false,
        },
        replay: (event) =>
          Effect.map(
            simulateRun({
              steps: [send],
              triggerAt: event,
              evaluateCondition: () => Effect.succeed("match" as const),
            }),
            (end): ReplayedEvent => ({ _tag: "Entered", end })
          ),
      })
    ).map(({ outcome }) => [outcome.outcome, outcome.sendAt?.toString()]);

  test("an event taken in on the tick an earlier run ends is already active", () => {
    expect(replay(["2026-10-21T10:01:00Z", "2026-10-21T10:10:00Z"])).toEqual([
      ["would-send", "2026-10-21T10:15:00Z"],
      ["already-active", undefined],
    ]);
  });

  test("an event taken in on a later tick starts its own run", () => {
    expect(replay(["2026-10-21T10:01:00Z", "2026-10-21T10:16:00Z"])).toEqual([
      ["would-send", "2026-10-21T10:15:00Z"],
      ["would-send", "2026-10-21T10:30:00Z"],
    ]);
  });
});
