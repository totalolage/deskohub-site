import { Match, Schema } from "effect";
import { AdministrationCampaignPurpose } from "./campaign-locale-and-purpose";
import { AdministrationCampaignTemplateKey } from "./email-campaigns";
import {
  EmailCustomerSelection,
  EmailCustomerSelectionInvalid,
  emailCustomerFieldAtPath,
  emailCustomerFieldCatalogue,
  inspectEmailCustomerSelection,
  isEmailCustomerScalar,
} from "./email-customer-selection";
import { EmailValueName } from "./email-identifiers";
import { AdministrationStoredDiscountId } from "./workspace-admin-api";

const key = Schema.NonEmptyString;
const path = Schema.Array(key).check(Schema.isMinLength(1));
const httpUrl = Schema.String.check(Schema.isPattern(/^https?:\/\/[^\s]+$/));

export const EmailInlinePart = Schema.Union([
  Schema.TaggedStruct("Text", { text: Schema.String }),
  Schema.TaggedStruct("Value", {
    name: EmailValueName,
    field: Schema.optionalKey(path),
  }),
]);
export type EmailInlinePart = typeof EmailInlinePart.Type;
const inline = Schema.Array(EmailInlinePart);

export const EmailDiscountSelection = Schema.Struct({
  kind: Schema.Literal("discount"),
  discountId: AdministrationStoredDiscountId,
  validDays: Schema.Int.check(Schema.isGreaterThan(0)),
  maxUses: Schema.Int.check(Schema.isGreaterThan(0)),
  maxUsesPerCustomer: Schema.Int.check(Schema.isGreaterThan(0)),
});
export type EmailDiscountSelection = typeof EmailDiscountSelection.Type;

/** Position in this array is generation order; unused definitions are not generated. */
export const EmailValueDefinition = Schema.Struct({
  name: EmailValueName,
  source: Schema.Union([EmailCustomerSelection, EmailDiscountSelection]),
  fallback: Schema.optionalKey(Schema.Record(key, Schema.String)),
});
export type EmailValueDefinition = typeof EmailValueDefinition.Type;

const componentField = Schema.Struct({ field: path, labelKey: key });
const fields = Schema.Array(componentField).check(Schema.isMinLength(1));
export const EmailBodyComponent = Schema.Union([
  Schema.TaggedStruct("Paragraph", { id: key, textKey: key }),
  Schema.TaggedStruct("Heading", {
    id: key,
    textKey: key,
    level: Schema.Literals([1, 2, 3]),
  }),
  Schema.TaggedStruct("Image", {
    id: key,
    src: httpUrl,
    altKey: key,
    href: Schema.optionalKey(httpUrl),
  }),
  Schema.TaggedStruct("Button", { id: key, labelKey: key, href: httpUrl }),
  Schema.TaggedStruct("Record", { id: key, value: EmailValueName, fields }),
  Schema.TaggedStruct("List", {
    id: key,
    value: EmailValueName,
    fields: Schema.optionalKey(fields),
  }),
  Schema.TaggedStruct("Offer", {
    id: key,
    value: EmailValueName,
    labelKey: key,
    href: httpUrl,
  }),
]);
export type EmailBodyComponent = typeof EmailBodyComponent.Type;

const translationFields = Schema.Struct({
  subject: inline,
  preheader: inline,
  texts: Schema.Record(key, inline),
  operationalReason: Schema.optionalKey(inline),
});
export const EmailTranslation = translationFields;
export type EmailTranslation = typeof EmailTranslation.Type;

/** An incomplete editor state is serializable, but is never a published document. */
export const EmailDraft = Schema.Struct({
  purpose: Schema.optionalKey(AdministrationCampaignPurpose),
  templateKey: Schema.optionalKey(AdministrationCampaignTemplateKey),
  structure: Schema.optionalKey(Schema.Array(EmailBodyComponent)),
  translations: Schema.optionalKey(
    Schema.Record(
      key,
      Schema.Struct({
        subject: Schema.optionalKey(inline),
        preheader: Schema.optionalKey(inline),
        texts: Schema.optionalKey(Schema.Record(key, inline)),
        operationalReason: Schema.optionalKey(inline),
      })
    )
  ),
  values: Schema.optionalKey(Schema.Array(EmailValueDefinition)),
}).annotate({ identifier: "EmailDraft" });
export type EmailDraft = typeof EmailDraft.Type;

/** Historical decoding deliberately does not require today's Workspace languages or field catalogue. */
export const EmailDocument = Schema.Struct({
  purpose: AdministrationCampaignPurpose,
  templateKey: AdministrationCampaignTemplateKey,
  structure: Schema.Array(EmailBodyComponent),
  translations: Schema.Record(key, EmailTranslation),
  values: Schema.Array(EmailValueDefinition),
}).annotate({ identifier: "EmailDocument" });
export type EmailDocument = typeof EmailDocument.Type;

/** Call with the application's current locale registry at every explicit publication. */
export const emailDocumentForPublication = (
  currentLocales: readonly string[]
) =>
  EmailDocument.check(
    Schema.makeFilter(
      (document) =>
        emailPublicationProblems(document, currentLocales).length === 0,
      {
        description:
          "Every current language, nonempty subjects and body, unique names and component ids, valid localized text and typed value references are required.",
      }
    )
  );

