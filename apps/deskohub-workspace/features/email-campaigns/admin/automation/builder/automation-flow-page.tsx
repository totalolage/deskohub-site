import { getRequestLocale } from "@/features/i18n/server/request-locale";
import type { AutomatedCampaign } from "../automated-campaign.server";
import { AutomationFlowBuilder } from "./automation-flow-builder";
import { loadAutomationFlowBuilderData } from "./automation-flow-page-data.server";

/** The automation's flow builder: its trigger and steps. */
export async function AutomationFlowPage({
  automated: { campaign, automation },
}: {
  readonly automated: AutomatedCampaign;
}) {
  const locale = await getRequestLocale();
  const data = await loadAutomationFlowBuilderData(automation.flow, locale);
  return (
    <AutomationFlowBuilder
      campaign={campaign}
      automation={automation}
      data={data}
    />
  );
}
