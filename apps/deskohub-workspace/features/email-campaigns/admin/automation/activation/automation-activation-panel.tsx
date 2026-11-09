import type {
  AutomationActivation,
  AutomationDetail,
  AutomationDryRun,
} from "@deskohub/workspace-admin-api";
import { AdministrationAlert } from "@/features/administration/components";
import { m } from "@/features/administration/i18n";
import type { Locale } from "@/features/i18n";
import { describeCampaignOperationFailure } from "../../campaign-operation-failure";
import { AutomationDryRunPolling } from "./automation-dry-run-polling";
import { dryRunJobFailureCopy } from "./automation-failure-copy";
import {
  AutomationActivateButton,
  AutomationDryRunButton,
} from "./automation-preview-actions";

/**
 * The activation panel's body: what `automation.activation` says, a failed
 * or superseded dry run's notice, and the dry run and Activate buttons.
 */
export function AutomationActivationPanel({
  automation,
  locale,
  settled,
}: {
  readonly automation: AutomationDetail;
  readonly locale: Locale;
  /** The failed or superseded dry run the page shows instead of results. */
  readonly settled: AutomationDryRun | undefined;
}) {
  const { activation } = automation;
  const running = activation._tag === "PreviewRunning" && !settled;
  const progress =
    activation._tag === "PreviewRunning"
      ? m.emailAutomationActivationProgress(
          { done: activation.unitsDone, total: activation.unitsTotal },
          { locale }
        )
      : "";
  return (
    <>
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
        {settled && <SettledDryRunAlert locale={locale} settled={settled} />}
        {activation._tag === "PreviewRequired" && (
          <DryRunRequiredExplanation automation={automation} locale={locale} />
        )}
        {running && (
          <DryRunProgress
            activation={activation}
            locale={locale}
            progress={progress}
          />
        )}
        <ActivationReadiness automation={automation} locale={locale} />
        <AutomationPreviewControls
          automation={automation}
          locale={locale}
          settled={settled}
        />
      </div>
    </>
  );
}

/** Why a failed dry run stopped, or that a newer one replaced it. */
function SettledDryRunAlert({
  locale,
  settled,
}: {
  readonly locale: Locale;
  readonly settled: AutomationDryRun;
}) {
  return (
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
        <p>{m.emailAutomationActivationJobSuperseded({}, { locale })}</p>
      )}
    </AdministrationAlert>
  );
}

/** What a dry run of this trigger evaluates, before the first one. */
function DryRunRequiredExplanation({
  automation,
  locale,
}: {
  readonly automation: AutomationDetail;
  readonly locale: Locale;
}) {
  const explanation = {
    schedule: m.emailAutomationActivationExplainSchedule,
    replay: m.emailAutomationActivationExplainReplay,
  }[automation.trigger?.kind === "schedule" ? "schedule" : "replay"];
  return (
    <div className="max-w-prose space-y-2 text-navy-blue/75">
      <p>{explanation({}, { locale })}</p>
      <p>{m.emailAutomationActivationRequired({}, { locale })}</p>
    </div>
  );
}

function DryRunProgress({
  activation,
  locale,
  progress,
}: {
  readonly activation: Extract<
    AutomationActivation,
    { readonly _tag: "PreviewRunning" }
  >;
  readonly locale: Locale;
  readonly progress: string;
}) {
  return (
    <div className="max-w-xl space-y-2">
      <p className="text-navy-blue/75">
        {m.emailAutomationActivationRunning({}, { locale })}
      </p>
      <div
        aria-label={m.emailAutomationActivationProgressLabel({}, { locale })}
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
  );
}

/** That the working copy can be activated, or already is live. */
function ActivationReadiness({
  automation: { activation, activeVersion },
  locale,
}: {
  readonly automation: AutomationDetail;
  readonly locale: Locale;
}) {
  if (activation._tag === "Ready") {
    return (
      <p className="max-w-prose text-navy-blue/75">
        {activeVersion
          ? m.emailAutomationActivationReadyChanges({}, { locale })
          : m.emailAutomationActivationReady({}, { locale })}
      </p>
    );
  }
  if (activation._tag === "Published") {
    return (
      <p className="max-w-prose text-navy-blue/75">
        {m.emailAutomationActivationPublished({}, { locale })}
      </p>
    );
  }
  return null;
}

/** The dry run and Activate buttons, which an archived automation lacks. */
function AutomationPreviewControls({
  automation: { activation, activeVersion, campaignId, status },
  locale,
  settled,
}: {
  readonly automation: AutomationDetail;
  readonly locale: Locale;
  readonly settled: AutomationDryRun | undefined;
}) {
  if (status === "archived") {
    return (
      <p className="text-navy-blue/65">
        {m.emailAutomationActivationArchived({}, { locale })}
      </p>
    );
  }
  return (
    <div className="flex flex-wrap items-start gap-3 pt-1">
      {(activation._tag === "PreviewRequired" || settled) && (
        <AutomationDryRunButton
          again={settled !== undefined}
          campaignId={campaignId}
        />
      )}
      {activation._tag !== "Published" && (
        <AutomationActivateButton
          campaignId={campaignId}
          previewId={
            activation._tag === "Ready" ? activation.previewId : undefined
          }
          publishesChanges={activeVersion !== null}
        />
      )}
    </div>
  );
}
