import { ArrowLeft } from "lucide-react";
import { AdministrationLink } from "@/features/administration/admin-link";
import { administrationHref } from "@/features/administration/administration-href";
import {
  AdministrationDetailSection,
  AdministrationFact,
  formatAdministrationDateTime,
} from "@/features/administration/components";
import { m } from "@/features/administration/i18n";
import { getRequestLocale } from "@/features/i18n/server/request-locale";
import type { AutomatedCampaign } from "../automated-campaign.server";
import { automationTriggerLabel } from "../automation-trigger-labels";
import { AutomationRunCustomer } from "./automation-run-customer";
import { loadAutomationRun } from "./automation-run-log.server";
import { AutomationRunStatus } from "./automation-run-status";
import { AutomationRunTimeline } from "./automation-run-timeline";
import { automationStepLabelOrId } from "./automation-step-label";

/** One run's summary and step timeline. */
export async function AutomationRunPage({
  automated,
  runId,
}: {
  readonly automated: AutomatedCampaign;
  readonly runId: string;
}) {
  const locale = await getRequestLocale();
  const { conditionWording, flow, run } = await loadAutomationRun(
    automated.campaign.id,
    runId
  );
  return (
    <div className="@container grid gap-5">
      <AdministrationLink
        className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-navy-blue/70 hover:text-navy-blue"
        href={administrationHref(
          "/[locale]/admin/email-campaigns/[campaignId]/runs",
          { campaignId: automated.campaign.id }
        )}
      >
        <ArrowLeft aria-hidden className="size-4" />
        {m.emailAutomationRunsBackToList({}, { locale })}
      </AdministrationLink>
      <AdministrationDetailSection
        title={m.emailAutomationRunsRunTitle({}, { locale })}
      >
        <dl className="grid gap-5 @lg:grid-cols-2 @4xl:grid-cols-4">
          <AdministrationFact
            label={m.emailAutomationRunsColumnStatus({}, { locale })}
            value={<AutomationRunStatus locale={locale} run={run} />}
          />
          <AdministrationFact
            label={m.emailAutomationRunsColumnCustomer({}, { locale })}
            value={<AutomationRunCustomer locale={locale} run={run} showId />}
          />
          <AdministrationFact
            label={m.emailAutomationRunsColumnTrigger({}, { locale })}
            value={m.emailAutomationRunsTriggeredAt(
              {
                trigger: automationTriggerLabel(run.triggerKind, locale),
                date: formatAdministrationDateTime(run.triggerAt, locale),
              },
              { locale }
            )}
          />
          <AdministrationFact
            label={m.emailAutomationRunsColumnVersion({}, { locale })}
            value={m.emailAutomationRunsVersion(
              { versionNumber: run.versionNumber },
              { locale }
            )}
          />
          <AdministrationFact
            label={
              run.endedAt === null
                ? m.emailAutomationRunsCurrentStep({}, { locale })
                : m.emailAutomationRunsEndedAtStep({}, { locale })
            }
            value={automationStepLabelOrId({
              flow,
              stepId: run.stepId,
              locale,
            })}
          />
          <AdministrationFact
            label={m.emailAutomationRunsColumnStarted({}, { locale })}
            value={formatAdministrationDateTime(run.startedAt, locale)}
          />
          <AdministrationFact
            label={m.emailAutomationRunsColumnEnded({}, { locale })}
            value={
              run.endedAt === null
                ? m.emailAutomationRunsNotEnded({}, { locale })
                : formatAdministrationDateTime(run.endedAt, locale)
            }
          />
        </dl>
      </AdministrationDetailSection>
      <AdministrationDetailSection
        title={m.emailAutomationRunsTimelineTitle({}, { locale })}
      >
        <AutomationRunTimeline
          conditionWording={conditionWording}
          entries={run.timeline}
          flow={flow}
          locale={locale}
        />
      </AdministrationDetailSection>
    </div>
  );
}
