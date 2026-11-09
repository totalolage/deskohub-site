import {
  EmailBodyComponent,
  type EmailDocument,
  type EmailDraft,
  EmailInlinePart,
  type EmailTranslation,
  EmailValueDefinition,
  emailCustomerFieldAtPath,
  isEmailCustomerScalar,
} from "@deskohub/workspace-admin-api";
import { Array as Arr, Match, Option, Schema } from "effect";
import { emailCustomerValueField } from "./email-sample-values";

type DraftComponent = NonNullable<EmailDraft["structure"]>[number];
type DraftTranslation = NonNullable<EmailDraft["translations"]>[string];
type DraftTextListItem = NonNullable<DraftComponent["items"]>[number];
type Definitions = ReadonlyMap<string, EmailValueDefinition>;

const decodeComponent = Schema.decodeUnknownOption(EmailBodyComponent);
const decodeDefinition = Schema.decodeUnknownOption(EmailValueDefinition);
const decodePart = Schema.decodeUnknownOption(EmailInlinePart);

/** Whether `href` is a destination a link, button or linked image may have. */
const isDestination = (href: string) =>
  Option.isSome(
    decodeComponent({ _tag: "Button", id: "link", labelKey: "link", href })
  );

/** The customer record a component's fields read: the value, or each item. */
const recordFieldOf = (
  definition: EmailValueDefinition | undefined,
  items: boolean
) => {
  const field = definition && emailCustomerValueField(definition);
  return items && field?.kind === "list" ? field.element : field;
};

/** Whether a value reference names a scalar the renderer can show inline. */
const isScalarReference = (
  definition: EmailValueDefinition,
  path: readonly string[] | undefined
) =>
  Match.value(definition.source).pipe(
    Match.discriminatorsExhaustive("kind")({
      discount: () =>
        path?.length === 1 && (path[0] === "code" || path[0] === "expiresAt"),
      customer: () => {
        const field = emailCustomerValueField(definition);
        return path && path.length > 0
          ? field?.kind === "record" &&
              isEmailCustomerScalar(emailCustomerFieldAtPath(field, path))
          : isEmailCustomerScalar(field);
      },
    })
  );

/** The finished parts of a text; unfinished or broken value references drop. */
const previewParts = (
  parts: DraftTranslation["subject"],
  definitions: Definitions
): EmailInlinePart[] =>
  (parts ?? []).flatMap((part) => {
    if (part._tag === "Value") {
      const definition =
        part.name === undefined ? undefined : definitions.get(part.name);
      if (!definition || !isScalarReference(definition, part.field)) return [];
    }
    return Option.toArray(decodePart(part));
  });

/** List items that have a text; a nested list without any such item drops. */
const previewTextListItems = (
  items: readonly DraftTextListItem[] | undefined
): DraftTextListItem[] =>
  (items ?? []).flatMap((item) => {
    if (!item.textKey) return [];
    const { list, ...text } = item;
    const nested = previewTextListItems(list?.items);
    return list && nested.length > 0
      ? [
          {
            ...text,
            list: { ...list, ordered: list.ordered ?? false, items: nested },
          },
        ]
      : [text];
  });

/** Record fields the value's customer record has as scalars. */
const previewFields = (
  component: DraftComponent,
  definition: EmailValueDefinition | undefined,
  items: boolean
) => {
  const record = recordFieldOf(definition, items);
  return (component.fields ?? []).filter(
    (field) =>
      field.labelKey &&
      field.field &&
      field.field.length > 0 &&
      record?.kind === "record" &&
      isEmailCustomerScalar(emailCustomerFieldAtPath(record, field.field))
  );
};

/** A list without unusable fields, and without its sort while unfinished. */
const previewList = (
  component: DraftComponent,
  definition: EmailValueDefinition | undefined
) => {
  const { fields: _drafted, sort, ...list } = component;
  const fields = previewFields(component, definition, true);
  const withFields = fields.length > 0 ? { ...list, fields } : list;
  const element = recordFieldOf(definition, true);
  return sort?.path &&
    sort.direction &&
    element &&
    isEmailCustomerScalar(emailCustomerFieldAtPath(element, sort.path))
    ? { ...withFields, sort }
    : withFields;
};

