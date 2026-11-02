import { Effect, Match, Schema, SchemaGetter } from "effect";
import { AdministrationCampaignPurpose } from "./campaign-locale-and-purpose";
import { AdministrationCampaignTemplateKey } from "./email-campaigns";
import {
  EmailCustomerField,
  EmailCustomerSelection,
  EmailCustomerSelectionInvalid,
  emailCustomerFieldAtPath,
  emailCustomerFieldCatalogue,
  inspectEmailCustomerSelection,
  isEmailCustomerScalar,
  selectedEmailCustomerShape,
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
const draftInline = Schema.Array(
  Schema.Union([
    Schema.TaggedStruct("Text", { text: Schema.optionalKey(Schema.String) }),
    Schema.TaggedStruct("Value", {
      name: Schema.optionalKey(Schema.String),
      field: Schema.optionalKey(Schema.Array(Schema.String)),
    }),
  ])
);

export const EmailDiscountSelection = Schema.Struct({
  kind: Schema.Literal("discount"),
  discountId: AdministrationStoredDiscountId,
  validDays: Schema.Int.check(Schema.isGreaterThan(0)),
  maxUses: Schema.Int.check(Schema.isGreaterThan(0)).pipe(
    Schema.withDecodingDefaultTypeKey(Effect.succeed(1))
  ),
  maxUsesPerCustomer: Schema.Int.check(Schema.isGreaterThan(0)).pipe(
    Schema.withDecodingDefaultTypeKey(Effect.succeed(1))
  ),
});
export type EmailDiscountSelection = typeof EmailDiscountSelection.Type;

/** Position in this array is generation order; unused definitions are not generated. */
export const EmailValueDefinition = Schema.Struct({
  name: EmailValueName,
  source: Schema.Union([EmailCustomerSelection, EmailDiscountSelection]),
  fallback: Schema.optionalKey(Schema.Record(key, Schema.String)),
  customerShape: Schema.optionalKey(EmailCustomerField),
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
    sort: Schema.optionalKey(
      Schema.Struct({
        path: Schema.Array(key),
        direction: Schema.Literals(["asc", "desc"]),
      })
    ),
    limit: Schema.optionalKey(Schema.Int.check(Schema.isGreaterThan(0))),
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

/** Partly configured controls remain serializable until explicit publication. */
const draftSource = Schema.Struct({
  kind: Schema.Literals(["customer", "discount"]),
  path: Schema.optionalKey(Schema.Array(Schema.String)),
  fields: Schema.optionalKey(Schema.Array(Schema.Array(Schema.String))),
  sort: Schema.optionalKey(
    Schema.Struct({
      path: Schema.optionalKey(Schema.Array(Schema.String)),
      direction: Schema.optionalKey(Schema.Literals(["asc", "desc"])),
    })
  ),
  limit: Schema.optionalKey(Schema.Int),
  discountId: Schema.optionalKey(Schema.String),
  validDays: Schema.optionalKey(Schema.Int),
  maxUses: Schema.optionalKey(Schema.Int),
  maxUsesPerCustomer: Schema.optionalKey(Schema.Int),
});
const draftComponent = Schema.Struct({
  _tag: Schema.Literals([
    "Paragraph",
    "Heading",
    "Image",
    "Button",
    "Record",
    "List",
    "Offer",
  ]),
  id: Schema.optionalKey(Schema.String),
  textKey: Schema.optionalKey(Schema.String),
  level: Schema.optionalKey(Schema.Literals([1, 2, 3])),
  src: Schema.optionalKey(Schema.String),
  altKey: Schema.optionalKey(Schema.String),
  href: Schema.optionalKey(Schema.String),
  labelKey: Schema.optionalKey(Schema.String),
  value: Schema.optionalKey(Schema.String),
  sort: Schema.optionalKey(
    Schema.Struct({
      path: Schema.optionalKey(Schema.Array(Schema.String)),
      direction: Schema.optionalKey(Schema.Literals(["asc", "desc"])),
    })
  ),
  limit: Schema.optionalKey(Schema.Int),
  fields: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        field: Schema.optionalKey(Schema.Array(Schema.String)),
        labelKey: Schema.optionalKey(Schema.String),
      })
    )
  ),
});
export const EmailDraft = Schema.Struct({
  purpose: Schema.optionalKey(AdministrationCampaignPurpose),
  templateKey: Schema.optionalKey(AdministrationCampaignTemplateKey),
  structure: Schema.optionalKey(Schema.Array(draftComponent)),
  translations: Schema.optionalKey(
    Schema.Record(
      key,
      Schema.Struct({
        subject: Schema.optionalKey(draftInline),
        preheader: Schema.optionalKey(draftInline),
        texts: Schema.optionalKey(Schema.Record(key, draftInline)),
        operationalReason: Schema.optionalKey(draftInline),
      })
    )
  ),
  values: Schema.optionalKey(
    Schema.Array(
      Schema.Struct({
        name: Schema.optionalKey(Schema.String),
        source: Schema.optionalKey(draftSource),
        customerShape: Schema.optionalKey(EmailCustomerField),
        fallback: Schema.optionalKey(Schema.Record(key, Schema.String)),
      })
    )
  ),
}).annotate({
  identifier: "EmailDraft",
  parseOptions: { onExcessProperty: "error" },
});
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
  EmailDocument.annotate({ parseOptions: { onExcessProperty: "error" } })
    .check(
      Schema.makeFilter(
        (document) =>
          emailPublicationProblems(document, currentLocales).length === 0,
        {
          description:
            "Every current language, nonempty subjects and body, unique names and component ids, valid localized text and typed value references are required.",
        }
      )
    )
    .pipe(
      Schema.decodeTo(Schema.toType(EmailDocument), {
        decode: SchemaGetter.transform((document) => ({
          ...document,
          values: document.values.map((definition) => {
            if (definition.source.kind !== "customer") return definition;
            const shape = selectedEmailCustomerShape(definition.source);
            return shape ? { ...definition, customerShape: shape } : definition;
          }),
        })),
        encode: SchemaGetter.transform((document) => document),
      })
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

type EmailValueDefinitions = ReadonlyMap<EmailValueName, EmailValueDefinition>;
type EmailValuedComponent = Extract<EmailBodyComponent, { value: unknown }>;
type EmailCustomerComponent = Exclude<EmailValuedComponent, { _tag: "Offer" }>;

/**
 * Every reason the document can't be published, in a stable order: document
 * identity, languages, value sources, each translation, then each valued
 * component.
 */
export const emailPublicationProblems = (
  document: EmailDocument,
  currentLocales: readonly string[]
): readonly string[] => {
  const definitions: EmailValueDefinitions = new Map(
    document.values.map((definition) => [definition.name, definition])
  );
  return [
    ...documentIdentityProblems(document, definitions),
    ...currentLocales
      .filter((locale) => !Object.hasOwn(document.translations, locale))
      .map((locale) => `Missing language: ${locale}.`),
    ...document.values
      .filter(invalidCustomerSelection)
      .map((definition) => `Invalid customer selection: ${definition.name}.`),
    ...Object.entries(document.translations).flatMap(([locale, translation]) =>
      translationProblems(document.structure, definitions, locale, translation)
    ),
    ...document.structure.flatMap((component) =>
      "value" in component
        ? valuedComponentProblems(component, definitions)
        : []
    ),
  ];
};

function documentIdentityProblems(
  document: EmailDocument,
  definitions: EmailValueDefinitions
): readonly string[] {
  const problems: string[] = [];
  if (definitions.size !== document.values.length)
    problems.push("Duplicate value names.");
  if (
    new Set(document.structure.map((component) => component.id)).size !==
    document.structure.length
  )
    problems.push("Duplicate component ids.");
  if (document.structure.length === 0) problems.push("Body is empty.");
  return problems;
}

function invalidCustomerSelection(definition: EmailValueDefinition): boolean {
  return (
    definition.source.kind === "customer" &&
    inspectEmailCustomerSelection(definition.source) instanceof
      EmailCustomerSelectionInvalid
  );
}

function translationProblems(
  structure: readonly EmailBodyComponent[],
  definitions: EmailValueDefinitions,
  locale: string,
  translation: EmailTranslation
): readonly string[] {
  const spokenTextKeys = componentTextKeys(
    structure.filter((component) => component._tag !== "Image")
  );
  return [
    ...(blankInline(translation.subject) ? [`Empty subject: ${locale}.`] : []),
    ...componentTextKeys(structure).flatMap((textKey) =>
      textKeyProblems(
        textKey,
        spokenTextKeys.includes(textKey),
        locale,
        translation
      )
    ),
    ...translatedParts(structure, translation).flatMap((part) =>
      part._tag === "Value" &&
      !validScalarReference(definitions.get(part.name), part.field)
        ? [`Invalid scalar value ${part.name}: ${locale}.`]
        : []
    ),
  ];
}

function blankInline(parts: readonly EmailInlinePart[]): boolean {
  return (
    !parts.length ||
    parts.every((part) => part._tag === "Text" && !part.text.trim())
  );
}

/** Decorative texts, such as an image's alt text, may be empty. */
function textKeyProblems(
  textKey: string,
  spoken: boolean,
  locale: string,
  translation: EmailTranslation
): readonly string[] {
  const problems: string[] = [];
  if (!Object.hasOwn(translation.texts, textKey))
    problems.push(`Missing text ${textKey}: ${locale}.`);
  if (
    spoken &&
    !(translation.texts[textKey] ?? []).some(
      (part) => part._tag === "Value" || part.text.trim().length > 0
    )
  )
    problems.push(`Empty text ${textKey}: ${locale}.`);
  return problems;
}

/** An Offer needs a discount; Records and Lists need a matching customer shape. */
function valuedComponentProblems(
  component: EmailValuedComponent,
  definitions: EmailValueDefinitions
): readonly string[] {
  const definition = definitions.get(component.value);
  if (!definition) return [`Unknown value: ${component.value}.`];
  if (component._tag === "Offer")
    return definition.source.kind === "discount"
      ? []
      : [`Offer requires a discount: ${component.value}.`];
  if (definition.source.kind !== "customer")
    return [`Structured component requires customer data: ${component.value}.`];
  return customerComponentProblems(component, definition.source);
}

function customerComponentProblems(
  component: EmailCustomerComponent,
  source: EmailCustomerSelection
): readonly string[] {
  const selected = emailCustomerFieldAtPath(
    emailCustomerFieldCatalogue,
    source.path
  );
  if (
    !selected ||
    selected.kind !== (component._tag === "Record" ? "record" : "list")
  )
    return [`Wrong component value shape: ${component.value}.`];
  const item = selected.kind === "list" ? selected.element : selected;
  return [
    ...(component._tag === "List"
      ? listBoundProblems(component, source, item)
      : []),
    ...componentFieldProblems(component, source, item),
  ];
}

function listBoundProblems(
  component: Extract<EmailBodyComponent, { _tag: "List" }>,
  source: EmailCustomerSelection,
  item: EmailCustomerField
): readonly string[] {
  const problems: string[] = [];
  if (component.sort && !selectedSortField(component.sort.path, source, item))
    problems.push(`Unselected list sort field: ${component.value}.`);
  if (
    component.limit !== undefined &&
    source.limit !== undefined &&
    component.limit > source.limit
  )
    problems.push(
      `List component limit exceeds selected source: ${component.value}.`
    );
  return problems;
}

/** A list sorts by a scalar, which a list of records must also select. */
function selectedSortField(
  path: readonly string[],
  source: EmailCustomerSelection,
  item: EmailCustomerField
): boolean {
  return (
    isEmailCustomerScalar(emailCustomerFieldAtPath(item, path)) &&
    (item.kind !== "record" || selectedSourceField(source, path))
  );
}

function componentFieldProblems(
  component: EmailCustomerComponent,
  source: EmailCustomerSelection,
  item: EmailCustomerField
): readonly string[] {
  const problems: string[] = [];
  if (item.kind === "record" && !component.fields?.length)
    problems.push(`Record fields required: ${component.value}.`);
  if (
    component.fields?.some(
      ({ field }) =>
        !isEmailCustomerScalar(emailCustomerFieldAtPath(item, field)) ||
        !selectedSourceField(source, field)
    )
  )
    problems.push(`Unselected component field: ${component.value}.`);
  return problems;
}

function selectedSourceField(
  source: EmailCustomerSelection,
  path: readonly string[]
): boolean {
  return Boolean(
    source.fields?.some((selectedField) => samePath(path, selectedField))
  );
}

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
    return validDiscountReference(field);
  return validCustomerReference(definition.source, field);
}

/** A discount exposes only its generated code and expiry. */
function validDiscountReference(field: readonly string[] | undefined): boolean {
  return (
    field?.length === 1 && (field[0] === "code" || field[0] === "expiresAt")
  );
}

/** A scalar selection, or a selected scalar field of a record selection. */
function validCustomerReference(
  source: EmailCustomerSelection,
  field: readonly string[] | undefined
): boolean {
  const selected = emailCustomerFieldAtPath(
    emailCustomerFieldCatalogue,
    source.path
  );
  if (!field) return isEmailCustomerScalar(selected);
  return (
    selected?.kind === "record" &&
    isEmailCustomerScalar(emailCustomerFieldAtPath(selected, field)) &&
    selectedSourceField(source, field)
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
