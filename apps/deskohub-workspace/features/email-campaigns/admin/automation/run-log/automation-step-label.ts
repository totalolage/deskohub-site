import type {
  AutomationFlow,
  AutomationStep,
  AutomationWait,
} from "@deskohub/workspace-admin-api";
import { m } from "@/features/administration/i18n";
import type { Locale } from "@/features/i18n";
import { describeCalendarWaitTarget } from "../../calendar-expression-phrases";

const describeWait = (wait: AutomationWait, locale: Locale) =>
  wait._tag === "Calendar"
    ? m.emailAutomationRunsStepWaitUntil(
        { target: describeCalendarWaitTarget(wait.expression, locale) },
        { locale }
      )
    : {
        minute: m.emailAutomationRunsStepWaitMinutes,
        hour: m.emailAutomationRunsStepWaitHours,
        day: m.emailAutomationRunsStepWaitDays,
        week: m.emailAutomationRunsStepWaitWeeks,
        month: m.emailAutomationRunsStepWaitMonths,
      }[wait.unit]({ count: wait.count }, { locale });

/** What a step does, named for admins: "Condition", "Wait 2 hours". */
export const automationStepKindLabel = (
  step: AutomationStep,
  locale: Locale
): string => {
  switch (step._tag) {
    case "Condition":
      return m.emailAutomationRunsStepCondition({}, { locale });
    case "Wait":
      return describeWait(step.wait, locale);
    case "Send":
      return m.emailAutomationRunsStepSend({}, { locale });
  }
};

/**
 * A step of `flow` named by its position and what it does, such as
 * "Step 3 · Wait 2 hours", or `null` when the flow has no step `stepId`.
 */
export const automationStepLabel = ({
  flow,
  stepId,
  locale,
}: {
  readonly flow: AutomationFlow;
  readonly stepId: string;
  readonly locale: Locale;
}): string | null => {
  const position = flow.steps.findIndex(({ id }) => id === stepId);
  const step = flow.steps[position];
  return step === undefined
    ? null
    : m.emailAutomationRunsStepLabel(
        { position: position + 1, step: automationStepKindLabel(step, locale) },
        { locale }
      );
};

/**
 * The step's label in `flow`, or its id when the flow didn't load or no
 * longer has it, so a run's position always reads as something.
 */
export const automationStepLabelOrId = ({
  flow,
  stepId,
  locale,
}: {
  readonly flow: AutomationFlow | null;
  readonly stepId: string;
  readonly locale: Locale;
}): string =>
  (flow !== null && automationStepLabel({ flow, stepId, locale })) ||
  m.emailAutomationRunsStepById({ stepId }, { locale });
