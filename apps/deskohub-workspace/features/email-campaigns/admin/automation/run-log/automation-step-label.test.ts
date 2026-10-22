import { describe, expect, test } from "bun:test";
import { m } from "@/features/administration/i18n";
import type { Locale } from "@/features/i18n";
import { describeCalendarWaitTarget } from "../../calendar-expression-phrases";
import { automationFlowFixture } from "../activation/automation-detail.test-utils";
import {
  automationStepKindLabel,
  automationStepLabel,
  automationStepLabelOrId,
} from "./automation-step-label";

const locales: readonly Locale[] = ["en-US", "cs-CZ"];
const calendarExpression = { hours: [10] } as const;

const durationWaits = [
  { unit: "minute", catalog: m.emailAutomationRunsStepWaitMinutes },
  { unit: "hour", catalog: m.emailAutomationRunsStepWaitHours },
  { unit: "day", catalog: m.emailAutomationRunsStepWaitDays },
  { unit: "week", catalog: m.emailAutomationRunsStepWaitWeeks },
  { unit: "month", catalog: m.emailAutomationRunsStepWaitMonths },
] as const;

const durationWaitStep = (unit: (typeof durationWaits)[number]["unit"]) =>
  automationFlowFixture({
    steps: [
      {
        _tag: "Wait",
        id: `wait-${unit}`,
        wait: { _tag: "Duration", count: 2, unit },
      },
      { _tag: "Send", id: "send" },
    ],
  }).steps[0]!;

describe("automationStepKindLabel", () => {
  test("matches the catalog for conditions, sends, and every duration unit", () => {
    const flow = automationFlowFixture();
    const condition = flow.steps.find((step) => step._tag === "Condition")!;
    const send = flow.steps.find((step) => step._tag === "Send")!;

    for (const locale of locales) {
      expect(automationStepKindLabel(condition, locale)).toBe(
        m.emailAutomationRunsStepCondition({}, { locale })
      );
      expect(automationStepKindLabel(send, locale)).toBe(
        m.emailAutomationRunsStepSend({}, { locale })
      );

      const durationLabels = durationWaits.map(({ unit, catalog }) => {
        const expected = catalog({ count: 2 }, { locale });
        expect(automationStepKindLabel(durationWaitStep(unit), locale)).toBe(
          expected
        );
        return expected;
      });
      expect(new Set(durationLabels).size).toBe(durationWaits.length);

      const calendarWait = automationFlowFixture({
        steps: [
          {
            _tag: "Wait",
            id: "wait-until",
            wait: { _tag: "Calendar", expression: calendarExpression },
          },
          { _tag: "Send", id: "send" },
        ],
      }).steps[0]!;
      const calendarLabel = automationStepKindLabel(calendarWait, locale);
      const target = describeCalendarWaitTarget(calendarExpression, locale);

      expect(target.trim()).not.toBe("");
      expect(calendarLabel).toBe(
        m.emailAutomationRunsStepWaitUntil({ target }, { locale })
      );
      expect(durationLabels).not.toContain(calendarLabel);
    }
  });
});

describe("automationStepLabel", () => {
  test("uses each fixture step's one-based position and kind label", () => {
    const flow = automationFlowFixture();

    for (const locale of locales) {
      flow.steps.forEach((step, index) => {
        expect(automationStepLabel({ flow, stepId: step.id, locale })).toBe(
          m.emailAutomationRunsStepLabel(
            {
              position: index + 1,
              step: automationStepKindLabel(step, locale),
            },
            { locale }
          )
        );
      });
    }

    expect(
      automationStepLabel({ flow, stepId: "missing-step", locale: "en-US" })
    ).toBeNull();
  });
});

describe("automationStepLabelOrId", () => {
  test("uses the catalog step-id label when the flow or step is missing", () => {
    const flow = automationFlowFixture();

    for (const locale of locales) {
      for (const [missingFlow, stepId] of [
        [null, "unknown-flow-step"],
        [flow, "removed-step"],
      ] as const) {
        expect(
          automationStepLabelOrId({ flow: missingFlow, stepId, locale })
        ).toBe(m.emailAutomationRunsStepById({ stepId }, { locale }));
      }
    }
  });
});
