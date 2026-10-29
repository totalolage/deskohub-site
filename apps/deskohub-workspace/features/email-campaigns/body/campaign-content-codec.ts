import type {
  AdministrationCampaignBodyDocumentType,
  AdministrationCampaignContentInputType,
  AdministrationCampaignEditorLocaleContentType,
  AdministrationCampaignLocaleContentType,
  CampaignPatchInput,
} from "@deskohub/workspace-admin-api";
import { Effect, Schema } from "effect";
// The order campaign content is read, changed and written in. C91 replaces
// it with the campaign's own `contentLocales`.
import { locales as contentLocaleOrder, type Locale } from "@/features/i18n";
import type { CampaignId } from "../campaign-identifiers";
import {
  CampaignBodyDocumentInvalid,
  CampaignBodyMarkdownInvalid,
  CampaignLocaleContentMissing,
} from "../errors";
import {
  type CampaignBodyDocument,
  campaignBodyDocument,
  UnfinishedCampaignBodyDocument,
} from "./campaign-body-document";
import {
  campaignBodyFromMarkdown,
  campaignBodyToMarkdown,
} from "./campaign-body-markdown";
import type {
  CampaignLocaleContent,
  CampaignLocalizedContent,
} from "./campaign-content";
import { campaignBodyImageSources } from "./campaign-image";
import { campaignImageCloudName } from "./campaign-image-account";
import { InvalidCampaignBody } from "./invalid-campaign-body";

/** The locales a per-locale record has a value for, in content order. */
const contentLocaleEntries = <Value>(
  record: Partial<Record<Locale, Value>>
): ReadonlyArray<readonly [Locale, Value]> =>
  contentLocaleOrder.flatMap((locale) => {
    const value = record[locale];
    return value === undefined ? [] : [[locale, value] as const];
  });

/** The locales the campaign has content for, in content order. */
export const campaignContentLocales = (
  content: CampaignLocalizedContent
): ReadonlyArray<Locale> =>
  contentLocaleEntries(content).map(([locale]) => locale);

/** Every image in the content: its source and the locale whose body has it. */
export const campaignContentImages = (
  content: CampaignLocalizedContent
): ReadonlyArray<{ readonly locale: Locale; readonly source: string }> =>
  contentLocaleEntries(content).flatMap(([locale, { body }]) =>
    campaignBodyImageSources(body.doc).map((source) => ({ locale, source }))
  );

/** A locale's body as the administration API gives it. */
type CampaignBodyInput =
  | { readonly bodyMarkdown: string }
  | { readonly bodyDocument: AdministrationCampaignBodyDocumentType };

/** The rules a read holds bodies to. */
type CampaignBodyRules = Effect.Effect<typeof UnfinishedCampaignBodyDocument>;

/** Saved content: links, buttons and images must be finished. */
const finishedBodyRules: CampaignBodyRules = campaignImageCloudName.pipe(
  Effect.map(campaignBodyDocument)
);

/** Content still being written, as a preview renders it. */
const draftBodyRules: CampaignBodyRules = Effect.succeed(
  UnfinishedCampaignBodyDocument
);

/** A body in either wire form, spelled as a document but not yet checked. */
type SpelledCampaignBody =
  | AdministrationCampaignBodyDocumentType
  | Effect.Success<ReturnType<typeof campaignBodyFromMarkdown>>;

const checkBody = (rules: CampaignBodyRules, body: SpelledCampaignBody) =>
  rules.pipe(
    Effect.flatMap((schema) => Schema.decodeUnknownEffect(schema)(body)),
    Effect.mapError(InvalidCampaignBody.fromCause)
  );

/**
 * Reads a locale's body, given as Markdown or as the editor's document. A
 * document keeps every node and attribute; failures name the locale.
 */
const readBody = (
  rules: CampaignBodyRules,
  locale: Locale,
  input: CampaignBodyInput
): Effect.Effect<
  CampaignBodyDocument,
  CampaignBodyDocumentInvalid | CampaignBodyMarkdownInvalid
> =>
  "bodyDocument" in input
    ? checkBody(rules, input.bodyDocument).pipe(
        Effect.mapError(
          (cause) => new CampaignBodyDocumentInvalid({ locale, cause })
        )
      )
    : campaignBodyFromMarkdown(input.bodyMarkdown).pipe(
        Effect.flatMap((body) => checkBody(rules, body)),
        Effect.mapError(
          (cause) => new CampaignBodyMarkdownInvalid({ locale, cause })
        )
      );

