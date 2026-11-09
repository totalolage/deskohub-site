"use client";

import { Users } from "lucide-react";
import { AdministrationLink as Link } from "@/features/administration/admin-link";
import { administrationHref } from "@/features/administration/administration-href";
import { m } from "@/features/administration/i18n";
import type { Locale } from "@/features/i18n";
import { useRouteLocale } from "@/features/i18n/route-locale";
import { Button } from "@/shared/components/ui/button";
import type { CampaignId } from "../../campaign-identifiers";
import { CampaignConfirmSendDialog } from "./campaign-confirm-send-dialog";
import { CampaignTestSendDialog } from "./campaign-test-send-dialog";

export type CampaignSendControlsProps = {
  readonly campaignId: CampaignId;
  /**
   * The fixed test-send recipient, from `CampaignEmailConfig.adminInbox`;
   * null where campaign email isn't configured.
   */
  readonly adminInbox: string | null;
  /** Locales the saved campaign has content for. */
  readonly contentLocales: readonly Locale[];
  /** The composer has edits the test send would not include yet. */
  readonly unsavedChanges: boolean;
};

/** Recipient preview, test send, and code-confirmed send for a Draft. */
export function CampaignSendControls({
  adminInbox,
  campaignId,
  contentLocales,
  unsavedChanges,
}: CampaignSendControlsProps) {
  const locale = useRouteLocale();
  return (
    <div className="flex flex-wrap items-center gap-2 @5xl:flex-nowrap">
      <Button asChild size="sm" variant="ghost">
        <Link
          href={administrationHref(
            "/[locale]/admin/email-campaigns/[campaignId]/recipients",
            { campaignId }
          )}
        >
          <Users aria-hidden className="size-4" />
          {m.emailCampaignsSendPreviewRecipients({}, { locale })}
        </Link>
      </Button>
      <CampaignTestSendDialog
        adminInbox={adminInbox}
        campaignId={campaignId}
        contentLocales={contentLocales}
        unsavedChanges={unsavedChanges}
      />
      <CampaignConfirmSendDialog
        campaignId={campaignId}
        unsavedChanges={unsavedChanges}
      />
    </div>
  );
}
