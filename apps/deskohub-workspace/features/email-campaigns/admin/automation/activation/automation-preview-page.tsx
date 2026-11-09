import type { AutomationDryRun } from "@deskohub/workspace-admin-api";
import { AdministrationDetailSection } from "@/features/administration/components";
import { m } from "@/features/administration/i18n";
import { getRequestLocale } from "@/features/i18n/server/request-locale";
import {
  getSearchParam,
  type SearchParamsRecord,
} from "@/shared/utils/search-params";
import type { AutomatedCampaign } from "../automated-campaign.server";
import { AutomationActivationPanel } from "./automation-activation-panel";
import { loadAutomationDryRun } from "./automation-dry-run.server";
import { AutomationDryRunResults } from "./automation-dry-run-results";

/** The dry run when it failed or was superseded, which shows no results. */
const settledDryRun = (dryRun: AutomationDryRun | undefined) =>
  dryRun?.status === "failed" || dryRun?.status === "superseded"
    ? dryRun
    : undefined;

/**
 * The dry-run preview of the working copy, then activation. The tab follows
 * `automation.activation` and enables Activate only for `Ready`; it never
 * decides readiness itself.
 */
export async function AutomationPreviewPage({
  automated: { campaign, automation },
  searchParams = {},
}: {
  readonly automated: AutomatedCampaign;
  readonly searchParams?: SearchParamsRecord;
}) {
  const locale = await getRequestLocale();
  const dryRun = await loadAutomationDryRun(automation, searchParams);
  const settled = settledDryRun(dryRun);

  return (
    <div className="space-y-6">
      <AdministrationDetailSection
        title={m.emailAutomationActivationPanelTitle({}, { locale })}
      >
        <AutomationActivationPanel
          automation={automation}
          locale={locale}
          settled={settled}
        />
      </AdministrationDetailSection>
      {dryRun && !settled && (
        <AutomationDryRunResults
          content={campaign.content}
          cursor={getSearchParam(searchParams, "cursor")}
          dryRun={dryRun}
          flow={automation.flow}
          locale={locale}
        />
      )}
    </div>
  );
}
