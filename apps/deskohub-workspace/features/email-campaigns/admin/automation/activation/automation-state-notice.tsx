import type { AutomationDetail } from "@deskohub/workspace-admin-api";
import {
  AdministrationAlert,
  formatAdministrationDateTime,
} from "@/features/administration/components";
import { m } from "@/features/administration/i18n";
import type { Locale } from "@/features/i18n";

/** What a paused or archived automation does now (D12). */
export function AutomationStateNotice({
  automation: { archivedAt, pausedAt, status },
  locale,
}: {
  readonly automation: AutomationDetail;
  readonly locale: Locale;
}) {
  return (
    <>
      {status === "paused" && pausedAt && (
        <AdministrationAlert className="mb-6" status="warning">
          {m.emailAutomationActivationPausedNotice(
            { date: formatAdministrationDateTime(pausedAt, locale) },
            { locale }
          )}
        </AdministrationAlert>
      )}
      {status === "archived" && archivedAt && (
        <p className="mb-6 rounded-xl border border-navy-blue/15 bg-navy-blue/5 px-4 py-3 text-navy-blue/75 text-sm leading-6">
          {m.emailAutomationActivationArchivedNotice(
            { date: formatAdministrationDateTime(archivedAt, locale) },
            { locale }
          )}
        </p>
      )}
    </>
  );
}
