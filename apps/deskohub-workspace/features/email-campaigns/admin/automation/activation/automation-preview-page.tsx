import {
  AdministrationAlert,
  AdministrationDetailSection,
} from "@/features/administration/components";
import { m } from "@/features/administration/i18n";
import { getRequestLocale } from "@/features/i18n/server/request-locale";
import {
  getSearchParam,
  type SearchParamsRecord,
} from "@/shared/utils/search-params";
import { describeCampaignOperationFailure } from "../../campaign-operation-failure";
import type { AutomatedCampaign } from "../automated-campaign.server";
import { loadAutomationDryRun } from "./automation-dry-run.server";
import { AutomationDryRunPolling } from "./automation-dry-run-polling";
import { AutomationDryRunResults } from "./automation-dry-run-results";
import { dryRunJobFailureCopy } from "./automation-failure-copy";
import {
  AutomationActivateButton,
  AutomationDryRunButton,
} from "./automation-preview-actions";

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
  const { activation } = automation;
  const dryRun = await loadAutomationDryRun(automation, searchParams);
  const settled =
    dryRun?.status === "failed" || dryRun?.status === "superseded"
      ? dryRun
      : undefined;
  const running = activation._tag === "PreviewRunning" && !settled;
  const archived = automation.status === "archived";
  const progress =
    activation._tag === "PreviewRunning"
      ? m.emailAutomationActivationProgress(
          { done: activation.unitsDone, total: activation.unitsTotal },
          { locale }
        )
      : "";
  const explanation = {
    schedule: m.emailAutomationActivationExplainSchedule,
    replay: m.emailAutomationActivationExplainReplay,
  }[automation.trigger?.kind === "schedule" ? "schedule" : "replay"];

  return (
    <div className="space-y-6">
      <AdministrationDetailSection
        title={m.emailAutomationActivationPanelTitle({}, { locale })}
      >
        <p className="sr-only" role="status">
          {running
            ? progress
            : {
                PreviewRequired: "",
                PreviewRunning: "",
                Ready: m.emailAutomationActivationReadyAnnouncement(
                  {},
                  { locale }
                ),
                Published: "",
              }[activation._tag]}
        </p>
        <div className="space-y-4 text-sm leading-6">
          {settled && (
            <AdministrationAlert
              status={settled.status === "failed" ? "error" : "warning"}
            >
              {settled.status === "failed" ? (
                <>
                  <p className="font-semibold">
                    {m.emailAutomationActivationJobFailed({}, { locale })}
                  </p>
                  <p>
                    {describeCampaignOperationFailure(
                      { code: settled.errorCode ?? "" },
                      dryRunJobFailureCopy,
                      locale
                    )}
                  </p>
                </>
              ) : (
                <p>
                  {m.emailAutomationActivationJobSuperseded({}, { locale })}
                </p>
              )}
            </AdministrationAlert>
          )}
          {activation._tag === "PreviewRequired" && (
            <div className="max-w-prose space-y-2 text-navy-blue/75">
              <p>{explanation({}, { locale })}</p>
              <p>{m.emailAutomationActivationRequired({}, { locale })}</p>
            </div>
          )}
          {running && (
            <div className="max-w-xl space-y-2">
              <p className="text-navy-blue/75">
                {m.emailAutomationActivationRunning({}, { locale })}
              </p>
              <div
                aria-label={m.emailAutomationActivationProgressLabel(
                  {},
                  { locale }
                )}
                aria-valuemax={activation.unitsTotal}
                aria-valuemin={0}
                aria-valuenow={activation.unitsDone}
                aria-valuetext={progress}
                className="h-2 overflow-hidden rounded-full bg-navy-blue/10"
                role="progressbar"
              >
                <div
                  className="h-full rounded-full bg-burned-orange transition-[width]"
                  style={{
                    width: `${activation.unitsTotal === 0 ? 0 : (100 * activation.unitsDone) / activation.unitsTotal}%`,
                  }}
                />
              </div>
              <p aria-hidden className="text-navy-blue/60 text-xs">
                {progress}
              </p>
              <AutomationDryRunPolling />
            </div>
          )}
          {activation._tag === "Ready" && (
            <p className="max-w-prose text-navy-blue/75">
              {automation.activeVersion
                ? m.emailAutomationActivationReadyChanges({}, { locale })
                : m.emailAutomationActivationReady({}, { locale })}
            </p>
          )}
          {activation._tag === "Published" && (
            <p className="max-w-prose text-navy-blue/75">
              {m.emailAutomationActivationPublished({}, { locale })}
            </p>
          )}
          {archived ? (
            <p className="text-navy-blue/65">
              {m.emailAutomationActivationArchived({}, { locale })}
            </p>
          ) : (
            <div className="flex flex-wrap items-start gap-3 pt-1">
              {(activation._tag === "PreviewRequired" || settled) && (
                <AutomationDryRunButton
                  again={settled !== undefined}
                  campaignId={automation.campaignId}
                />
              )}
              {activation._tag !== "Published" && (
                <AutomationActivateButton
                  campaignId={automation.campaignId}
                  previewId={
                    activation._tag === "Ready"
                      ? activation.previewId
                      : undefined
                  }
                  publishesChanges={automation.activeVersion !== null}
                />
              )}
            </div>
          )}
        </div>
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
