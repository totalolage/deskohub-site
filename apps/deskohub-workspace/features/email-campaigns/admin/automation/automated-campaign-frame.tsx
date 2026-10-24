import type { ReactNode } from "react";
import { AdministrationLink } from "@/features/administration/admin-link";
import {
  AdministrationPage,
  AdministrationPageHeader,
  formatAdministrationDateTime,
} from "@/features/administration/components";
import { m } from "@/features/administration/i18n";
import { getRequestLocale } from "@/features/i18n/server/request-locale";
import { Badge } from "@/shared/components/ui/badge";
import { cn } from "@/shared/utils";
import { AutomationLifecycleActions } from "./activation/automation-lifecycle-actions";
import { AutomationStateNotice } from "./activation/automation-state-notice";
import type { AutomatedCampaign } from "./automated-campaign.server";
import { AutomationStatusBadge } from "./automation-badges";

export type AutomatedCampaignSection = "flow" | "email" | "preview" | "runs";

/**
 * The header, state line and section tabs every automated campaign page
 * shares. Each section is its own route, so a section link can be shared.
 */
export async function AutomatedCampaignFrame({
  automated: { campaign, automation },
  section,
  children,
}: {
  readonly automated: AutomatedCampaign;
  readonly section: AutomatedCampaignSection;
  readonly children: ReactNode;
}) {
  const locale = await getRequestLocale();
  const base = `/admin/email-campaigns/${campaign.id}`;
  return (
    <AdministrationPage>
      <AdministrationPageHeader
        actions={<AutomationLifecycleActions automation={automation} />}
        eyebrow={m.emailAutomationsEyebrow({}, { locale })}
        title={campaign.title}
      />
      <div className="-mt-3 mb-6 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-navy-blue/62">
        <AutomationStatusBadge locale={locale} status={automation.status} />
        {automation.pendingChanges && (
          <Badge variant="subtle">
            {m.emailAutomationsPendingChanges({}, { locale })}
          </Badge>
        )}
        <span>
          {automation.activeVersion
            ? m.emailAutomationsVersionLive(
                {
                  version: automation.activeVersion.versionNumber,
                  date: formatAdministrationDateTime(
                    automation.activeVersion.activatedAt,
                    locale
                  ),
                },
                { locale }
              )
            : m.emailAutomationsNeverActivated({}, { locale })}
        </span>
      </div>
      <AutomationStateNotice automation={automation} locale={locale} />
      <nav
        aria-label={m.emailAutomationsSectionsLabel({}, { locale })}
        className="-mx-4 mb-6 overflow-x-auto px-4 sm:mx-0 sm:px-0"
      >
        <ul className="inline-flex h-10 items-center gap-1 rounded-md border border-navy-blue/15 bg-navy-blue/5 p-1">
          {(
            [
              ["flow", base, m.emailAutomationsSectionFlow],
              ["email", `${base}/email`, m.emailAutomationsSectionEmail],
              ["preview", `${base}/preview`, m.emailAutomationsSectionPreview],
              ["runs", `${base}/runs`, m.emailAutomationsSectionRuns],
            ] as const
          ).map(([key, href, label]) => (
            <li key={key}>
              <AdministrationLink
                aria-current={key === section ? "page" : undefined}
                className={cn(
                  "inline-flex h-8 items-center whitespace-nowrap rounded px-3 font-medium text-navy-blue/70 text-sm transition hover:text-navy-blue focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-burned-orange",
                  key === section && "bg-white text-navy-blue shadow-sm"
                )}
                href={href}
              >
                {label({}, { locale })}
              </AdministrationLink>
            </li>
          ))}
        </ul>
      </nav>
      {children}
    </AdministrationPage>
  );
}
