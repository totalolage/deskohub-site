import { Data, Option, Schema, SchemaGetter } from "effect";
import {
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

const listTexts = (items: DraftTextList | undefined): EmailComponentText[] =>
  (items ?? []).flatMap((item) => [
    ...(item.textKey
      ? [{ textKey: item.textKey, role: "rich" as const, decorative: false }]
      : []),
    ...listTexts(item.list?.items),
  ]);

const plain = (textKey: string | undefined): EmailComponentText[] =>
  textKey ? [{ textKey, role: "plain", decorative: false }] : [];

/** The translated texts of one component, in render order. */
export const emailComponentTexts = (
  component: DraftComponent
): readonly EmailComponentText[] => {
  switch (component._tag) {
    case "Paragraph":
    case "Heading":
      return component.textKey
        ? [{ textKey: component.textKey, role: "rich", decorative: false }]
        : [];
    case "TextList":
      return listTexts(component.items);
    case "Image":
      return component.altKey
        ? [{ textKey: component.altKey, role: "plain", decorative: true }]
        : [];
    case "Button":
    case "Offer":
      return plain(component.labelKey);
    case "Record":
    case "List":
      return (component.fields ?? []).flatMap((field) => plain(field.labelKey));
    case "Divider":
    case "Spacer":
      return [];
  }
};

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
 * The definitions publication keeps, in configured order: every referenced
 * one, and each complete unused one whose name no earlier kept definition
 * has. Unused definitions never block: unfinished or repeated ones drop.
 */
const retainedDefinitions = (
  definitions: readonly DraftDefinition[],
  referenced: ReadonlySet<string>
): DraftDefinition[] => {
  const names = new Set<string>();
  return definitions.filter((definition) => {
    const name = definition.name;
    const used = name !== undefined && referenced.has(name);
    const keep =
      used ||
      (Option.isSome(publishableDefinition(definition)) &&
        !names.has(name ?? ""));
    if (keep) names.add(name ?? "");
    return keep;
  });
};

const valueNamePattern = /^[a-z][a-z0-9_]{0,63}$/;

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

function validScalarReference(
  definition: EmailValueDefinition,
  field: readonly string[] | undefined
): boolean {
  if (definition.source.kind === "discount")
    return (
      field?.length === 1 && (field[0] === "code" || field[0] === "expiresAt")
    );
  const source = definition.source;
  const selected = emailCustomerFieldAtPath(
    emailCustomerFieldCatalogue,
    source.path
  );
  if (!field) return isEmailCustomerScalar(selected);
  return (
    selected?.kind === "record" &&
    isEmailCustomerScalar(emailCustomerFieldAtPath(selected, field)) &&
    Boolean(
      source.fields?.some((selectedField) => samePath(field, selectedField))
    )
  );
}

const componentRequirements = (component: DraftComponent): string[] => {
  const missing = (field: string, present: boolean) => (present ? [] : [field]);
  const hasItems = (items: DraftTextList | undefined): boolean =>
    Boolean(items?.length) &&
    (items ?? []).every(
      (item) =>
        Boolean(item.textKey) &&
        (!item.list ||
          (item.list.ordered !== undefined && hasItems(item.list.items)))
    );
  switch (component._tag) {
    case "Paragraph":
      return missing("textKey", Boolean(component.textKey));
    case "Heading":
      return [
        ...missing("textKey", Boolean(component.textKey)),
        ...missing("level", component.level !== undefined),
      ];
    case "TextList":
      return [
        ...missing("ordered", component.ordered !== undefined),
        ...missing("items", hasItems(component.items)),
      ];
    case "Image":
      return [
        ...missing("src", Boolean(component.src)),
        ...missing("altKey", Boolean(component.altKey)),
      ];
    case "Button":
      return [
        ...missing("labelKey", Boolean(component.labelKey)),
        ...missing("href", Boolean(component.href)),
      ];
    case "Offer":
      return [
        ...missing("value", Boolean(component.value)),
        ...missing("labelKey", Boolean(component.labelKey)),
        ...missing("href", Boolean(component.href)),
      ];
    case "Record":
      return [
        ...missing("value", Boolean(component.value)),
        ...missing(
          "fields",
          Boolean(component.fields?.length) &&
            (component.fields ?? []).every(
              (field) => Boolean(field.field?.length) && Boolean(field.labelKey)
            )
        ),
      ];
    case "List":
      return [
        ...missing("value", Boolean(component.value)),
        ...missing(
          "fields",
          (component.fields ?? []).every(
            (field) => Boolean(field.field?.length) && Boolean(field.labelKey)
          )
        ),
        ...missing(
          "sort",
          !component.sort ||
            (component.sort.path !== undefined &&
              component.sort.direction !== undefined)
        ),
      ];
    case "Divider":
    case "Spacer":
      return [];
  }
};

const definitionRequirements = (definition: DraftDefinition): string[] => {
  const source = definition.source;
  if (!source) return ["source"];
  if (source.kind === "customer")
    return [
      ...(source.path?.length ? [] : ["path"]),
      ...(source.sort &&
      (source.sort.path === undefined || source.sort.direction === undefined)
        ? ["sort"]
        : []),
    ];
  return [
    ...(source.discountId ? [] : ["discountId"]),
    ...(source.validDays !== undefined && source.validDays > 0
      ? []
      : ["validDays"]),
    ...(source.maxUses === undefined || source.maxUses > 0 ? [] : ["maxUses"]),
    ...(source.maxUsesPerCustomer === undefined || source.maxUsesPerCustomer > 0
      ? []
      : ["maxUsesPerCustomer"]),
  ];
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

function draftContentProblems(
  draft: EmailDraft,
  currentLocales: readonly string[]
): EmailDocumentProblem[] {
  const P = EmailDocumentProblem;
  const problems: EmailDocumentProblem[] = [];
  const structure = draft.structure ?? [];
  const referenced = referencedEmailValueNames(draft);

  if (!draft.purpose) problems.push(P.PurposeMissing());
  if (!draft.templateKey) problems.push(P.TemplateMissing());
  if (structure.length === 0) problems.push(P.BodyEmpty());

  const ids = new Set<string>();
  for (const component of structure) {
    if (!component.id) continue;
    if (ids.has(component.id))
      problems.push(P.ComponentIdDuplicate({ componentId: component.id }));
    ids.add(component.id);
  }

  // Definitions publication keeps: referenced ones (checked) and complete unused ones.
  const definitions = new Map<string, EmailValueDefinition>();
  const kept = new Set<string>();
  for (const [index, definition] of (draft.values ?? []).entries()) {
    const name = definition.name ?? "";
    const used = referenced.has(name);
    const publishable = publishableDefinition(definition);
    if (!used && (Option.isNone(publishable) || kept.has(name))) continue;
    if (kept.has(name)) problems.push(P.ValueNameDuplicate({ name }));
    kept.add(name);
    if (Option.isSome(publishable) && !definitions.has(name))
      definitions.set(name, publishable.value);
    if (!valueNamePattern.test(name)) {
      problems.push(P.ValueNameInvalid({ index, name }));
      continue;
    }
    const missing = definitionRequirements(definition);
    for (const field of missing)
      problems.push(P.ValueIncomplete({ index, name, field }));
    if (missing.length > 0 || Option.isSome(publishable)) continue;
    const source = definition.source;
    const decoded = decodeDefinition({ ...definition, name });
    if (source?.kind === "customer" && Option.isSome(decoded)) {
      const inspected =
        decoded.value.source.kind === "customer" &&
        inspectEmailCustomerSelection(decoded.value.source);
      if (inspected && isSelectionInvalid(inspected)) {
        problems.push(
          P.CustomerSelectionInvalid({ name, reason: inspected.reason })
        );
        continue;
      }
    }
    problems.push(P.ValueIncomplete({ index, name, field: "source" }));
  }

  for (const [index, component] of structure.entries()) {
    const componentId = component.id;
    if (!componentId) {
      problems.push(P.ComponentIncomplete({ index, field: "id" }));
      continue;
    }
    const missing = componentRequirements(component);
    for (const field of missing)
      problems.push(P.ComponentIncomplete({ index, componentId, field }));
    for (const href of component.href === undefined ? [] : [component.href])
      if (href && !isDestination(href))
        problems.push(P.DestinationInvalid({ componentId, field: "href" }));
    for (const [link, href] of Object.entries(component.links ?? {}))
      if (!isDestination(href))
        problems.push(
          P.DestinationInvalid({ componentId, field: `links.${link}` })
        );
    if (
      component._tag === "Image" &&
      component.src &&
      URL.parse(component.src)?.protocol !== "https:"
    )
      problems.push(P.ImageSourceInvalid({ componentId }));
    if (
      missing.length === 0 &&
      problems.every(
        (problem) =>
          !("componentId" in problem) || problem.componentId !== componentId
      ) &&
      Option.isNone(decodeComponent(component))
    )
      problems.push(
        P.ComponentIncomplete({ index, componentId, field: "settings" })
      );
    if (component.value) problems.push(...valueComponentProblems(component));
  }

  function valueComponentProblems(
    component: DraftComponent
  ): EmailDocumentProblem[] {
    const componentId = component.id ?? "";
    const name = component.value ?? "";
    const at: EmailContentLocation = { field: "component", componentId };
    if (!kept.has(name)) return [P.ValueUnknown({ name, at })];
    const definition = definitions.get(name);
    if (!definition) return [];
    if (component._tag === "Offer")
      return definition.source.kind === "discount"
        ? []
        : [
            P.ComponentValueMismatch({
              componentId,
              name,
              expected: "discount",
            }),
          ];
    if (definition.source.kind !== "customer")
      return [
        P.ComponentValueMismatch({ componentId, name, expected: "customer" }),
      ];
    const source = definition.source;
    const selected = emailCustomerFieldAtPath(
      emailCustomerFieldCatalogue,
      source.path
    );
    if (component._tag === "Record" && selected?.kind !== "record")
      return [
        P.ComponentValueMismatch({ componentId, name, expected: "record" }),
      ];
    if (component._tag === "List" && selected?.kind !== "list")
      return [
        P.ComponentValueMismatch({ componentId, name, expected: "list" }),
      ];
    if (!selected) return [];
    const item = selected.kind === "list" ? selected.element : selected;
    const result: EmailDocumentProblem[] = [];
    const componentFields = (component.fields ?? []).flatMap(({ field }) =>
      field?.length ? [field] : []
    );
    if (component._tag === "List") {
      const sort = component.sort?.path;
      if (
        sort !== undefined &&
        (!isEmailCustomerScalar(emailCustomerFieldAtPath(item, sort)) ||
          (item.kind === "record" &&
            !source.fields?.some((field) => samePath(field, sort))))
      )
        result.push(P.ListSortInvalid({ componentId, name }));
      if (
        component.limit !== undefined &&
        source.limit !== undefined &&
        component.limit > source.limit
      )
        result.push(P.ListLimitExceeded({ componentId, name }));
      if (component.limit !== undefined && component.limit <= 0)
        result.push(
          P.ComponentIncomplete({
            index: structure.indexOf(component),
            componentId,
            field: "limit",
          })
        );
    }
    if (item.kind === "record" && componentFields.length === 0)
      result.push(P.ComponentFieldsRequired({ componentId, name }));
    if (
      componentFields.some(
        (field) =>
          !isEmailCustomerScalar(emailCustomerFieldAtPath(item, field)) ||
          !source.fields?.some((selectedField) =>
            samePath(field, selectedField)
          )
      )
    )
      result.push(P.ComponentFieldInvalid({ componentId, name }));
    return result;
  }

  for (const locale of currentLocales)
    if (!Object.hasOwn(draft.translations ?? {}, locale))
      problems.push(P.LanguageMissing({ locale }));

  for (const [locale, translation] of Object.entries(
    draft.translations ?? {}
  )) {
    const subject = translation.subject ?? [];
    if (subject.length === 0 || isBlank(subject))
      problems.push(P.SubjectEmpty({ locale }));
    const checkParts = (
      parts: readonly DraftInlinePart[],
      at: EmailContentLocation,
      rich: boolean,
      links: Readonly<Record<string, string>>
    ) => {
      for (const part of parts) {
        if (!rich && hasFormatting(part))
          problems.push(P.FormattingNotAllowed({ at }));
        else if (part.link !== undefined && !Object.hasOwn(links, part.link))
          problems.push(P.LinkUnknown({ link: part.link, at }));
        if (part._tag !== "Value") continue;
        if (!part.name) {
          problems.push(P.ValueReferenceIncomplete({ at }));
          continue;
        }
        if (!kept.has(part.name)) {
          problems.push(P.ValueUnknown({ name: part.name, at }));
          continue;
        }
        const definition = definitions.get(part.name);
        const field = part.field;
        if (
          field !== undefined &&
          (field.length === 0 || field.some((segment) => !segment))
        )
          problems.push(P.ValueReferenceInvalid({ name: part.name, at }));
        else if (definition && !validScalarReference(definition, field))
          problems.push(P.ValueReferenceInvalid({ name: part.name, at }));
      }
    };
    checkParts(subject, { locale, field: "subject" }, false, {});
    checkParts(
      translation.preheader ?? [],
      { locale, field: "preheader" },
      false,
      {}
    );
    checkParts(
      translation.operationalReason ?? [],
      { locale, field: "operationalReason" },
      false,
      {}
    );
    for (const component of structure) {
      if (!component.id) continue;
      for (const text of emailComponentTexts(component)) {
        const at: EmailContentLocation = {
          locale,
          field: "text",
          componentId: component.id,
          textKey: text.textKey,
        };
        const parts = translation.texts?.[text.textKey];
        if (!parts) {
          problems.push(
            P.TextMissing({
              locale,
              componentId: component.id,
              textKey: text.textKey,
            })
          );
          continue;
        }
        if (!text.decorative && isBlank(parts))
          problems.push(
            P.TextEmpty({
              locale,
              componentId: component.id,
              textKey: text.textKey,
            })
          );
        checkParts(parts, at, text.role === "rich", component.links ?? {});
      }
    }
  }
  return problems;
}

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
