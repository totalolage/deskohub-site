import type {
  AdministrationCampaignContentInputType,
  AdministrationCampaignEditorContentType,
  AdministrationCampaignEditorLocaleContentType,
  AdministrationCampaignUpdateInputType,
  CampaignTemplatePreviewInputType,
} from "@deskohub/workspace-admin-api";
import { Data, Match, type Option, Schema } from "effect";
import { m } from "@/features/administration/i18n";
import type { Locale } from "@/features/i18n";
import {
  CampaignBodyNode as CampaignBodyNodeSchema,
  campaignBodyFormatVersion,
} from "../../body/campaign-body-document";
import {
  type CampaignBodyIssue,
  campaignBodyIssues,
  emptyCampaignBody,
  isCampaignBodyEmpty,
} from "../../body/campaign-body-rules";
import {
  CampaignPurpose,
  CampaignTemplateKey,
} from "../../body/campaign-content";
import {
  campaignFallbackLocale,
  campaignLocales,
} from "../../recipient-locale";

const CampaignComposerLocaleFields = Schema.Struct({
  subject: Schema.String,
  preheader: Schema.String,
  body: CampaignBodyNodeSchema,
  /** Empty means the locale's fixed operational reason line. */
  operationalReason: Schema.String,
});

export type CampaignComposerLocaleFields =
  typeof CampaignComposerLocaleFields.Type;

/**
 * The composer form: one set of localized fields per supported locale.
 * `locale` is the admin's language for validation messages.
 */
export const createCampaignComposerFields = (locale: Locale) =>
  Schema.Struct({
    title: Schema.String.check(
      Schema.makeFilter(
        (title) =>
          title.trim().length > 0 ||
          m.emailCampaignsComposerTitleRequired({}, { locale })
      )
    ),
    purpose: CampaignPurpose,
    templateKey: CampaignTemplateKey,
    /** Empty means no audience yet. */
    audienceId: Schema.String,
    locales: Schema.Struct({
      "cs-CZ": CampaignComposerLocaleFields,
      "en-US": CampaignComposerLocaleFields,
    }),
  });

export type CampaignComposerFields = ReturnType<
  typeof createCampaignComposerFields
>["Type"];

const emptyLocaleFields: CampaignComposerLocaleFields = {
  subject: "",
  preheader: "",
  body: emptyCampaignBody,
  operationalReason: "",
};

export const newCampaignComposerFields: CampaignComposerFields = {
  title: "",
  purpose: "marketing",
  templateKey: "workspace",
  audienceId: "",
  locales: { "cs-CZ": emptyLocaleFields, "en-US": emptyLocaleFields },
};

const localeFieldsFromContent = (
  content: AdministrationCampaignEditorLocaleContentType | undefined
): CampaignComposerLocaleFields =>
  content
    ? {
        subject: content.subject,
        preheader: content.preheader,
        body: content.bodyDocument.doc,
        operationalReason: content.operationalReason ?? "",
      }
    : emptyLocaleFields;

/** The composer's fields for a saved campaign, as the campaign port reads it. */
export const campaignComposerFieldsFromCampaign = (
  campaign: AdministrationCampaignEditorContentType
): CampaignComposerFields => ({
  title: campaign.title,
  purpose: campaign.purpose,
  templateKey: campaign.templateKey,
  audienceId: campaign.audienceId ?? "",
  locales: {
    "cs-CZ": localeFieldsFromContent(campaign.content["cs-CZ"]),
    "en-US": localeFieldsFromContent(campaign.content["en-US"]),
  },
});

/** The locale has any text, so saving keeps it as campaign content. */
export const hasLocaleContent = (fields: CampaignComposerLocaleFields) =>
  fields.subject.trim().length > 0 ||
  fields.preheader.trim().length > 0 ||
  fields.operationalReason.trim().length > 0 ||
  !isCampaignBodyEmpty(fields.body);

/**
 * The locales the composer edits. An audience restricted to one locale needs
 * only that locale; otherwise every locale is editable and Czech, the
 * fallback for recipients without covered content, is required.
 */
export const composerLocales = (singleLocale: Locale | undefined) =>
  singleLocale
    ? { editable: [singleLocale], required: singleLocale }
    : { editable: campaignLocales, required: campaignFallbackLocale };

/**
 * One locale's texts as the campaign port takes them: the body crosses as
 * the editor's document, unchanged.
 */
const toAdministrationLocaleContent = (
  fields: CampaignComposerLocaleFields,
  purpose: CampaignPurpose
): AdministrationCampaignEditorLocaleContentType => {
  const operationalReason = fields.operationalReason.trim();
  return {
    subject: fields.subject.trim(),
    preheader: fields.preheader.trim(),
    bodyDocument: {
      formatVersion: campaignBodyFormatVersion,
      doc: fields.body,
    },
    ...(purpose === "operational" &&
      operationalReason.length > 0 && { operationalReason }),
  };
};

