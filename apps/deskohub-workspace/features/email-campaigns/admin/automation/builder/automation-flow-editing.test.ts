import { describe, expect, test } from "bun:test";
import {
  canMoveStep,
  emptyFlowSteps,
  eventTrigger,
  eventTriggerKindOf,
  eventTriggerKinds,
  insertStepAt,
  moveStep,
  newStep,
  newStepId,
  removeStepAt,
  replaceStepAt,
  takesProductFilter,
} from "./automation-flow-editing";
import type { FlowStepValue, FlowTriggerValue } from "./automation-flow-form";

const officeProduct = { family: "office", properties: [] } as const;

const send: FlowStepValue = { _tag: "Send", id: "send" };
const wait = (id: string): FlowStepValue => ({
  _tag: "Wait",
  id,
  wait: { _tag: "Duration", count: 1, unit: "day" },
});
const condition = (id: string): FlowStepValue => ({
  _tag: "Condition",
  id,
  filter: { _tag: "Group", operator: "and", filters: [] },
});

const ids = (steps: readonly FlowStepValue[]) => steps.map(({ id }) => id);

/** The save rule the builder's edits must keep: one send step, last. */
const endsInOneSend = (steps: readonly FlowStepValue[]) =>
  steps.filter(({ _tag }) => _tag === "Send").length === 1 &&
  steps.at(-1)?._tag === "Send";

describe("eventTrigger", () => {
  test("keeps the product filter when switching between reservation events", () => {
    const booked = eventTrigger("reservation-booked", {
      _tag: "ReservationFinished",
      product: officeProduct,
    });
    expect(booked).toEqual({
      _tag: "ReservationBooked",
      product: officeProduct,
    });
    expect(eventTrigger("reservation-cancelled", booked)).toEqual({
      _tag: "ReservationCancelled",
      product: officeProduct,
    });
  });

  test("drops the product filter for account created", () => {
    expect(
      eventTrigger("account-created", {
        _tag: "ReservationStarted",
        product: officeProduct,
      })
    ).toEqual({ _tag: "AccountCreated" });
  });

  test("starts without a product filter when coming from a schedule, account created or nothing", () => {
    const sources: readonly (FlowTriggerValue | null)[] = [
      { _tag: "Schedule", calendar: { hours: [10] } },
      { _tag: "AccountCreated" },
      null,
    ];
    for (const current of sources) {
      const trigger = eventTrigger("reservation-finished", current);
      expect(trigger).toEqual({ _tag: "ReservationFinished" });
      expect("product" in trigger).toBe(false);
    }
  });

  test("round-trips every event kind through its trigger", () => {
    for (const kind of eventTriggerKinds) {
      expect(eventTriggerKindOf(eventTrigger(kind, null))).toBe(kind);
    }
  });

  test("offers a product filter for reservation events only", () => {
    const takesProduct = eventTriggerKinds.filter((kind) =>
      takesProductFilter(eventTrigger(kind, null))
    );
    expect(takesProduct).toEqual(
      eventTriggerKinds.filter((kind) => kind !== "account-created")
    );
  });
});

describe("newStepId", () => {
  test("numbers each kind from one and skips ids the flow already uses", () => {
    expect(newStepId("Wait", emptyFlowSteps)).toBe("wait-1");
    expect(newStepId("Condition", [wait("wait-1"), send])).toBe("condition-1");
    expect(newStepId("Wait", [wait("wait-1"), wait("wait-2"), send])).toBe(
      "wait-3"
    );
  });

  test("never reuses an id still in the flow after deletes and moves", () => {
    let steps: readonly FlowStepValue[] = emptyFlowSteps;
    for (let count = 0; count < 3; count += 1) {
      steps = insertStepAt(steps, 0, newStep("Wait", steps));
    }
    steps = removeStepAt(steps, ids(steps).indexOf("wait-1"));
    steps = moveStep(steps, 0, 1);
    const next = newStepId("Wait", steps);
    expect(ids(steps)).not.toContain(next);
    expect(ids(steps).toSorted()).toEqual(["send", "wait-2", "wait-3"]);
  });

  test("keeps the other steps' ids when one is deleted", () => {
    const steps = [
      condition("condition-1"),
      wait("wait-1"),
      wait("wait-2"),
      send,
    ];
    expect(ids(removeStepAt(steps, 1))).toEqual([
      "condition-1",
      "wait-2",
      "send",
    ]);
  });
});

