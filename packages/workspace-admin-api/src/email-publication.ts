import { Data, Option, Schema, SchemaGetter } from "effect";
import {
  type EmailCustomerField,
  type EmailCustomerSelectionInvalid,
  emailCustomerFieldAtPath,
  emailCustomerFieldCatalogue,
  inspectEmailCustomerSelection,
  isEmailCustomerScalar,
  selectedEmailCustomerShape,
} from "./email-customer-selection";
import type { EmailValueName } from "./email-identifiers";
import {
  EmailBodyComponent,
  EmailDocument,
  EmailDraft,
  EmailValueDefinition,
} from "./emails";

type DraftComponent = NonNullable<EmailDraft["structure"]>[number];
type DraftTranslation = NonNullable<EmailDraft["translations"]>[string];
type DraftInlinePart = NonNullable<DraftTranslation["subject"]>[number];
type DraftDefinition = NonNullable<EmailDraft["values"]>[number];
type DraftTextList = NonNullable<DraftComponent["items"]>;

/**
 * Where a problem sits. `locale` is absent for shared structure; `field`
 * names the translated field, or `component` for a component's own value.
 */
export type EmailContentLocation = {
  readonly locale?: string;
  readonly field:
    | "subject"
    | "preheader"
    | "operationalReason"
    | "text"
    | "component";
  readonly componentId?: string;
  readonly textKey?: string;
};

/**
 * Why a draft can't be published yet. Each problem names its place so the
 * editor can mark it; `englishEmailDocumentProblem` words it for the
 * administration API. Unused value definitions never produce a problem.
 */
export type EmailDocumentProblem = Data.TaggedEnum<{
  PurposeMissing: Record<never, never>;
  TemplateMissing: Record<never, never>;
  BodyEmpty: Record<never, never>;
  ComponentIdDuplicate: { readonly componentId: string };
  /** A required setting is unset or out of range, such as `href` or `items`. */
  ComponentIncomplete: {
    readonly index: number;
    readonly componentId?: string;
    readonly field: string;
  };
  /** A link, button, linked image or offer leads somewhere other than https: or mailto:. */
  DestinationInvalid: { readonly componentId: string; readonly field: string };
  ImageSourceInvalid: { readonly componentId: string };
  ValueNameDuplicate: { readonly name: string };
  ValueNameInvalid: { readonly index: number; readonly name: string };
  ValueIncomplete: {
    readonly index: number;
    readonly name: string;
    readonly field: string;
  };
  CustomerSelectionInvalid: {
    readonly name: string;
    readonly reason: EmailCustomerSelectionInvalid["reason"];
  };
  LanguageMissing: { readonly locale: string };
  SubjectEmpty: { readonly locale: string };
  TextMissing: {
    readonly locale: string;
    readonly componentId: string;
    readonly textKey: string;
  };
  TextEmpty: {
    readonly locale: string;
    readonly componentId: string;
    readonly textKey: string;
  };
  /** A reference names no definition, for example after its definition was removed. */
  ValueUnknown: { readonly name: string; readonly at: EmailContentLocation };
  ValueReferenceIncomplete: { readonly at: EmailContentLocation };
  /** A scalar reference to a record or list, or to a field the definition doesn't select. */
  ValueReferenceInvalid: {
    readonly name: string;
    readonly at: EmailContentLocation;
  };
  /** Bold, italic or a link in a text that renders plain, such as a subject. */
  FormattingNotAllowed: { readonly at: EmailContentLocation };
  LinkUnknown: { readonly link: string; readonly at: EmailContentLocation };
  ComponentValueMismatch: {
    readonly componentId: string;
    readonly name: string;
    readonly expected: "discount" | "customer" | "record" | "list";
  };
  ComponentFieldsRequired: {
    readonly componentId: string;
    readonly name: string;
  };
  ComponentFieldInvalid: {
    readonly componentId: string;
    readonly name: string;
  };
  ListSortInvalid: { readonly componentId: string; readonly name: string };
  ListLimitExceeded: { readonly componentId: string; readonly name: string };
  /** The draft fails the publication schema in a way no other problem names. */
  DocumentInvalid: Record<never, never>;
}>;
export const EmailDocumentProblem = Data.taggedEnum<EmailDocumentProblem>();

