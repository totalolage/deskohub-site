import type { CampaignPatchInput } from "@deskohub/workspace-admin-api";
import { Effect } from "effect";
import { type Locale, locales } from "@/features/i18n";
import type { CampaignId } from "../campaign-identifiers";
import {
  type CampaignBodyDocumentInvalid,
  type CampaignBodyMarkdownInvalid,
  CampaignLocaleContentMissing,
} from "../errors";
import {
  type CampaignBodyInput,
  readCampaignBody,
} from "./campaign-body-input";
import type {
  CampaignLocaleContent,
  CampaignLocalizedContent,
} from "./campaign-content";

/**
 * Per-locale changes to a campaign's texts, with Markdown or document bodies. A locale
 * mapped to null loses its content; omitted locales are unchanged.
 */
export type CampaignContentChanges = NonNullable<CampaignPatchInput["content"]>;
type CampaignLocaleContentChange = NonNullable<CampaignContentChanges[Locale]>;

const withOperationalReason = (
  content: Omit<CampaignLocaleContent, "operationalReason">,
  operationalReason: string | undefined
): CampaignLocaleContent =>
  operationalReason === undefined ? content : { ...content, operationalReason };

/** The body a change gives, if any; the contract allows only one form. */
const changedBody = ({
  bodyDocument,
  bodyMarkdown,
}: CampaignLocaleContentChange): CampaignBodyInput | undefined => {
  if (bodyDocument !== undefined) return { bodyDocument };
  if (bodyMarkdown !== undefined) return { bodyMarkdown };
  return undefined;
};

/**
 * Merges one locale's change into its current content. Omitted fields keep
 * their value, a null `operationalReason` restores the default reason line,
 * and a locale without content needs both a subject and a body.
 */
const applyLocaleChange = Effect.fn("applyCampaignLocaleChange")(function* (
  campaignId: CampaignId,
  locale: Locale,
  current: CampaignLocaleContent | undefined,
  change: CampaignLocaleContentChange
) {
  const bodyInput = changedBody(change);
  const body =
    bodyInput === undefined
      ? current?.body
      : yield* readCampaignBody(locale, bodyInput);
  const subject = change.subject ?? current?.subject;
  if (body === undefined || subject === undefined) {
    return yield* new CampaignLocaleContentMissing({ campaignId, locale });
  }
  return withOperationalReason(
    {
      subject,
      preheader: change.preheader ?? current?.preheader ?? "",
      body,
    },
    change.operationalReason === undefined
      ? current?.operationalReason
      : (change.operationalReason ?? undefined)
  );
});

const changeLocaleContent = (
  campaignId: CampaignId,
  locale: Locale,
  current: CampaignLocaleContent | undefined,
  change: CampaignLocaleContentChange | null | undefined
): Effect.Effect<
  CampaignLocaleContent | undefined,
  | CampaignBodyDocumentInvalid
  | CampaignBodyMarkdownInvalid
  | CampaignLocaleContentMissing
> => {
  if (change === undefined) return Effect.succeed(current);
  if (change === null) return Effect.succeed(undefined);
  return applyLocaleChange(campaignId, locale, current, change);
};

/** Applies per-locale changes to a campaign's current content. */
export const changeCampaignContent = (input: {
  readonly campaignId: CampaignId;
  readonly current: CampaignLocalizedContent;
  readonly changes: CampaignContentChanges;
}) =>
  Effect.forEach(locales, (locale) =>
    changeLocaleContent(
      input.campaignId,
      locale,
      input.current[locale],
      input.changes[locale]
    ).pipe(Effect.map((content) => [locale, content] as const))
  ).pipe(
    Effect.map(
      (changed): CampaignLocalizedContent =>
        Object.fromEntries(
          changed.flatMap(([locale, content]) =>
            content === undefined ? [] : [[locale, content] as const]
          )
        )
    )
  );
