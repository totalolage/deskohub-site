import type { AutomationFrequency } from "@deskohub/workspace-admin-api";
import { TriangleAlert } from "lucide-react";
import { m } from "@/features/administration/i18n";
import type { Locale } from "@/features/i18n";

/**
 * The large warning a schedule gets when some hour can hold more than one
 * fire (D33). The port decides when; this only shows it.
 */
export function AutomationFrequencyBanner({
  frequency,
  locale,
}: {
  readonly frequency: AutomationFrequency;
  readonly locale: Locale;
}) {
  return (
    frequency.firesMoreThanHourly && (
      <div
        className="flex items-start gap-3 rounded-xl border-2 border-red-700 bg-red-50 px-4 py-4 text-red-900"
        role="note"
      >
        <TriangleAlert aria-hidden className="mt-0.5 size-6 shrink-0" />
        <div className="space-y-1">
          <p className="font-semibold text-base">
            {m.emailAutomationsFrequencyBannerTitle({}, { locale })}
          </p>
          <p className="text-sm leading-6">
            {m.emailAutomationsFrequencyBannerBody(
              { count: frequency.maxFiresPerHour },
              { locale }
            )}
          </p>
        </div>
      </div>
    )
  );
}