const where = (at: EmailContentLocation): string =>
  [
    at.field === "text" || at.field === "component"
      ? (at.componentId ?? at.field)
      : at.field,
    at.textKey && at.field === "text" ? `text ${at.textKey}` : undefined,
    at.locale,
  ]
    .filter(Boolean)
    .join(", ");

/** The problem in English, as the administration API and `dhw` report it. */
export const englishEmailDocumentProblem = (
  problem: EmailDocumentProblem
): string =>
  EmailDocumentProblem.$match(problem, {
    PurposeMissing: () => "Purpose is required.",
    TemplateMissing: () => "Template is required.",
    BodyEmpty: () => "Body is empty.",
    ComponentIdDuplicate: ({ componentId }) =>
      `Duplicate component id: ${componentId}.`,
    ComponentIncomplete: ({ index, componentId, field }) =>
      `Component ${componentId ?? `#${index + 1}`} needs ${field}.`,
    DestinationInvalid: ({ componentId, field }) =>
      `${componentId} ${field} must use an https: or mailto: URL.`,
    ImageSourceInvalid: ({ componentId }) =>
      `Image ${componentId} must use an https: URL.`,
    ValueNameDuplicate: ({ name }) => `Duplicate value name: ${name}.`,
    ValueNameInvalid: ({ name }) =>
      `Invalid value name: ${name || "(empty)"}. Use lowercase letters, digits and underscores, starting with a letter.`,
    ValueIncomplete: ({ name, field }) => `Value ${name} needs ${field}.`,
    CustomerSelectionInvalid: ({ name, reason }) =>
      `Invalid customer selection: ${name} (${reason}).`,
    LanguageMissing: ({ locale }) => `Missing language: ${locale}.`,
    SubjectEmpty: ({ locale }) => `Empty subject: ${locale}.`,
    TextMissing: ({ locale, textKey }) => `Missing text ${textKey}: ${locale}.`,
    TextEmpty: ({ locale, textKey }) => `Empty text ${textKey}: ${locale}.`,
    ValueUnknown: ({ name, at }) => `Unknown value ${name} (${where(at)}).`,
    ValueReferenceIncomplete: ({ at }) =>
      `A value reference needs a value (${where(at)}).`,
    ValueReferenceInvalid: ({ name, at }) =>
      `Invalid scalar value ${name} (${where(at)}).`,
    FormattingNotAllowed: ({ at }) =>
      `Formatting and links are not allowed here (${where(at)}).`,
    LinkUnknown: ({ link, at }) => `Unknown link ${link} (${where(at)}).`,
    ComponentValueMismatch: ({ componentId, name, expected }) =>
      `Component ${componentId} requires a ${expected} value: ${name}.`,
    ComponentFieldsRequired: ({ name }) => `Record fields required: ${name}.`,
    ComponentFieldInvalid: ({ name }) => `Unselected component field: ${name}.`,
    ListSortInvalid: ({ name }) => `Unselected list sort field: ${name}.`,
    ListLimitExceeded: ({ name }) =>
      `List component limit exceeds selected source: ${name}.`,
    DocumentInvalid: () => "The email doesn't match the publication schema.",
  });

/** A translated text a component renders: rich texts take formatting and links. */
export type EmailComponentText = {
  readonly textKey: string;
  readonly role: "rich" | "plain";
  /** Image descriptions may be empty; the key must still exist. */
  readonly decorative: boolean;
};

const rich = (textKey: string | undefined): EmailComponentText[] =>
  textKey ? [{ textKey, role: "rich", decorative: false }] : [];

const plain = (textKey: string | undefined): EmailComponentText[] =>
  textKey ? [{ textKey, role: "plain", decorative: false }] : [];

const listTexts = (items: DraftTextList | undefined): EmailComponentText[] =>
  (items ?? []).flatMap((item) => [
    ...rich(item.textKey),
    ...listTexts(item.list?.items),
  ]);

const fieldLabels = (component: DraftComponent): EmailComponentText[] =>
  (component.fields ?? []).flatMap((field) => plain(field.labelKey));

const componentTexts: Record<
  DraftComponent["_tag"],
  (component: DraftComponent) => EmailComponentText[]