/** Stable ordered required set, frozen alongside the selected version before generation. */
export const requiredEmailValueNames = (
  document: EmailDocument
): readonly EmailValueName[] => {
  const referenced = new Set<EmailValueName>(
    document.structure.flatMap((component) =>
      "value" in component ? [component.value] : []
    )
  );
  for (const translation of Object.values(document.translations)) {
    for (const part of translatedParts(document.structure, translation))
      if (part._tag === "Value") referenced.add(part.name);
  }
  return document.values
    .filter((definition) => referenced.has(definition.name))
    .map((definition) => definition.name);
};

export const emailPublicationProblems = (
  document: EmailDocument,
  currentLocales: readonly string[]
): readonly string[] => {
  const problems: string[] = [];
  const definitions = new Map(
    document.values.map((definition) => [definition.name, definition])
  );
  if (definitions.size !== document.values.length)
    problems.push("Duplicate value names.");
  if (
    new Set(document.structure.map((component) => component.id)).size !==
    document.structure.length
  )
    problems.push("Duplicate component ids.");
  if (document.structure.length === 0) problems.push("Body is empty.");
  for (const locale of currentLocales)
    if (!Object.hasOwn(document.translations, locale))
      problems.push(`Missing language: ${locale}.`);
  for (const definition of document.values)
    if (
      definition.source.kind === "customer" &&
      inspectEmailCustomerSelection(definition.source) instanceof
        EmailCustomerSelectionInvalid
    )
      problems.push(`Invalid customer selection: ${definition.name}.`);
  for (const [locale, translation] of Object.entries(document.translations)) {
    if (
      !translation.subject.length ||
      translation.subject.every(
        (part) => part._tag === "Text" && !part.text.trim()
      )
    )
      problems.push(`Empty subject: ${locale}.`);
    for (const textKey of componentTextKeys(document.structure))
      if (!Object.hasOwn(translation.texts, textKey))
        problems.push(`Missing text ${textKey}: ${locale}.`);
    for (const part of translatedParts(document.structure, translation)) {
      if (
        part._tag === "Value" &&
        !validScalarReference(definitions.get(part.name), part.field)
      )
        problems.push(`Invalid scalar value ${part.name}: ${locale}.`);
    }
  }
  for (const component of document.structure) {
    if (!("value" in component)) continue;
    const definition = definitions.get(component.value);
    if (!definition) {
      problems.push(`Unknown value: ${component.value}.`);
      continue;
    }
    if (component._tag === "Offer") {
      if (definition.source.kind !== "discount")
        problems.push(`Offer requires a discount: ${component.value}.`);
      continue;
    }
    if (definition.source.kind !== "customer") {
      problems.push(
        `Structured component requires customer data: ${component.value}.`
      );
      continue;
    }
    const selected = emailCustomerFieldAtPath(
      emailCustomerFieldCatalogue,
      definition.source.path
    );
    if (
      !selected ||
      (component._tag === "Record" && selected.kind !== "record") ||
      (component._tag === "List" && selected.kind !== "list")
    ) {
      problems.push(`Wrong component value shape: ${component.value}.`);
      continue;
    }
    const item = selected.kind === "list" ? selected.element : selected;
    if (item.kind === "record" && !component.fields?.length)
      problems.push(`Record fields required: ${component.value}.`);
    if (
      component.fields?.some(
        ({ field }) =>
          !isEmailCustomerScalar(emailCustomerFieldAtPath(item, field)) ||
          !source.fields?.some((selectedField) =>
            samePath(field, selectedField)
          )
      )
    )
      problems.push(`Unselected component field: ${component.value}.`);
  }
  return problems;
};

/** Saved once before payload construction. Top-level missing is a preparation outcome. */
export const EmailValueSnapshot = Schema.Union([
  Schema.TaggedStruct("Resolved", { value: Schema.Json }),
  Schema.TaggedStruct("Fallback", { text: Schema.String }),
]);
export type EmailValueSnapshot = typeof EmailValueSnapshot.Type;

function samePath(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    left.every((part, index) => part === right[index])
  );
}

function validScalarReference(
  definition: EmailValueDefinition | undefined,
  field: readonly string[] | undefined
): boolean {
  if (!definition) return false;
  if (definition.source.kind === "discount")
    return (
      field?.length === 1 && (field[0] === "code" || field[0] === "expiresAt")
    );
  const selected = emailCustomerFieldAtPath(
    emailCustomerFieldCatalogue,
    definition.source.path
  );
  if (!field) return isEmailCustomerScalar(selected);
  return (
    selected?.kind === "record" &&
    isEmailCustomerScalar(emailCustomerFieldAtPath(selected, field)) &&
    Boolean(
      definition.source.fields?.some((selectedField) =>
        samePath(field, selectedField)
      )
    )
  );
}

function componentTextKeys(
  structure: readonly EmailBodyComponent[]
): readonly string[] {
  return structure.flatMap((component) =>
    Match.value(component).pipe(
      Match.tagsExhaustive({
        Paragraph: ({ textKey }) => [textKey],
        Heading: ({ textKey }) => [textKey],
        Image: ({ altKey }) => [altKey],
        Button: ({ labelKey }) => [labelKey],
        Offer: ({ labelKey }) => [labelKey],
        Record: ({ fields }) => fields.map((field) => field.labelKey),
        List: ({ fields }) => fields?.map((field) => field.labelKey) ?? [],
      })
    )
  );
}

function translatedParts(
  structure: readonly EmailBodyComponent[],
  translation: EmailTranslation
): readonly EmailInlinePart[] {
  return [
    ...translation.subject,
    ...translation.preheader,
    ...(translation.operationalReason ?? []),
    ...componentTextKeys(structure).flatMap(
      (key) => translation.texts[key] ?? []
    ),
  ];
}
