import { describe, expect, test } from "bun:test";
import { AutomationFlow } from "@deskohub/workspace-admin-api";
import { Schema } from "effect";
import { emptyFlowSteps } from "./automation-flow-editing";
import {
  type AutomationFlowFormValues,
  automationFlowFormValues,
  createAutomationFlowFormSchema,
} from "./automation-flow-form";
import { automationFlowFormErrors } from "./automation-flow-form.test-utils";

const savedFlow = Schema.decodeUnknownSync(AutomationFlow)({
  trigger: {
    _tag: "ReservationFinished",
    product: { family: "meeting-room", properties: [] },
  },
  steps: [
    {
      _tag: "Condition",
      id: "condition-1",
      filter: { _tag: "Group", operator: "and", filters: [] },
    },
    {
      _tag: "Wait",
      id: "wait-1",
      wait: { _tag: "Calendar", expression: { hours: [10] } },
    },
    { _tag: "Send", id: "send" },
  ],
});

const send = { _tag: "Send", id: "send" } as const;

describe("automationFlowFormValues", () => {
  test("starts a new flow with no trigger and only the send step", () => {
    expect(automationFlowFormValues(null)).toEqual({
      trigger: null,
      steps: emptyFlowSteps,
    });
  });

  test("holds a saved flow's trigger and steps, which save back unchanged", () => {
    const values = automationFlowFormValues(savedFlow);
    expect(values).toEqual({
      trigger: savedFlow.trigger,
      steps: savedFlow.steps,
    });
    expect(
      Schema.decodeUnknownSync(createAutomationFlowFormSchema("en-US"))(values)
    ).toEqual(values);
  });
});

describe("createAutomationFlowFormSchema", () => {
  test("accepts a saved flow", async () => {
    const errors = await automationFlowFormErrors(
      automationFlowFormValues(savedFlow)
    );
    expect(errors.paths).toEqual([]);
  });

  test.each(["en-US", "cs-CZ"] as const)(
    "reports a missing trigger at the trigger in %s",
    async (locale) => {
      const errors = await automationFlowFormErrors(
        automationFlowFormValues(null),
        locale
      );
      expect(errors.paths).toEqual(["trigger"]);
      expect(errors.at("trigger")).toBeTruthy();
    }
  );

  test.each<readonly [string, AutomationFlowFormValues, string]>([
    [
      "an hour past the end of the day",
      {
        trigger: { _tag: "Schedule", calendar: { hours: [24] } },
        steps: [send],
      },
      "trigger.calendar.hours.0",
    ],
    [
      "a step id outside the id pattern",
      {
        trigger: { _tag: "AccountCreated" },
        steps: [{ _tag: "Send", id: "Send step" }],
      },
      "steps.0.id",
    ],
    [
      "a wait of no time",
      {
        trigger: { _tag: "AccountCreated" },
        steps: [
          {
            _tag: "Wait",
            id: "wait-1",
            wait: { _tag: "Duration", count: 0, unit: "day" },
          },
          send,
        ],
      },
      "steps.0.wait.count",
    ],
  ])("reports %s at its field", async (_, values, path) => {
    const errors = await automationFlowFormErrors(values);
    expect(errors.paths).toEqual([path.split(".")[0] ?? path]);
    expect(errors.at(path)).toBeTruthy();
  });

  test("accepts an empty step list locally, leaving the one-send rule to the port", async () => {
    const errors = await automationFlowFormErrors({
      trigger: { _tag: "AccountCreated" },
      steps: [],
    });
    expect(errors.paths).toEqual([]);
  });
});
