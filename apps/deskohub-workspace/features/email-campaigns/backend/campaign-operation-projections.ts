import type {
  AdministrationCampaignAudienceType,
  AdministrationCampaignContentInputType,
  AdministrationCampaignDetailType,
  AdministrationCampaignEditorContentType,
  AdministrationCampaignEditorLocaleContentType,
  AdministrationCampaignLocaleContentInputType,
  AdministrationCampaignLocaleContentType,
  AdministrationCampaignSendStatusResultType,
  AdministrationCampaignSummaryType,
} from "@deskohub/workspace-admin-api";
import { Effect, Option } from "effect";
import type { CampaignAudienceRow, CampaignRow } from "@/db/schema";
import { type Locale, locales } from "@/features/i18n";
import {
  readCampaignBody,
  readUnfinishedCampaignBody,
} from "../body/campaign-body-input";
import { campaignBodyToMarkdown } from "../body/campaign-body-markdown";
import type {
  CampaignLocaleContent,
  CampaignLocalizedContent,
} from "../body/campaign-content";
import type { ICampaignSendStatusService } from "./campaign-send-status.service";

/** The locales a per-locale record has a value for, in locale order. */
const localeEntries = <Value>(
  record: Partial<Record<Locale, Value>>
): ReadonlyArray<readonly [Locale, Value]> =>
  locales.flatMap((locale) => {
    const value = record[locale];
    return value === undefined ? [] : [[locale, value] as const];
  });

const withOperationalReason = (
  content: Omit<CampaignLocaleContent, "operationalReason">,
  operationalReason: string | undefined
): CampaignLocaleContent =>
  operationalReason === undefined ? content : { ...content, operationalReason };

/** One locale's texts as the contract sends them, with a body read by `read`. */
const parseLocaleContent = (
  locale: Locale,
  content: AdministrationCampaignLocaleContentInputType,
  read: typeof readCampaignBody
) =>
  read(locale, content).pipe(
    Effect.map((body) =>
      withOperationalReason(
        { subject: content.subject, preheader: content.preheader, body },
        content.operationalReason
      )
    )
  );

/** One locale's texts as the contract sends them, with a checked body. */
export const toCampaignLocaleContent = Effect.fn(
  "CampaignOperations.toCampaignLocaleContent"
)((locale: Locale, content: AdministrationCampaignLocaleContentInputType) =>
  parseLocaleContent(locale, content, readCampaignBody)
);

/**
 * One locale's texts still being written, for a preview: the body's links,
 * buttons and images may be unfinished.
 */
export const toUnfinishedCampaignLocaleContent = Effect.fn(
  "CampaignOperations.toUnfinishedCampaignLocaleContent"
)((locale: Locale, content: AdministrationCampaignLocaleContentInputType) =>
  parseLocaleContent(locale, content, readUnfinishedCampaignBody)
);

export const toCampaignLocalizedContent = (
  content: AdministrationCampaignContentInputType
) =>
  Effect.forEach(localeEntries(content), ([locale, localeContent]) =>
    toCampaignLocaleContent(locale, localeContent).pipe(
      Effect.map((parsed) => [locale, parsed] as const)
    )
  ).pipe(
    Effect.map(
      (entries): CampaignLocalizedContent => Object.fromEntries(entries)
    )
  );

export const toAdministrationAudience = (
  audience: CampaignAudienceRow
): AdministrationCampaignAudienceType => ({
  id: audience.id,
  title: audience.title,
  filter: audience.filter,
  archivedAt: audience.archivedAt?.toString() ?? null,
  createdAt: audience.createdAt.toString(),
  updatedAt: audience.updatedAt.toString(),
});

export const toAdministrationCampaignSummary = (
  campaign: CampaignRow
): AdministrationCampaignSummaryType => ({
  id: campaign.id,
  title: campaign.title,
  purpose: campaign.purpose,
  templateKey: campaign.templateKey,
  delivery: campaign.delivery,
  status: campaign.status,
  audienceId: campaign.audienceId,
  locales: localeEntries(campaign.content).map(([locale]) => locale),
  createdAt: campaign.createdAt.toString(),
  updatedAt: campaign.updatedAt.toString(),
});

const toAdministrationLocaleContent = ({
  body,
  ...content
}: CampaignLocaleContent): AdministrationCampaignLocaleContentType => ({
  ...content,
  bodyMarkdown: campaignBodyToMarkdown(body),
});

export const toAdministrationCampaignDetail = (
  campaign: CampaignRow
): AdministrationCampaignDetailType => ({
  ...toAdministrationCampaignSummary(campaign),
  content: Object.fromEntries(
    localeEntries(campaign.content).map(([locale, content]) => [
      locale,
      toAdministrationLocaleContent(content),
    ])
  ),
});

const toAdministrationEditorLocaleContent = ({
  body,
  ...content
}: CampaignLocaleContent): AdministrationCampaignEditorLocaleContentType => ({
  ...content,
  bodyDocument: body,
});

/** The campaign with its bodies as stored, which the editor edits losslessly. */
export const toAdministrationCampaignEditorContent = (
  campaign: CampaignRow
): AdministrationCampaignEditorContentType => ({
  ...toAdministrationCampaignSummary(campaign),
  content: Object.fromEntries(
    localeEntries(campaign.content).map(([locale, content]) => [
      locale,
      toAdministrationEditorLocaleContent(content),
    ])
  ),
});

export const toAdministrationSendStatus = (
  status: Effect.Success<ReturnType<ICampaignSendStatusService["get"]>>
): AdministrationCampaignSendStatusResultType => ({
  send: Option.match(status, {
    onNone: () => null,
    onSome: (send) => ({
      sendId: send.sendId,
      createdAt: send.createdAt.toString(),
      completedAt: send.completedAt?.toString() ?? null,
      audienceId: send.audienceId,
      audienceFilter: send.audienceFilter,
      counts: send.counts,
      recipients: send.recipients.map((recipient) => ({
        customerId: recipient.dotyposCustomerId,
        locale: recipient.locale,
        status: recipient.status,
        skipReason: recipient.skipReason,
        statusUpdatedAt: recipient.statusUpdatedAt.toString(),
      })),
    }),
  }),
});
