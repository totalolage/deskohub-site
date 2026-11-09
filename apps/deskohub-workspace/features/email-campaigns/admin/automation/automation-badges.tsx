import { m } from "@/features/administration/i18n";
import type { Locale } from "@/features/i18n";
import { StatusBadge } from "@/shared/components/ui/status-badge";
import type { AutomatedCampaignStatus } from "../../campaign-states";

export function AutomationStatusBadge({
  locale,
  status,
}: {
  readonly locale: Locale;
  readonly status: AutomatedCampaignStatus;
}) {
  return (
    <StatusBadge
      tone={
        (
          {
            draft: "neutral",
            active: "positive",
            paused: "attention",
            archived: "neutral",
          } as const
        )[status]
      }
    >
      {{
        draft: m.emailAutomationsStatusDraft,
        active: m.emailAutomationsStatusActive,
        paused: m.emailAutomationsStatusPaused,
        archived: m.emailAutomationsStatusArchived,
      }[status]({}, { locale })}
    </StatusBadge>
  );
}
