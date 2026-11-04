import {
  type EmailContentLocation,
  type EmailDocumentProblem,
  type EmailDraft,
  emailDraftProblems,
  EmailDocumentProblem as Problem,
} from "@deskohub/workspace-admin-api";
import { Option } from "effect";
import { m } from "@/features/administration/i18n";
import {
  disallowedEmailImages,
  type EmailImageNotAllowed,
} from "@/features/emails/body/email-image-policy";
import type { Locale } from "@/features/i18n";
import type { EmailDraftFormValues } from "./email-draft-form";
import { emailEditorFieldIds } from "./email-editor-field-ids";

/** Something that keeps the draft from publication, placed on one field. */
export type EmailEditorProblem = {
  /** The field that shows the problem; `undefined` for the whole email. */
  readonly fieldId: string | undefined;
  /** The language the field belongs to, for translated fields. */
  readonly locale: string | undefined;
  /** The problem, worded for the field it marks. */
  readonly message: string;
  /** Where the field is, for the summary list. */
  readonly place: string;
};

const languageNames = {
  "en-US": m.emailsEditorLanguageEnglish,
  "cs-CZ": m.emailsEditorLanguageCzech,
} as const satisfies Record<Locale, typeof m.emailsEditorLanguageEnglish>;

/** A Workspace language's name in the administrator's language. */
export const emailEditorLanguageName = (
  language: string,
  locale: Locale
): string =>
  Object.hasOwn(languageNames, language)
    ? languageNames[language as Locale]({}, { locale })
    : language;

const componentSettingMessages = {
  href: m.emailsEditorProblemComponentHref,
  src: m.emailsEditorProblemComponentSrc,
  value: m.emailsEditorProblemComponentValue,
  fields: m.emailsEditorProblemComponentFields,
  items: m.emailsEditorProblemComponentItems,
  ordered: m.emailsEditorProblemComponentItems,
  level: m.emailsEditorProblemComponentLevel,
  sort: m.emailsEditorProblemComponentSort,
  limit: m.emailsEditorProblemComponentLimit,
} as const;

const valueSettingMessages = {
  path: m.emailsEditorProblemValuePath,
  sort: m.emailsEditorProblemValueSort,
  discountId: m.emailsEditorProblemValueDiscount,
  validDays: m.emailsEditorProblemValueValidDays,
  maxUses: m.emailsEditorProblemValueMaxUses,
  maxUsesPerCustomer: m.emailsEditorProblemValueMaxUsesPerCustomer,
} as const;

const selectionMessages = {
  "unknown-path": m.emailsEditorProblemSelectionUnknownPath,
  "fields-required": m.emailsEditorProblemSelectionFieldsRequired,
  "invalid-fields": m.emailsEditorProblemSelectionInvalidFields,
  "list-only": m.emailsEditorProblemSelectionListOnly,
  "invalid-sort": m.emailsEditorProblemSelectionInvalidSort,
  unsupported: m.emailsEditorProblemSelectionUnsupported,
} as const;

/** The value setting each customer selection problem marks. */
const selectionSettings = {
  "unknown-path": "path",
  "fields-required": "fields",
  "invalid-fields": "fields",
  "list-only": "path",
  "invalid-sort": "sort",
  unsupported: "path",
} as const satisfies Record<keyof typeof selectionMessages, string>;

const mismatchMessages = {
  discount: m.emailsEditorProblemValueMismatchDiscount,
  customer: m.emailsEditorProblemValueMismatchCustomer,
  record: m.emailsEditorProblemValueMismatchRecord,
  list: m.emailsEditorProblemValueMismatchList,
} as const;

/**
 * The setting field a value problem marks: the one its message names. A
 * source that fails as a whole marks the discount choice or the customer
 * field, the setting that identifies it.
 */
const valueSettingField = (
  field: string,
  kind: "customer" | "discount" | undefined
): string => {
  if (field !== "source") return field;
  return kind === "discount" ? "discountId" : "path";
};

type Placed = Pick<EmailEditorProblem, "fieldId" | "locale" | "place">;

/**
 * Words every problem in `draft` for the administrator in `locale` and
 * places it on its field: the publication problems for `currentLocales`,
 * then images publication would refuse.
 */
