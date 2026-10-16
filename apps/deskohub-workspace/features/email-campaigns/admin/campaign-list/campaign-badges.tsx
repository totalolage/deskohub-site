import { m } from "@/features/administration/i18n";
import type { Locale } from "@/features/i18n";
import { Badge } from "@/shared/components/ui/badge";
import { StatusBadge } from "@/shared/components/ui/status-badge";
import type { CampaignPurpose } from "../../body/campaign-content";
import type {
  CampaignRecipientStatus,
  CampaignStatus,
} from "../../campaign-states";

export function CampaignStatusBadge({
  locale,
  status,
}: {
  readonly locale: Locale;
  readonly status: CampaignStatus;
}) {
  return (
    <StatusBadge
      tone={
        (
          {
            draft: "neutral",
            sending: "progress",
            sent: "positive",
            failed: "attention",
          } as const
        )[status]
      }
    >
      {{
        draft: m.emailCampaignsBadgeStatusDraft,
        sending: m.emailCampaignsBadgeStatusSending,
        sent: m.emailCampaignsBadgeStatusSent,
        failed: m.emailCampaignsBadgeStatusFailed,
      }[status]({}, { locale })}
    </StatusBadge>
  );
}

export function CampaignPurposeBadge({
  locale,
  purpose,
}: {
  readonly locale: Locale;
  readonly purpose: CampaignPurpose;
}) {
  return (
    <Badge variant={purpose === "marketing" ? "default" : "subtle"}>
      {{
        marketing: m.emailCampaignsBadgePurposeMarketing,
        operational: m.emailCampaignsBadgePurposeOperational,
      }[purpose]({}, { locale })}
    </Badge>
  );
}

export function CampaignRecipientStatusBadge({
  locale,
  status,
}: {
  readonly locale: Locale;
  readonly status: CampaignRecipientStatus;
}) {
  return (
    <StatusBadge
      tone={
        (
          {
            pending: "neutral",
            sent: "progress",
            delivered: "positive",
            bounced: "attention",
            complained: "attention",
            failed: "attention",
            unconfirmed: "attention",
            skipped: "neutral",
          } as const
        )[status]
      }
    >
      {{
        pending: m.emailCampaignsBadgeRecipientStatusPending,
        sent: m.emailCampaignsBadgeRecipientStatusSent,
        delivered: m.emailCampaignsBadgeRecipientStatusDelivered,
        bounced: m.emailCampaignsBadgeRecipientStatusBounced,
        complained: m.emailCampaignsBadgeRecipientStatusComplained,
        failed: m.emailCampaignsBadgeRecipientStatusFailed,
        unconfirmed: m.emailCampaignsBadgeRecipientStatusUnconfirmed,
        skipped: m.emailCampaignsBadgeRecipientStatusSkipped,
      }[status]({}, { locale })}
    </StatusBadge>
  );
}