> = {
  Paragraph: (component) => rich(component.textKey),
  Heading: (component) => rich(component.textKey),
  TextList: (component) => listTexts(component.items),
  Image: (component) =>
    component.altKey
      ? [{ textKey: component.altKey, role: "plain", decorative: true }]
      : [],
  Button: (component) => plain(component.labelKey),
  Offer: (component) => plain(component.labelKey),
  Record: fieldLabels,
  List: fieldLabels,
  Divider: () => [],
  Spacer: () => [],
};

/** The translated texts of one component, in render order. */
export const emailComponentTexts = (
  component: DraftComponent
): readonly EmailComponentText[] => componentTexts[component._tag](component);

const translatedParts = (
  structure: readonly DraftComponent[],
  translation: DraftTranslation
): readonly DraftInlinePart[] => [
  ...(translation.subject ?? []),
  ...(translation.preheader ?? []),
  ...(translation.operationalReason ?? []),
  ...structure.flatMap((component) =>
    emailComponentTexts(component).flatMap(
      ({ textKey }) => translation.texts?.[textKey] ?? []
    )
  ),
];

/**
 * Value names the draft references in its structure or in any language's
 * texts. Only referenced definitions are generated; the rest are unused.
 */
export const referencedEmailValueNames = (
  draft: EmailDraft
): ReadonlySet<string> => {
  const structure = draft.structure ?? [];
  const names = new Set<string>();
  for (const component of structure)
    if (component.value) names.add(component.value);
  for (const translation of Object.values(draft.translations ?? {}))
    for (const part of translatedParts(structure, translation))
      if (part._tag === "Value" && part.name) names.add(part.name);
  return names;
};

/** Stable ordered required set, frozen alongside the selected version before generation. */
export const requiredEmailValueNames = (
  document: EmailDocument
): readonly EmailValueName[] => {
  const referenced = referencedEmailValueNames(document);
  return document.values
    .filter((definition) => referenced.has(definition.name))
    .map((definition) => definition.name);
};

// Like publication, settings of another component or source kind are dropped.
const decodeDefinition = Schema.decodeUnknownOption(EmailValueDefinition);
const decodeComponent = Schema.decodeUnknownOption(EmailBodyComponent);

/** A definition publication keeps as configured: complete, with a valid selection. */
const publishableDefinition = (
  definition: DraftDefinition
): Option.Option<EmailValueDefinition> =>
  decodeDefinition(definition).pipe(
    Option.filter(
      (decoded) =>
        decoded.source.kind !== "customer" ||
        !isSelectionInvalid(inspectEmailCustomerSelection(decoded.source))
    )
  );

const isSelectionInvalid = (
  result: ReturnType<typeof inspectEmailCustomerSelection>
): result is EmailCustomerSelectionInvalid => "reason" in result;

/**
 * The draft as publication reads it. Drops definitions nothing references
 * that publication couldn't keep, so an unfinished unused value never blocks
 * publishing; referenced definitions and complete unused ones stay in their
 * configured order. An unset preheader or text map reads as empty.
 */
const publicationCandidate = (draft: EmailDraft): EmailDraft => {
  const referenced = referencedEmailValueNames(draft);
  return {
    ...draft,
    ...(draft.translations && {
      translations: Object.fromEntries(
        Object.entries(draft.translations).map(([locale, translation]) => [
          locale,
          {
            ...translation,
            subject: translation.subject ?? [],
            preheader: translation.preheader ?? [],
            texts: translation.texts ?? {},
          },
        ])
      ),
    }),
    ...(draft.values && {
      values: retainedDefinitions(draft.values, referenced),
    }),
  };
};

/**
 * The definitions publication keeps, in configured order, with their
 * positions: every referenced one, and each complete unused one whose name no
 * earlier kept definition has. Unused definitions never block: unfinished or
 * repeated ones drop.
 */
const keptDefinitions = (
  definitions: readonly DraftDefinition[],
  referenced: ReadonlySet<string>
): readonly KeptDefinition[] => {
  const names = new Set<string>();
  return definitions.flatMap((definition, index) => {
    const name = definition.name ?? "";
    const publishable = publishableDefinition(definition);
    const repeated = names.has(name);
    if (!referenced.has(name) && (Option.isNone(publishable) || repeated))
      return [];
    names.add(name);
    return [{ index, name, definition, publishable, repeated }];
  });
};