export const emailEditorProblems = ({
  draft,
  currentLocales,
  locale,
  imageCloudName,
  publishedImageSources,
}: {
  readonly draft: EmailDraftFormValues;
  readonly currentLocales: readonly string[];
  readonly locale: Locale;
  readonly imageCloudName: string | undefined;
  readonly publishedImageSources: ReadonlySet<string>;
}): readonly EmailEditorProblem[] => {
  // The draft's encoded form is its decoded form: it has no transformations.
  const decoded = draft as EmailDraft;
  const structure = draft.structure ?? [];
  const values = draft.values ?? [];
  const language = (code: string) => emailEditorLanguageName(code, locale);
  const blockNumber = (componentId: string | undefined) =>
    structure.findIndex((component) => component.id === componentId) + 1;
  const valueIndex = (name: string) =>
    values.findIndex((definition) => (definition.name ?? "") === name);

  const settings = (fieldId: string): Placed => ({
    fieldId,
    locale: undefined,
    place: m.emailsEditorPlaceSettings({}, { locale }),
  });
  const block = (componentId: string, setting?: string): Placed => ({
    fieldId: setting
      ? emailEditorFieldIds.componentSetting(componentId, setting)
      : emailEditorFieldIds.component(componentId),
    locale: undefined,
    place: m.emailsEditorPlaceBlock(
      { number: blockNumber(componentId) },
      { locale }
    ),
  });
  const blockAt = (index: number, componentId?: string): Placed => ({
    fieldId: componentId
      ? emailEditorFieldIds.component(componentId)
      : undefined,
    locale: undefined,
    place: m.emailsEditorPlaceBlock({ number: index + 1 }, { locale }),
  });
  const valueFieldId = (index: number, setting: string | undefined) => {
    if (index < 0) return undefined;
    return setting
      ? emailEditorFieldIds.valueSetting(index, setting)
      : emailEditorFieldIds.value(index);
  };
  const value = (index: number, setting?: string): Placed => {
    const name = values[index]?.name;
    return {
      fieldId: valueFieldId(index, setting),
      locale: undefined,
      place: name
        ? m.emailsEditorPlaceValue({ name }, { locale })
        : m.emailsEditorPlaceValueNumber({ number: index + 1 }, { locale }),
    };
  };
  const translated = (at: EmailContentLocation): Placed => {
    const placed = translatedField(at);
    // A language the Workspace no longer offers has no tab; its problems
    // point at the control that removes its translation.
    return at.locale === undefined || currentLocales.includes(at.locale)
      ? placed
      : {
          ...placed,
          fieldId: emailEditorFieldIds.retiredTranslation(at.locale),
          locale: undefined,
        };
  };
  const translatedField = (at: EmailContentLocation): Placed => {
    const code = at.locale ?? "";
    switch (at.field) {
      case "subject":
        return {
          fieldId: emailEditorFieldIds.translation(code, "subject"),
          locale: code,
          place: m.emailsEditorPlaceSubject(
            { language: language(code) },
            { locale }
          ),
        };
      case "preheader":
        return {
          fieldId: emailEditorFieldIds.translation(code, "preheader"),
          locale: code,
          place: m.emailsEditorPlacePreheader(
            { language: language(code) },
            { locale }
          ),
        };
      case "operationalReason":
        return {
          fieldId: emailEditorFieldIds.translation(code, "operationalReason"),
          locale: code,
          place: m.emailsEditorPlaceOperationalReason(
            { language: language(code) },
            { locale }
          ),
        };
      case "text":
        return {
          fieldId: emailEditorFieldIds.text(code, at.textKey ?? ""),
          locale: code,
          place: m.emailsEditorPlaceBlockText(
            { number: blockNumber(at.componentId), language: language(code) },
            { locale }
          ),
        };
      case "component":
        return block(at.componentId ?? "", "value");
    }
  };
  const text = (code: string, componentId: string, textKey: string): Placed =>
    translated({ locale: code, field: "text", componentId, textKey });

  const placed = (
    problem: EmailDocumentProblem
  ): Placed & { message: string } =>
    Problem.$match(problem, {
      PurposeMissing: () => ({
        ...settings(emailEditorFieldIds.purpose),
        message: m.emailsEditorProblemPurposeMissing({}, { locale }),
      }),
      TemplateMissing: () => ({
        ...settings(emailEditorFieldIds.template),
        message: m.emailsEditorProblemTemplateMissing({}, { locale }),
      }),
      BodyEmpty: () => ({
        fieldId: emailEditorFieldIds.addBlock,
        locale: undefined,
        place: m.emailsEditorPlaceBody({}, { locale }),
        message: m.emailsEditorProblemBodyEmpty({}, { locale }),
      }),
      ComponentIdDuplicate: ({ componentId }) => ({
        ...block(componentId),
        message: m.emailsEditorProblemComponentIdDuplicate({}, { locale }),
      }),
      ComponentIncomplete: ({ index, componentId, field }) => {
        const setting = Object.hasOwn(componentSettingMessages, field)
          ? (field as keyof typeof componentSettingMessages)
          : undefined;
        return {
          ...(componentId && setting
            ? block(componentId, setting === "ordered" ? "items" : setting)
            : blockAt(index, componentId)),
          message: (setting
            ? componentSettingMessages[setting]
            : m.emailsEditorProblemComponentSettings)({}, { locale }),
        };
      },
      DestinationInvalid: ({ componentId, field }) => ({
        ...(field.startsWith("links.")
          ? {
              ...block(componentId),
              fieldId: emailEditorFieldIds.componentLink(
                componentId,
                field.slice("links.".length)
              ),
            }
          : block(componentId, field)),
        message: m.emailsEditorProblemDestinationInvalid({}, { locale }),
      }),
      ImageSourceInvalid: ({ componentId }) => ({
        ...block(componentId, "src"),
        message: m.emailsEditorProblemImageSourceInvalid({}, { locale }),
      }),
      ValueNameDuplicate: ({ name }) => ({
        ...value(valueIndex(name), "name"),
        message: m.emailsEditorProblemValueNameDuplicate({ name }, { locale }),
      }),
      ValueNameInvalid: ({ index }) => ({
        ...value(index, "name"),
        message: m.emailsEditorProblemValueNameInvalid({}, { locale }),
      }),
      ValueIncomplete: ({ index, field }) => {
        const setting = valueSettingField(field, values[index]?.source?.kind);
        return {
          ...value(index, setting),
          message: (field !== "source" &&
            Object.hasOwn(valueSettingMessages, setting)
            ? valueSettingMessages[setting as keyof typeof valueSettingMessages]
            : m.emailsEditorProblemValueSource)({}, { locale }),
        };
      },
      CustomerSelectionInvalid: ({ name, reason }) => ({
        ...value(valueIndex(name), selectionSettings[reason]),
        message: selectionMessages[reason]({}, { locale }),
      }),
      LanguageMissing: ({ locale: code }) => ({
        ...translated({ locale: code, field: "subject" }),
        message: m.emailsEditorProblemLanguageMissing({}, { locale }),
      }),
      SubjectEmpty: ({ locale: code }) => ({
        ...translated({ locale: code, field: "subject" }),
        message: m.emailsEditorProblemSubjectEmpty({}, { locale }),
      }),
      TextMissing: ({ locale: code, componentId, textKey }) => ({
        ...text(code, componentId, textKey),
        message: m.emailsEditorProblemTextMissing({}, { locale }),
      }),
      TextEmpty: ({ locale: code, componentId, textKey }) => ({
        ...text(code, componentId, textKey),
        message: m.emailsEditorProblemTextEmpty({}, { locale }),
      }),
      ValueUnknown: ({ name, at }) => ({
        ...translated(at),
        message: m.emailsEditorProblemValueUnknown({ name }, { locale }),
      }),
      ValueReferenceIncomplete: ({ at }) => ({
        ...translated(at),
        message: m.emailsEditorProblemValueReferenceIncomplete({}, { locale }),
      }),
      ValueReferenceInvalid: ({ name, at }) => ({
        ...translated(at),
        message: m.emailsEditorProblemValueReferenceInvalid(
          { name },
          { locale }
        ),
      }),
      FormattingNotAllowed: ({ at }) => ({
        ...translated(at),
        message: m.emailsEditorProblemFormattingNotAllowed({}, { locale }),
      }),
      LinkUnknown: ({ at }) => ({
        ...translated(at),
        message: m.emailsEditorProblemLinkUnknown({}, { locale }),
      }),
      ComponentValueMismatch: ({ componentId, expected }) => ({
        ...block(componentId, "value"),
        message: mismatchMessages[expected]({}, { locale }),
      }),
      ComponentFieldsRequired: ({ componentId }) => ({
        ...block(componentId, "fields"),
        message: m.emailsEditorProblemComponentFieldsRequired({}, { locale }),
      }),
      ComponentFieldInvalid: ({ componentId, name }) => ({
        ...block(componentId, "fields"),
        message: m.emailsEditorProblemComponentFieldInvalid(
          { name },
          { locale }
        ),
      }),
      ListSortInvalid: ({ componentId, name }) => ({
        ...block(componentId, "sort"),
        message: m.emailsEditorProblemListSortInvalid({ name }, { locale }),
      }),
      ListLimitExceeded: ({ componentId, name }) => ({
        ...block(componentId, "limit"),
        message: m.emailsEditorProblemListLimitExceeded({ name }, { locale }),
      }),
      DocumentInvalid: () => ({
        fieldId: undefined,
        locale: undefined,
        place: m.emailsEditorPlaceDocument({}, { locale }),
        message: m.emailsEditorProblemDocumentInvalid({}, { locale }),
      }),
    });

  const image = ({ componentId }: EmailImageNotAllowed) => ({
    ...block(componentId, "src"),
    message: m.emailsEditorProblemImageNotAllowed({}, { locale }),
  });

  return [
    ...emailDraftProblems(decoded, currentLocales).map(placed),
    ...disallowedEmailImages(
      decoded,
      Option.fromNullishOr(imageCloudName),
      publishedImageSources
    ).map(image),
  ];
};

/**
 * Languages the draft has a translation in that the Workspace no longer
 * offers, in stored order. Publication still checks them, so the editor
 * offers to remove them.
 */
export const retiredEmailTranslationLocales = (
  draft: EmailDraftFormValues,
  currentLocales: readonly string[]
): readonly string[] =>
  Object.keys(draft.translations ?? {}).filter(
    (language) => !currentLocales.includes(language)
  );

/** Problems the language tab `language` shows, for its badge. */
export const emailEditorLanguageProblemCount = (
  problems: readonly EmailEditorProblem[],
  language: string
): number => problems.filter((problem) => problem.locale === language).length;