/** A locale's texts, with the operational reason only when one is set. */
const localeContent = (
  texts: Omit<CampaignLocaleContent, "operationalReason">,
  operationalReason: string | undefined
): CampaignLocaleContent =>
  operationalReason === undefined ? texts : { ...texts, operationalReason };

const readContent =
  (rules: CampaignBodyRules) =>
  (
    input: AdministrationCampaignContentInputType
  ): Effect.Effect<
    CampaignLocalizedContent,
    CampaignBodyDocumentInvalid | CampaignBodyMarkdownInvalid
  > =>
    Effect.forEach(
      contentLocaleEntries(input),
      ([locale, { subject, preheader, operationalReason, ...body }]) =>
        readBody(rules, locale, body).pipe(
          Effect.map(
            (read) =>
              [
                locale,
                localeContent(
                  { subject, preheader, body: read },
                  operationalReason
                ),
              ] as const
          )
        )
    ).pipe(Effect.map((entries) => Object.fromEntries(entries)));

/**
 * Reads complete content as the administration API gives it, holding every
 * body to the rules saving applies. The first locale whose body fails names
 * itself in the error.
 */
export const readCampaignContent = Effect.fn("readCampaignContent")(
  readContent(finishedBodyRules)
);

/**
 * Reads content still being written, for a preview: like
 * `readCampaignContent`, but links, buttons and images may be unfinished.
 * Never save what it returns.
 */
export const readCampaignDraftContent = Effect.fn("readCampaignDraftContent")(
  readContent(draftBodyRules)
);

/**
 * Per-locale changes to a campaign's texts, with Markdown or document
 * bodies. A locale mapped to null loses its content; omitted locales are
 * unchanged.
 */
export type CampaignContentChanges = NonNullable<CampaignPatchInput["content"]>;
type CampaignLocaleContentChange = NonNullable<CampaignContentChanges[Locale]>;

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
      : yield* readBody(finishedBodyRules, locale, bodyInput);
  const subject = change.subject ?? current?.subject;
  if (body === undefined || subject === undefined) {
    return yield* new CampaignLocaleContentMissing({ campaignId, locale });
  }
  return localeContent(
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

/**
 * Applies per-locale changes to a campaign's current content, holding
 * changed bodies to the rules saving applies. Pure: the caller reads
 * `current` under the lock it writes the result in.
 */
export const changeCampaignContent = Effect.fn("changeCampaignContent")(
  (input: {
    readonly campaignId: CampaignId;
    readonly current: CampaignLocalizedContent;
    readonly changes: CampaignContentChanges;
  }) =>
    Effect.forEach(contentLocaleOrder, (locale) =>
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
    )
);

/** One locale's texts in each wire form the administration API sends. */
type CampaignLocaleWireForms = {
  /** `dhw`'s form; Markdown can't round-trip every editor document. */
  readonly markdown: AdministrationCampaignLocaleContentType;
  /** The body as stored, which the editor edits losslessly. */
  readonly document: AdministrationCampaignEditorLocaleContentType;
};

/** A wire form campaign content is written in. */
export type CampaignContentForm = keyof CampaignLocaleWireForms;

/** Mapped, so that indexing it with a generic form keeps that form's type. */
type CampaignLocaleWriters = {
  readonly [Form in CampaignContentForm]: (
    content: CampaignLocaleContent
  ) => CampaignLocaleWireForms[Form];
};

const localeWriters: CampaignLocaleWriters = {
  markdown: ({ body, ...texts }) => ({
    ...texts,
    bodyMarkdown: campaignBodyToMarkdown(body),
  }),
  document: ({ body, ...texts }) => ({ ...texts, bodyDocument: body }),
};

/** Content in a wire form; a locale without content is absent. */
export type WrittenCampaignContent<Form extends CampaignContentForm> = {
  readonly [L in Locale]?: CampaignLocaleWireForms[Form];
};

/** Writes content in the wire form `form`, in content locale order. */
export const writeCampaignContent = <Form extends CampaignContentForm>(
  content: CampaignLocalizedContent,
  form: Form
): WrittenCampaignContent<Form> => {
  const write = localeWriters[form];
  return Object.fromEntries(
    contentLocaleEntries(content).map(([locale, texts]) => [
      locale,
      write(texts),
    ])
  );
};