describe("newStep", () => {
  test("starts a condition with an empty AND group", () => {
    expect(newStep("Condition", emptyFlowSteps)).toEqual({
      _tag: "Condition",
      id: "condition-1",
      filter: { _tag: "Group", operator: "and", filters: [] },
    });
  });

  test("starts a wait at one day", () => {
    expect(newStep("Wait", emptyFlowSteps)).toEqual({
      _tag: "Wait",
      id: "wait-1",
      wait: { _tag: "Duration", count: 1, unit: "day" },
    });
  });
});

describe("step list edits", () => {
  const steps = [condition("condition-1"), wait("wait-1"), send];

  test("insertStepAt puts the step before the one at the index", () => {
    expect(ids(insertStepAt(steps, 0, wait("wait-2")))).toEqual([
      "wait-2",
      "condition-1",
      "wait-1",
      "send",
    ]);
    expect(ids(insertStepAt(steps, 2, wait("wait-2")))).toEqual([
      "condition-1",
      "wait-1",
      "wait-2",
      "send",
    ]);
  });

  test("replaceStepAt swaps only the step at the index", () => {
    const replaced = replaceStepAt(steps, 1, {
      _tag: "Wait",
      id: "wait-1",
      wait: { _tag: "Duration", count: 3, unit: "week" },
    });
    expect(replaced[1]).toEqual({
      _tag: "Wait",
      id: "wait-1",
      wait: { _tag: "Duration", count: 3, unit: "week" },
    });
    expect(replaced[0]).toBe(steps[0]);
    expect(replaced[2]).toBe(steps[2]);
  });

  test("removeStepAt drops only the step at the index", () => {
    expect(ids(removeStepAt(steps, 0))).toEqual(["wait-1", "send"]);
  });

  test("moveStep swaps a step with its neighbour", () => {
    expect(ids(moveStep(steps, 0, 1))).toEqual([
      "wait-1",
      "condition-1",
      "send",
    ]);
    expect(ids(moveStep(steps, 1, -1))).toEqual([
      "wait-1",
      "condition-1",
      "send",
    ]);
  });

  test("moveStep leaves the flow alone past either end", () => {
    expect(moveStep(steps, 0, -1)).toBe(steps);
    expect(moveStep(steps, steps.length - 1, 1)).toBe(steps);
  });
});

describe("canMoveStep", () => {
  const steps = [condition("condition-1"), wait("wait-1"), send];

  test("lets steps before the send trade places", () => {
    expect(canMoveStep(steps, 0, 1)).toBe(true);
    expect(canMoveStep(steps, 1, -1)).toBe(true);
  });

  test("never moves a step into or past the send", () => {
    expect(canMoveStep(steps, 1, 1)).toBe(false);
  });

  test("never moves the send", () => {
    expect(canMoveStep(steps, steps.length - 1, -1)).toBe(false);
  });

  test("refuses moves past either end", () => {
    expect(canMoveStep(steps, 0, -1)).toBe(false);
    expect(canMoveStep(steps, steps.length - 1, 1)).toBe(false);
  });
});

describe("builder edits", () => {
  test("keep exactly one send, last, through inserts, moves and deletes", () => {
    let steps: readonly FlowStepValue[] = emptyFlowSteps;
    const check = () => expect(endsInOneSend(steps)).toBe(true);
    check();

    // The builder inserts at the connector above a step, the send included.
    const insertBefore = (kind: "Condition" | "Wait", index: number) => {
      steps = insertStepAt(steps, index, newStep(kind, steps));
      check();
    };
    insertBefore("Wait", 0);
    insertBefore("Condition", steps.length - 1);
    insertBefore("Wait", 1);
    insertBefore("Condition", 0);

    // A step's menu offers only the moves canMoveStep allows.
    for (const by of [-1, 1] as const) {
      steps.forEach((_, index) => {
        if (canMoveStep(steps, index, by)) {
          steps = moveStep(steps, index, by);
          check();
        }
      });
    }

    // Only condition and wait steps have a delete action.
    while (steps.length > 1) {
      const index = steps.findIndex(({ _tag }) => _tag !== "Send");
      steps = removeStepAt(steps, index);
      check();
    }
    expect(steps).toEqual(emptyFlowSteps);
  });
});