/**
 * Whether a list component can render: its value is a customer list, and a
 * list of records shows at least one of their fields.
 */
const isUsableList = (
  component: DraftComponent,
  definition: EmailValueDefinition | undefined
) =>
  recordFieldOf(definition, false)?.kind === "list" &&
  (recordFieldOf(definition, true)?.kind !== "record" ||
    previewFields(component, definition, true).length > 0);

/**
 * The renderable form of one draft component, or nothing while it is
 * unfinished. Broken links, unusable record fields and an unfinished sort
 * drop; a value component whose value isn't usable drops with it.
 */
const previewComponent = (
  component: DraftComponent,
  definitions: Definitions
): Option.Option<EmailBodyComponent> => {
  const definition =
    component.value === undefined
      ? undefined
      : definitions.get(component.value);
  const links = Object.fromEntries(
    Object.entries(component.links ?? {}).filter(([, href]) =>
      isDestination(href)
    )
  );
  const { href, ...unlinked } = component;
  const candidate = Match.value(component._tag).pipe(
    Match.when("TextList", () => ({
      ...component,
      ordered: component.ordered ?? false,
      items: previewTextListItems(component.items),
      links,
    })),
    Match.when("Image", () =>
      href === undefined || isDestination(href) ? component : unlinked
    ),
    Match.when("Record", () => ({
      ...component,
      fields: previewFields(component, definition, false),
    })),
    Match.when("List", () => previewList(component, definition)),
    Match.whenOr("Paragraph", "Heading", () => ({ ...component, links })),
    Match.orElse(() => component)
  );
  const usable = Match.value(component._tag).pipe(
    Match.when("Record", () => definition?.source.kind === "customer"),
    Match.when("List", () => isUsableList(component, definition)),
    Match.when("Offer", () => definition?.source.kind === "discount"),
    Match.orElse(() => true)
  );
  return usable ? decodeComponent(candidate) : Option.none();
};

/** The draft's finished value definitions by name; a repeated name keeps its first. */
const previewDefinitions = (values: EmailDraft["values"]): Definitions =>
  new Map(
    Arr.dedupeWith(
      Arr.getSomes((values ?? []).map((value) => decodeDefinition(value))),
      (a, b) => a.name === b.name
    ).map((definition) => [definition.name, definition])
  );

/** The draft's finished components; a repeated id keeps its first. */
const previewStructure = (
  structure: EmailDraft["structure"],
  definitions: Definitions
): EmailBodyComponent[] =>
  Arr.dedupeWith(
    Arr.getSomes(
      (structure ?? []).map((component) =>
        previewComponent(component, definitions)
      )
    ),
    (a, b) => a.id === b.id
  );

/** A language's finished texts; a missing text, or language, renders empty. */
const previewTranslation = (
  translation: DraftTranslation | undefined,
  definitions: Definitions
): EmailTranslation => {
  const texts: EmailTranslation = {
    subject: previewParts(translation?.subject, definitions),
    preheader: previewParts(translation?.preheader, definitions),
    texts: Object.fromEntries(
      Object.entries(translation?.texts ?? {}).map(([textKey, parts]) => [
        textKey,
        previewParts(parts, definitions),
      ])
    ),
  };
  return translation?.operationalReason
    ? {
        ...texts,
        operationalReason: previewParts(
          translation.operationalReason,
          definitions
        ),
      }
    : texts;
};

/**
 * A renderable email from a draft still being written, for its preview. It
 * keeps what is finished and drops the rest: unfinished components and value
 * definitions, value references they would break, and broken links. A missing
 * text, or a language without any, renders empty. It never fails.
 */
export const previewEmailDocument = (
  draft: EmailDraft,
  locale: string
): EmailDocument => {
  const definitions = previewDefinitions(draft.values);
  return {
    purpose: draft.purpose ?? "marketing",
    templateKey: draft.templateKey ?? "workspace",
    structure: previewStructure(draft.structure, definitions),
    translations: {
      [locale]: previewTranslation(draft.translations?.[locale], definitions),
    },
    values: [...definitions.values()],
  };
};