type KeptDefinition = {
  readonly index: number;
  readonly name: string;
  readonly definition: DraftDefinition;
  readonly publishable: Option.Option<EmailValueDefinition>;
  /** An earlier kept definition has the same name. */
  readonly repeated: boolean;
};

const retainedDefinitions = (
  definitions: readonly DraftDefinition[],
  referenced: ReadonlySet<string>
): DraftDefinition[] =>
  keptDefinitions(definitions, referenced).map(({ definition }) => definition);

const valueNamePattern = /^[a-z][a-z0-9_]{0,63}$/;

const P = EmailDocumentProblem;

const samePath = (left: readonly string[], right: readonly string[]): boolean =>
  left.length === right.length &&
  left.every((part, index) => part === right[index]);

const isDestination = (href: string): boolean => {
  const protocol = URL.parse(href)?.protocol;
  return protocol === "https:" || protocol === "mailto:";
};

const isBlank = (parts: readonly DraftInlinePart[]): boolean =>
  parts.every((part) => part._tag === "Text" && !part.text?.trim());

const hasFormatting = (part: DraftInlinePart): boolean =>
  Boolean(part.bold || part.italic || part.link !== undefined);

type CustomerSource = Extract<
  EmailValueDefinition["source"],
  { readonly kind: "customer" }
>;

function selectedSourceField(
  source: CustomerSource,
  path: readonly string[]
): boolean {
  return Boolean(
    source.fields?.some((selectedField) => samePath(path, selectedField))
  );
}

function validScalarReference(
  definition: EmailValueDefinition,
  field: readonly string[] | undefined
): boolean {
  return definition.source.kind === "discount"
    ? validDiscountReference(field)
    : validCustomerReference(definition.source, field);
}

/** A discount exposes only its generated code and expiry. */
function validDiscountReference(field: readonly string[] | undefined): boolean {
  return (
    field?.length === 1 && (field[0] === "code" || field[0] === "expiresAt")
  );
}

