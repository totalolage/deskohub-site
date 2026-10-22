import { effectSchemaResolver } from "@deskohub/effect-schema-resolver";
import { get } from "react-hook-form";
import type { Locale } from "@/features/i18n";
import {
  type AutomationFlowFormValues,
  createAutomationFlowFormSchema,
} from "./automation-flow-form";

/**
 * The flow form's error message at each form path for `values`, resolved
 * the way the builder's form resolves them.
 */
export const automationFlowFormErrors = async (
  values: AutomationFlowFormValues,
  locale: Locale = "en-US"
) => {
  const { errors } = await effectSchemaResolver(
    createAutomationFlowFormSchema(locale),
    { onExcessProperty: "error" }
  )(values, undefined, { fields: {}, shouldUseNativeValidation: false });
  return {
    paths: Object.keys(errors),
    at: (path: string): string | undefined => get(errors, path)?.message,
  };
};
