"use client";

import type { ReactNode } from "react";
import { AdministrationPageHeader } from "@/features/administration/components";
import { m } from "@/features/administration/i18n";
import type { Locale } from "@/features/i18n";
import { Button } from "@/shared/components/ui/button";
import type { CampaignDelivery } from "../../campaign-states";
import { CampaignSendControls } from "../sending/campaign-send-controls";
import type { CampaignComposerCampaign } from "./campaign-composer";
import { DeleteCampaignDraftControl } from "./delete-campaign-draft-control";

/**
 * Whether the edits are saved: unsaved changes, or all changes saved on a
 * saved campaign that can still change.
 */
export function ComposerSaveState({
  campaign,
  locale,
  unsavedChanges,
}: {
  readonly campaign: CampaignComposerCampaign | undefined;
  readonly locale: Locale;
  readonly unsavedChanges: boolean;
}) {
  return (
    <span
      className="inline-flex items-center gap-1.5 text-navy-blue/60 text-sm @5xl:whitespace-nowrap"
      role="status"
    >
      {unsavedChanges ? (
        <>
          <span aria-hidden className="size-2 rounded-full bg-burned-orange" />
          {m.emailCampaignsComposerUnsavedChanges({}, { locale })}
        </>
      ) : (
        campaign &&
        !campaign.readOnly &&
        m.emailCampaignsComposerAllChangesSaved({}, { locale })
      )}
    </span>
  );
}

/** What saving does: create a draft, or save a draft or an automated email. */
const saveButtonLabel = (
  campaign: CampaignComposerCampaign | undefined,
  locale: Locale
) =>
  campaign
    ? {
        once: m.emailCampaignsComposerSaveDraft,
        automated: m.emailAutomationsEmailSave,
      }[campaign.delivery]({}, { locale })
    : m.emailCampaignsComposerCreateDraft({}, { locale });

/**
 * Submits the composer; absent on a read-only campaign. A saved campaign
 * saves only unsaved changes, and nothing saves while a save runs or a new
 * campaign's page opens.
 */
export function ComposerSaveButton({
  campaign,
  created,
  locale,
  saving,
  unsavedChanges,
}: {
  readonly campaign: CampaignComposerCampaign | undefined;
  readonly created: boolean;
  readonly locale: Locale;
  readonly saving: boolean;
  readonly unsavedChanges: boolean;
}) {
  if (campaign?.readOnly) {
    return null;
  }
  return (
    <Button
      disabled={
        saving || created || (campaign !== undefined && !unsavedChanges)
      }
      form="campaign-composer"
      size="sm"
      type="submit"
    >
      {saving && m.emailCampaignsComposerSaving({}, { locale })}
      {!saving && saveButtonLabel(campaign, locale)}
    </Button>
  );
}

/**
 * An automated campaign's email bar: whether its edits wait for the next
 * published version or can't happen once archived, with the save controls.
 */
export function AutomatedEmailBar({
  children,
  locale,
  readOnly,
}: {
  /** The save state and button. */
  readonly children: ReactNode;
  readonly locale: Locale;
  readonly readOnly: boolean;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-xl border border-navy-blue/10 bg-white px-5 py-4">
      <p className="max-w-2xl text-navy-blue/70 text-sm">
        {readOnly
          ? m.emailAutomationsEmailArchivedNote({}, { locale })
          : m.emailAutomationsEmailUnpublishedNote({}, { locale })}
      </p>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </div>
  );
}

/**
 * The page header and sticky toolbar of a new campaign or a saved one-off
 * draft. A saved draft's toolbar also sends and deletes it.
 */
export function ComposerPageHeader({
  adminInbox,
  campaign,
  delivery,
  locale,
  saveButton,
  saveState,
  title,
  unsavedChanges,
}: {
  readonly adminInbox: string | null;
  readonly campaign: CampaignComposerCampaign | undefined;
  readonly delivery: CampaignDelivery;
  readonly locale: Locale;
  readonly saveButton: ReactNode;
  readonly saveState: ReactNode;
  readonly title: string;
  readonly unsavedChanges: boolean;
}) {
  const savedOnce = campaign?.delivery === "once" ? campaign : undefined;
  return (
    <>
      <AdministrationPageHeader
        description={
          savedOnce
            ? m.emailCampaignsComposerDraftDescription({}, { locale })
            : {
                once: m.emailCampaignsComposerNewDescription,
                automated: m.emailAutomationsComposerNewDescription,
              }[delivery]({}, { locale })
        }
        eyebrow={m.emailCampaignsComposerEyebrow({}, { locale })}
        title={
          title.trim() ||
          (savedOnce
            ? m.emailCampaignsComposerUntitledTitle({}, { locale })
            : m.emailCampaignsComposerNewTitle({}, { locale }))
        }
      />
      {/* Keep one toolbar row at the breakpoint where the preview also sticks.
          On a phone the wrapped toolbar would cover too much of the
          screen, so it scrolls with the page there. */}
      <div className="z-30 -mx-4 mb-7 border-y border-navy-blue/10 bg-[#f6f6f3] px-4 py-2 sm:sticky sm:top-16 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8 @container">
        <div className="flex flex-wrap items-center justify-start gap-3 sm:justify-end @5xl:flex-nowrap">
          {saveState}
          {savedOnce && (
            <CampaignSendControls
              adminInbox={adminInbox}
              campaignId={savedOnce.id}
              contentLocales={savedOnce.contentLocales}
              unsavedChanges={unsavedChanges}
            />
          )}
          {saveButton}
          {savedOnce && (
            <DeleteCampaignDraftControl campaignId={savedOnce.id} />
          )}
        </div>
      </div>
    </>
  );
}