/** A scalar selection, or a selected scalar field of a record selection. */
function validCustomerReference(
  source: CustomerSource,
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

const missing = (field: string, present: boolean): string[] =>
  present ? [] : [field];

const isCompleteSort = (
  sort: { readonly path?: unknown; readonly direction?: unknown } | undefined
): boolean =>
  !sort || (sort.path !== undefined && sort.direction !== undefined);

function hasListItems(items: DraftTextList | undefined): boolean {
  return Boolean(items?.length) && (items ?? []).every(isCompleteListItem);
}

function isCompleteListItem(item: DraftTextList[number]): boolean {
  return (
    Boolean(item.textKey) &&
    (!item.list ||
      (item.list.ordered !== undefined && hasListItems(item.list.items)))
  );
}

const hasLabelledFields = (fields: DraftComponent["fields"]): boolean =>
  (fields ?? []).every(
    (field) => Boolean(field.field?.length) && Boolean(field.labelKey)
  );

/** The settings each component kind needs before it can publish. */
const componentRequirements: Record<
  DraftComponent["_tag"],
  (component: DraftComponent) => string[]
> = {
  Paragraph: (component) => missing("textKey", Boolean(component.textKey)),
  Heading: (component) => [
    ...missing("textKey", Boolean(component.textKey)),
    ...missing("level", component.level !== undefined),
  ],
  TextList: (component) => [
    ...missing("ordered", component.ordered !== undefined),
    ...missing("items", hasListItems(component.items)),
  ],
  Image: (component) => [
    ...missing("src", Boolean(component.src)),
    ...missing("altKey", Boolean(component.altKey)),
  ],
  Button: (component) => [
    ...missing("labelKey", Boolean(component.labelKey)),
    ...missing("href", Boolean(component.href)),
  ],
  Offer: (component) => [
    ...missing("value", Boolean(component.value)),
    ...missing("labelKey", Boolean(component.labelKey)),
    ...missing("href", Boolean(component.href)),
  ],
  Record: (component) => [
    ...missing("value", Boolean(component.value)),
    ...missing(
      "fields",
      Boolean(component.fields?.length) && hasLabelledFields(component.fields)
    ),
  ],
  List: (component) => [
    ...missing("value", Boolean(component.value)),
    ...missing("fields", hasLabelledFields(component.fields)),
    ...missing("sort", isCompleteSort(component.sort)),
  ],
  Divider: () => [],
  Spacer: () => [],
};

type DraftSource = NonNullable<DraftDefinition["source"]>;

const isPositiveOrUnset = (count: number | undefined): boolean =>
  count === undefined || count > 0;

const definitionRequirements = (definition: DraftDefinition): string[] => {
  const source = definition.source;
  if (!source) return ["source"];
  return source.kind === "customer"
    ? customerSourceRequirements(source)
    : discountSourceRequirements(source);
};

const customerSourceRequirements = (source: DraftSource): string[] => [
  ...missing("path", Boolean(source.path?.length)),
  ...missing("sort", isCompleteSort(source.sort)),
];

const discountSourceRequirements = (source: DraftSource): string[] => [
  ...missing("discountId", Boolean(source.discountId)),
  ...missing(
    "validDays",
    source.validDays !== undefined && source.validDays > 0
  ),
  ...missing("maxUses", isPositiveOrUnset(source.maxUses)),
  ...missing(
    "maxUsesPerCustomer",
    isPositiveOrUnset(source.maxUsesPerCustomer)
  ),
];

/** The value definitions content may use: kept names, and the configured ones among them. */
type ValueScope = {
  readonly kept: ReadonlySet<string>;
  readonly definitions: ReadonlyMap<string, EmailValueDefinition>;
};

/**
 * Every problem that keeps `draft` from publication with the current
 * `currentLocales`, each with its place. Saving a draft never needs zero
 * problems; publication does. Definitions nothing references are never
 * checked: they don't block and publication drops unfinished ones.
 */
export const emailDraftProblems = (
  draft: EmailDraft,
  currentLocales: readonly string[]
): readonly EmailDocumentProblem[] => {
  const problems = draftContentProblems(draft, currentLocales);
  if (problems.length > 0) return problems;
  return Option.isSome(
    Schema.decodeUnknownOption(EmailDocument)(publicationCandidate(draft))
  )
    ? []
    : [EmailDocumentProblem.DocumentInvalid()];
};

/**
 * Problems in a stable order: document identity, value definitions, each
 * component, languages, then each translation.
 */
function draftContentProblems(
  draft: EmailDraft,
  currentLocales: readonly string[]
): EmailDocumentProblem[] {
  const structure = draft.structure ?? [];
  const repeatedIds = repeatedComponentIds(structure);
  const duplicateIds = new Set(repeatedIds);
  const kept = keptDefinitions(
    draft.values ?? [],
    referencedEmailValueNames(draft)
  );
  const values = valueScope(kept);
  const translations = draft.translations ?? {};
  return [
    ...documentProblems(draft, repeatedIds),
    ...kept.flatMap(keptDefinitionProblems),
    ...structure.flatMap((component, index) =>
      componentProblems(component, index, duplicateIds, values)
    ),
    ...currentLocales
      .filter((locale) => !Object.hasOwn(translations, locale))
      .map((locale) => P.LanguageMissing({ locale })),
    ...Object.entries(translations).flatMap(([locale, translation]) =>
      translationProblems(structure, { locale, translation, values })
    ),
  ];
}

/** Each component id at every occurrence after its first. */
const repeatedComponentIds = (
  structure: readonly DraftComponent[]
): readonly string[] => {
  const seen = new Set<string>();
  return structure.flatMap(({ id }) => {
    if (!id) return [];
    const repeated = seen.has(id);
    seen.add(id);
    return repeated ? [id] : [];
  });
};

const documentProblems = (
  draft: EmailDraft,
  repeatedIds: readonly string[]
): EmailDocumentProblem[] => [
  ...(draft.purpose ? [] : [P.PurposeMissing()]),
  ...(draft.templateKey ? [] : [P.TemplateMissing()]),
  ...(draft.structure?.length ? [] : [P.BodyEmpty()]),
  ...repeatedIds.map((componentId) => P.ComponentIdDuplicate({ componentId })),
];

/** The first configured definition of each kept name is the one content uses. */
const valueScope = (kept: readonly KeptDefinition[]): ValueScope => {
  const definitions = new Map<string, EmailValueDefinition>();
  for (const { name, publishable } of kept)
    if (Option.isSome(publishable) && !definitions.has(name))
      definitions.set(name, publishable.value);
  return { kept: new Set(kept.map(({ name }) => name)), definitions };
};

const keptDefinitionProblems = ({
  index,
  name,
  definition,
  publishable,
  repeated,
}: KeptDefinition): EmailDocumentProblem[] => [
  ...(repeated ? [P.ValueNameDuplicate({ name })] : []),
  ...definitionProblems(index, name, definition, publishable),
];

function definitionProblems(
  index: number,
  name: string,
  definition: DraftDefinition,
  publishable: Option.Option<EmailValueDefinition>
): EmailDocumentProblem[] {
  if (!valueNamePattern.test(name))
    return [P.ValueNameInvalid({ index, name })];
  const absent = definitionRequirements(definition);
  if (absent.length > 0)
    return absent.map((field) => P.ValueIncomplete({ index, name, field }));
  if (Option.isSome(publishable)) return [];
  const reason = invalidSelectionReason({ ...definition, name });
  return [
    reason
      ? P.CustomerSelectionInvalid({ name, reason })
      : P.ValueIncomplete({ index, name, field: "source" }),
  ];
}

/** Why a complete customer definition's selection can't resolve, if it can't. */
const invalidSelectionReason = (definition: DraftDefinition) =>
  decodeDefinition(definition).pipe(
    Option.flatMap(({ source }) =>
      source.kind === "customer"
        ? Option.some(inspectEmailCustomerSelection(source))
        : Option.none()
    ),
    Option.filter(isSelectionInvalid),
    Option.map(({ reason }) => reason),
    Option.getOrUndefined
  );

function componentProblems(
  component: DraftComponent,
  index: number,
  duplicateIds: ReadonlySet<string>,
  values: ValueScope
): EmailDocumentProblem[] {
  const componentId = component.id;
  if (!componentId) return [P.ComponentIncomplete({ index, field: "id" })];
  const absent = componentRequirements[component._tag](component);
  const destinations = destinationProblems(component, componentId);
  // Unreadable settings are reported only when nothing more specific names the component.
  const unreadable =
    absent.length === 0 &&
    destinations.length === 0 &&
    !duplicateIds.has(componentId) &&
    Option.isNone(decodeComponent(component));
  return [
    ...absent.map((field) =>
      P.ComponentIncomplete({ index, componentId, field })
    ),
    ...destinations,
    ...(unreadable
      ? [P.ComponentIncomplete({ index, componentId, field: "settings" })]
      : []),
    ...(component.value
      ? valuedComponentProblems(component, {
          index,
          componentId,
          name: component.value,
          values,
        })
      : []),
  ];
}

const destinationProblems = (
  component: DraftComponent,
  componentId: string
): EmailDocumentProblem[] => [
  ...(component.href && !isDestination(component.href)
    ? [P.DestinationInvalid({ componentId, field: "href" })]
    : []),
  ...Object.entries(component.links ?? {})
    .filter(([, href]) => !isDestination(href))
    .map(([link]) =>
      P.DestinationInvalid({ componentId, field: `links.${link}` })
    ),
  ...imageSourceProblems(component, componentId),
];

const imageSourceProblems = (
  component: DraftComponent,
  componentId: string
): EmailDocumentProblem[] =>
  component._tag === "Image" &&
  component.src &&
  URL.parse(component.src)?.protocol !== "https:"
    ? [P.ImageSourceInvalid({ componentId })]
    : [];

/** A component that shows a value, and the value it names. */
type ValuedComponent = {
  readonly index: number;
  readonly componentId: string;
  readonly name: string;
  readonly values: ValueScope;
};

/** An Offer needs a discount; Records and Lists need a matching customer shape. */
function valuedComponentProblems(
  component: DraftComponent,
  valued: ValuedComponent
): EmailDocumentProblem[] {
  const { componentId, name, values } = valued;
  if (!values.kept.has(name))
    return [P.ValueUnknown({ name, at: { field: "component", componentId } })];
  const definition = values.definitions.get(name);
  if (!definition) return [];
  if (component._tag === "Offer")
    return definition.source.kind === "discount"
      ? []
      : [P.ComponentValueMismatch({ componentId, name, expected: "discount" })];
  if (definition.source.kind !== "customer")
    return [
      P.ComponentValueMismatch({ componentId, name, expected: "customer" }),
    ];
  return customerComponentProblems(component, valued, definition.source);
}

/** The customer shape a Record or List shows; other components check none. */
const componentShapes: Partial<
  Record<DraftComponent["_tag"], "record" | "list">
> = { Record: "record", List: "list" };

function customerComponentProblems(
  component: DraftComponent,
  valued: ValuedComponent,
  source: CustomerSource
): EmailDocumentProblem[] {
  const { componentId, name } = valued;
  const selected = emailCustomerFieldAtPath(
    emailCustomerFieldCatalogue,
    source.path
  );
  const expected = componentShapes[component._tag];
  if (expected && selected?.kind !== expected)
    return [P.ComponentValueMismatch({ componentId, name, expected })];
  if (!selected) return [];
  const item = selected.kind === "list" ? selected.element : selected;
  return [
    ...(component._tag === "List"
      ? listBoundProblems(component, valued, source, item)
      : []),
    ...componentFieldProblems(component, valued, source, item),
  ];
}

function listBoundProblems(
  component: DraftComponent,
  { index, componentId, name }: ValuedComponent,
  source: CustomerSource,
  item: EmailCustomerField
): EmailDocumentProblem[] {
  const sort = component.sort?.path;
  const limit = component.limit;
  return [
    ...(sort !== undefined && !selectedSortField(sort, source, item)
      ? [P.ListSortInvalid({ componentId, name })]
      : []),
    ...(exceedsSourceLimit(limit, source)
      ? [P.ListLimitExceeded({ componentId, name })]
      : []),
    ...(limit !== undefined && limit <= 0
      ? [P.ComponentIncomplete({ index, componentId, field: "limit" })]
      : []),
  ];
}

const exceedsSourceLimit = (
  limit: number | undefined,
  source: CustomerSource
): boolean =>
  limit !== undefined && source.limit !== undefined && limit > source.limit;

/** A list sorts by a scalar, which a list of records must also select. */
const selectedSortField = (
  path: readonly string[],
  source: CustomerSource,
  item: EmailCustomerField
): boolean =>
  isEmailCustomerScalar(emailCustomerFieldAtPath(item, path)) &&
  (item.kind !== "record" || selectedSourceField(source, path));

function componentFieldProblems(
  component: DraftComponent,
  { componentId, name }: ValuedComponent,
  source: CustomerSource,
  item: EmailCustomerField
): EmailDocumentProblem[] {
  const fields = (component.fields ?? []).flatMap(({ field }) =>
    field?.length ? [field] : []
  );
  return [
    ...(item.kind === "record" && fields.length === 0
      ? [P.ComponentFieldsRequired({ componentId, name })]
      : []),
    ...(fields.some(
      (field) =>
        !isEmailCustomerScalar(emailCustomerFieldAtPath(item, field)) ||
        !selectedSourceField(source, field)
    )
      ? [P.ComponentFieldInvalid({ componentId, name })]
      : []),
  ];
}

/** One language of the draft, checked against the value definitions it may use. */
type TranslationScope = {
  readonly locale: string;
  readonly translation: DraftTranslation;
  readonly values: ValueScope;
};

/** Whether a text takes formatting, and the link keys it may name. */
type TextRules = {
  readonly rich: boolean;
  readonly links: Readonly<Record<string, string>>;
};

const plainText: TextRules = { rich: false, links: {} };

function translationProblems(
  structure: readonly DraftComponent[],
  scope: TranslationScope
): EmailDocumentProblem[] {
  const { locale, translation } = scope;
  const subject = translation.subject ?? [];
  return [
    ...(isBlank(subject) ? [P.SubjectEmpty({ locale })] : []),
    ...partsProblems(subject, { locale, field: "subject" }, plainText, scope),
    ...partsProblems(
      translation.preheader ?? [],
      { locale, field: "preheader" },
      plainText,
      scope
    ),
    ...partsProblems(
      translation.operationalReason ?? [],
      { locale, field: "operationalReason" },
      plainText,
      scope
    ),
    ...structure.flatMap((component) =>
      componentTextProblems(component, scope)
    ),
  ];
}

function componentTextProblems(
  component: DraftComponent,
  scope: TranslationScope
): EmailDocumentProblem[] {
  const componentId = component.id;
  if (!componentId) return [];
  const links = component.links ?? {};
  return emailComponentTexts(component).flatMap((text) => {
    const { locale } = scope;
    const { textKey } = text;
    const place = { locale, componentId, textKey };
    const parts = scope.translation.texts?.[text.textKey];
    if (!parts) return [P.TextMissing(place)];
    return [
      ...(!text.decorative && isBlank(parts) ? [P.TextEmpty(place)] : []),
      ...partsProblems(
        parts,
        { locale, field: "text", componentId, textKey },
        { rich: text.role === "rich", links },
        scope
      ),
    ];
  });
}

const partsProblems = (
  parts: readonly DraftInlinePart[],
  at: EmailContentLocation,
  rules: TextRules,
  { values }: TranslationScope
): EmailDocumentProblem[] =>
  parts.flatMap((part) => [
    ...markProblems(part, at, rules),
    ...(part._tag === "Value" ? valueReferenceProblems(part, at, values) : []),
  ]);

/** Plain texts take no marks; a link must name one of its component's destinations. */
function markProblems(
  part: DraftInlinePart,
  at: EmailContentLocation,
  rules: TextRules
): EmailDocumentProblem[] {
  if (!rules.rich && hasFormatting(part))
    return [P.FormattingNotAllowed({ at })];
  if (part.link !== undefined && !Object.hasOwn(rules.links, part.link))
    return [P.LinkUnknown({ link: part.link, at })];
  return [];
}

function valueReferenceProblems(
  part: Extract<DraftInlinePart, { readonly _tag: "Value" }>,
  at: EmailContentLocation,
  values: ValueScope
): EmailDocumentProblem[] {
  const name = part.name;
  if (!name) return [P.ValueReferenceIncomplete({ at })];
  if (!values.kept.has(name)) return [P.ValueUnknown({ name, at })];
  const definition = values.definitions.get(name);
  const invalid =
    isMalformedField(part.field) ||
    (definition !== undefined && !validScalarReference(definition, part.field));
  return invalid ? [P.ValueReferenceInvalid({ name, at })] : [];
}

/** A given field path that is empty or has an empty segment. */
const isMalformedField = (field: readonly string[] | undefined): boolean =>
  field !== undefined &&
  (field.length === 0 || field.some((segment) => !segment));

/** English descriptions of every problem that blocks publishing `document`. */
export const emailPublicationProblems = (
  document: EmailDocument,
  currentLocales: readonly string[]
): readonly string[] =>
  emailDraftProblems(document, currentLocales).map(englishEmailDocumentProblem);

/**
 * Decodes a stored draft into the version publication creates. Call with the
 * application's current locale registry at every explicit publication.
 * Unused unfinished definitions are dropped first; every remaining problem
 * from `emailDraftProblems` blocks.
 */
export const emailDocumentForPublication = (
  currentLocales: readonly string[]
) =>
  EmailDraft.pipe(
    Schema.decodeTo(EmailDocument, {
      // The strict document schema validates the pruned draft's shape next.
      decode: SchemaGetter.transform(
        (draft) =>
          publicationCandidate(draft) as unknown as typeof EmailDocument.Encoded
      ),
      encode: SchemaGetter.transform(
        (document) => document as unknown as EmailDraft
      ),
    })
  )
    .check(
      Schema.makeFilter(
        (document) => emailDraftProblems(document, currentLocales).length === 0,
        {
          description:
            "Every current language, nonempty subjects and body, unique names and component ids, valid localized text, destinations and typed value references are required.",
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
            const selected = emailCustomerFieldAtPath(
              emailCustomerFieldCatalogue,
              definition.source.path,
              { inheritPresence: false }
            );
            const sortShape =
              definition.source.sort && selected?.kind === "list"
                ? emailCustomerFieldAtPath(
                    selected.element,
                    definition.source.sort.path
                  )
                : undefined;
            return shape
              ? {
                  ...definition,
                  customerShape: shape,
                  ...(sortShape ? { customerSortShape: sortShape } : {}),
                }
              : definition;
          }),
        })),
        encode: SchemaGetter.transform((document) => document),
      })
    );
