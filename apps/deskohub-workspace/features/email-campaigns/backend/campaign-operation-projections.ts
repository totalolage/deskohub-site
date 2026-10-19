import type {
  AdministrationCampaignAudienceType,
  AdministrationCampaignContentType,
  AdministrationCampaignDetailType,
  AdministrationCampaignLocaleContentType,
  AdministrationCampaignSendStatusResultType,
  AdministrationCampaignSummaryType,
} from "@deskohub/workspace-admin-api";
import { Effect, Option } from "effect";
import type { CampaignAudienceRow, CampaignRow } from "@/db/schema";
import { type Locale, locales } from "@/features/i18n";
import {
  campaignBodyToMarkdown,
  parseCampaignBodyMarkdown,
} from "../body/campaign-body-markdown";
import type {
  CampaignLocaleContent,
  CampaignLocalizedContent,
} from "../body/campaign-content";
import { CampaignBodyMarkdownInvalid } from "../errors";
import type { ICampaignSendStatusService } from "./campaign-send-status.service";

/** The locales a per-locale record has a value for, in locale order. */
export const localeEntries = <Value>(
  record: Partial<Record<Locale, Value>>
): ReadonlyArray<readonly [Locale, Value]> =>
  locales.flatMap((locale) => {
    const value = record[locale];
    return value === undefined ? [] : [[locale, value] as const];
  });

/** Parses one locale's Markdown body; its failure names the locale. */
const parseLocaleBody = (locale: Locale, markdown: string) =>
  parseCampaignBodyMarkdown(markdown).pipe(
    Effect.mapError(
      (cause) => new CampaignBodyMarkdownInvalid({ locale, cause })
    )
  );

const withOperationalReason = (
  content: Omit<CampaignLocaleContent, "operationalReason">,
  operationalReason: string | undefined
): CampaignLocaleContent =>
  operationalReason === undefined ? content : { ...content, operationalReason };

/** One locale's texts as the contract sends them, with a parsed body. */
export const toCampaignLocaleContent = Effect.fn(
  "CampaignOperations.toCampaignLocaleContent"
)(function* (locale: Locale, content: AdministrationCampaignLocaleContentType) {
  const body = yield* parseLocaleBody(locale, content.bodyMarkdown);
  return withOperationalReason(
    { subject: content.subject, preheader: content.preheader, body },
    content.operationalReason
  );
});

export const toCampaignLocalizedContent = (
  content: AdministrationCampaignContentType
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
