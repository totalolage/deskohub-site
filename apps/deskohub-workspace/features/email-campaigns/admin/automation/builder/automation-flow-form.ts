import {
  type AutomationFlowType as AutomationFlow,
  AutomationStep,
  AutomationTrigger,
} from "@deskohub/workspace-admin-api";
import { Schema } from "effect";
import { m } from "@/features/administration/i18n";
import type { Locale } from "@/features/i18n";
import { emptyFlowSteps } from "./automation-flow-editing";

/**
 * The flow builder's form: the contract's trigger and steps, with no
 * trigger yet while an empty flow waits for one. The port checks the
 * flow's own rules, such as one send step, last, when it saves.
 */
export const createAutomationFlowFormSchema = (locale: Locale) =>
  Schema.Struct({
    trigger: Schema.NullOr(AutomationTrigger).check(
      Schema.makeFilter(
        (trigger) =>
          trigger !== null ||
          m.emailAutomationFlowTriggerRequired({}, { locale })
      )
    ),
    steps: Schema.Array(AutomationStep),
  });

type AutomationFlowFormSchema = ReturnType<
  typeof createAutomationFlowFormSchema
>;
export type AutomationFlowFormValues = AutomationFlowFormSchema["Encoded"];
export type AutomationFlowFormOutput = AutomationFlowFormSchema["Type"];

/** One step as the form holds it. */
export type FlowStepValue = AutomationFlowFormValues["steps"][number];
/** The trigger as the form holds it, once chosen. */
export type FlowTriggerValue = NonNullable<AutomationFlowFormValues["trigger"]>;

/** The form values of a saved flow, or of an empty one. */
export const automationFlowFormValues = (
  flow: AutomationFlow | null
): AutomationFlowFormValues =>
  flow === null
    ? { trigger: null, steps: emptyFlowSteps }
    : { trigger: flow.trigger, steps: flow.steps };