/**
 * The campaign port's preview of one locale still being written. The body
 * crosses as the editor's document, as saving sends it, and may hold
 * unfinished links, buttons and images.
 */
export const toCampaignPreviewInput = ({
  templateKey,
  purpose,
  locale,
  fields,
}: {
  readonly templateKey: CampaignTemplateKey;
  readonly purpose: CampaignPurpose;
  readonly locale: Locale;
  readonly fields: CampaignComposerLocaleFields;
}): CampaignTemplatePreviewInputType => ({
  templateKey,
  preview: {
    _tag: "UnfinishedContent",
    purpose,
    locale,
    content: toAdministrationLocaleContent(fields, purpose),
  },
});

/** A new campaign's content: each editable locale that has any text. */
export const toAdministrationCampaignContent = (
  fields: CampaignComposerFields,
  editableLocales: readonly Locale[]
): AdministrationCampaignContentInputType =>
  Object.fromEntries(
    editableLocales
      .filter((locale) => hasLocaleContent(fields.locales[locale]))
      .map((locale) => [
        locale,
        toAdministrationLocaleContent(fields.locales[locale], fields.purpose),
      ])
  );

/**
 * A draft edit that replaces the saved content: each editable locale with
 * text is rewritten, without a reason line unless one is set, and every other
 * locale loses any content it has. It doesn't depend on which locales the
 * last save left, which a save still in flight can change.
 */
export const toAdministrationCampaignContentChange = (
  fields: CampaignComposerFields,
  editableLocales: readonly Locale[]
): NonNullable<AdministrationCampaignUpdateInputType["content"]> => {
  const content = toAdministrationCampaignContent(fields, editableLocales);
  return Object.fromEntries(
    campaignLocales.map((locale) => {
      const localeContent = content[locale];
      return [
        locale,
        localeContent === undefined
          ? null
          : { operationalReason: null, ...localeContent },
      ];
    })
  );
};

/**
 * What the composer asks for before a send, besides the body rules: a subject
 * and a body. `path` names the field.
 */
type CampaignComposerContentIssue = Data.TaggedEnum<{
  SubjectMissing: { readonly path: readonly ["subject"] };
  BodyMissing: { readonly path: readonly ["body"] };
}>;

const CampaignComposerContentIssue =
  Data.taggedEnum<CampaignComposerContentIssue>();

/**
 * A problem in one locale's content that a send would trip over. A body rule
 * issue's `path` points into the body.
 */
export type LocaleContentIssue =
  | CampaignComposerContentIssue
  | CampaignBodyIssue;

/**
 * Problems in one locale's content that a send would trip over. Images must
 * come from the Cloudinary account `imageCloudName`.
 */
export const localeContentIssues = (
  fields: CampaignComposerLocaleFields,
  imageCloudName: Option.Option<string>
): readonly LocaleContentIssue[] => [
  ...(fields.subject.trim().length === 0
    ? [CampaignComposerContentIssue.SubjectMissing({ path: ["subject"] })]
    : []),
  ...(isCampaignBodyEmpty(fields.body)
    ? [CampaignComposerContentIssue.BodyMissing({ path: ["body"] })]
    : campaignBodyIssues(fields.body, imageCloudName)),
];

/** The issue described in the admin's `locale`. */
export const localeContentIssueMessage = (
  issue: LocaleContentIssue,
  locale: Locale
): string =>
  Match.value(issue).pipe(
    Match.tagsExhaustive({
      SubjectMissing: () =>
        m.emailCampaignsComposerSubjectMissing({}, { locale }),
      BodyMissing: () => m.emailCampaignsBodyMissing({}, { locale }),
      NotDocument: () => m.emailCampaignsBodyNotDocument({}, { locale }),
      // The schema's own message is internal, so it isn't shown.
      StructureInvalid: () =>
        m.emailCampaignsBodyStructureInvalid({}, { locale }),
      LinkHrefInvalid: () =>
        m.emailCampaignsBodyLinkHrefInvalid({}, { locale }),
      ImageSourceInvalid: () =>
        m.emailCampaignsBodyImageSourceInvalid({}, { locale }),
      ImageLayoutInvalid: () =>
        m.emailCampaignsBodyImageLayoutInvalid({}, { locale }),
      ButtonLabelMissing: () =>
        m.emailCampaignsBodyButtonLabelMissing({}, { locale }),
      ButtonLabelLineBreaks: () =>
        m.emailCampaignsBodyButtonLabelLineBreaks({}, { locale }),
      ButtonHrefInvalid: () =>
        m.emailCampaignsBodyButtonHrefInvalid({}, { locale }),
    })
  );
