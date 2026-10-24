import {
  AdministrationCampaignDetail,
  AutomationDetail,
} from "@deskohub/workspace-admin-api";
import { Schema } from "effect";
import { createRoot } from "react-dom/client";
import type { Locale } from "@/features/i18n";
import { RouteLocaleProvider } from "@/features/i18n/route-locale";
import { AutomationFlowBuilder } from "./automation-flow-builder";
import type { AutomationFlowBuilderData } from "./automation-flow-page-data.server";

const mountPoint = document.getElementById("automation-flow-builder-root");
const fixture = document.getElementById("automation-flow-builder-fixture");

if (!mountPoint || !fixture?.textContent) {
  throw new Error("The AutomationFlowBuilder browser harness root is missing.");
}

// The page passes the builder's props as their wire shape.
const props = JSON.parse(fixture.textContent) as {
  readonly campaign: unknown;
  readonly automation: unknown;
  readonly data: AutomationFlowBuilderData;
};

createRoot(mountPoint).render(
  <RouteLocaleProvider locale={mountPoint.dataset.locale as Locale}>
    <AutomationFlowBuilder
      campaign={Schema.decodeUnknownSync(AdministrationCampaignDetail)(
        props.campaign
      )}
      automation={Schema.decodeUnknownSync(AutomationDetail)(props.automation)}
      data={props.data}
    />
  </RouteLocaleProvider>
);
