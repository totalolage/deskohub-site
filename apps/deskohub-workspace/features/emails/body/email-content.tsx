import {
  type EmailBodyComponent,
  type EmailDocument,
  type EmailInlinePart,
  type EmailTextListLevel,
  type EmailTranslation,
  type EmailValueDefinition,
  type EmailValueName,
  type EmailValueSnapshot,
  matchesEmailCustomerField,
  WORKSPACE_SITE_TIME_ZONE,
} from "@deskohub/workspace-admin-api";
import type { JSONContent } from "@tiptap/core";
import { Array as Arr, Match, Option, Predicate, Result, Schema } from "effect";
import { Fragment, type ReactElement, type ReactNode } from "react";
import { Column, Row, Section, Text } from "react-email";
import {
  compareSortKeys,
  valueAtPath,
} from "@/features/emails/values/customer";
import { isLocale, type Locale, m } from "@/features/i18n";
import { formatInstantDate } from "@/shared/utils/date-time-format";
import {
  EmailLanguageMissing,
  type EmailRenderFailure,
  EmailValueMismatch,
  EmailValueMissing,
} from "./email-render-failure";
import {
  EmailBodyImage,
  EmailCtaButton,
  renderEmailRichText,
} from "./email-rich-text";

/** Snapshots of the values an email shows, by value name. */
export type EmailValueSnapshots = Readonly<Record<string, EmailValueSnapshot>>;

/** One language of an email, ready for its template. */
export type RenderedEmailContent = {
  readonly subject: string;
  readonly preheader: string;
  /** The operational footer's reason line, when the language words one. */
  readonly operationalReason?: string;
  readonly body: ReactElement;
};

type Rendering = {
  readonly document: EmailDocument;
  readonly locale: Locale;
  readonly translation: EmailTranslation;
  readonly values: EmailValueSnapshots;
};

type Parts = readonly EmailInlinePart[];
type Links = Readonly<Record<string, string>> | undefined;
type ValueFailure = EmailValueMissing | EmailValueMismatch;
type SortKey = string | number | boolean | null;

/** A discount value as its snapshot stores it: the code and its expiry. */
const DiscountSnapshotValue = Schema.Struct({
  code: Schema.NonEmptyString,
  expiresAt: Schema.String.check(
    Schema.makeFilter((expiresAt) => Number.isFinite(Date.parse(expiresAt)))
  ),
});
type DiscountSnapshotValue = typeof DiscountSnapshotValue.Type;

const resolvedValue = (
  rendering: Rendering,
  name: EmailValueName
): Result.Result<
  {
    readonly definition: EmailValueDefinition;
    readonly snapshot: EmailValueSnapshot;
  },
  ValueFailure
> => {
  const definition = rendering.document.values.find(
    (candidate) => candidate.name === name
  );
  const snapshot = Object.hasOwn(rendering.values, name)
    ? rendering.values[name]
    : undefined;
  if (!definition || !snapshot)
    return Result.fail(new EmailValueMissing({ name }));
  // A customer value must have the shape publication froze, whatever today's
  // catalogue says; the renderer still checks each use it reads.
  const frozen = definition["customerShape"];
  const matchesFrozen = Match.valueTags(snapshot, {
    Fallback: () => true,
    Resolved: ({ value }) =>
      frozen === undefined || matchesEmailCustomerField(value, frozen),
  });
  return matchesFrozen
    ? Result.succeed({ definition, snapshot })
    : Result.fail(new EmailValueMismatch({ name }));
};

const discountValue = (
  name: EmailValueName,
  value: Schema.Json
): Result.Result<DiscountSnapshotValue, EmailValueMismatch> =>
  Option.match(Schema.decodeUnknownOption(DiscountSnapshotValue)(value), {
    onNone: () => Result.fail(new EmailValueMismatch({ name })),
    onSome: Result.succeed,
  });

/** A discount's expiry as a date in the Workspace's time zone. */
const expiryDate = (discount: DiscountSnapshotValue, locale: Locale) =>
  formatInstantDate({
    instant: Temporal.Instant.fromEpochMilliseconds(
      Date.parse(discount.expiresAt)
    ),
    locale,
    timeZone: WORKSPACE_SITE_TIME_ZONE,
  });

/** A scalar as its text; a missing or null scalar is empty. */
const scalarText = (
  value: Schema.Json | undefined,
  locale: Locale
): Option.Option<string> => {
  if (value === undefined || value === null) return Option.some("");
  if (Predicate.isString(value)) return Option.some(value);
  if (Predicate.isNumber(value))
    return Option.some(new Intl.NumberFormat(locale).format(value));
  if (Predicate.isBoolean(value))
    return Option.some(
      value
        ? m.emailContentYes({}, { locale })
        : m.emailContentNo({}, { locale })
    );
  return Option.none();
};

const scalarOf = (
  name: EmailValueName,
  value: Schema.Json | undefined,
  locale: Locale
): Result.Result<string, EmailValueMismatch> =>
  Option.match(scalarText(value, locale), {
    onNone: () => Result.fail(new EmailValueMismatch({ name })),
    onSome: Result.succeed,
  });

const isJsonRecord = (
  value: Schema.Json
): value is { readonly [key: string]: Schema.Json } =>
  value !== null &&
  Predicate.isObjectKeyword(value) &&
  !Arr.isArray<Schema.Json>(value);

/** The scalar a record value holds at `field`, as text. */
const recordFieldText = (
  name: EmailValueName,
  value: Schema.Json,
  field: readonly string[],
  locale: Locale
) =>
  isJsonRecord(value)
    ? scalarOf(name, valueAtPath(value, field), locale)
    : Result.fail(new EmailValueMismatch({ name }));

/** The text a value reference shows: its fallback, or the referenced scalar. */
const valueText = (
  rendering: Rendering,
  part: Extract<EmailInlinePart, { readonly _tag: "Value" }>
): Result.Result<string, ValueFailure> =>
  Result.gen(function* () {
    const { definition, snapshot } = yield* resolvedValue(rendering, part.name);
    return yield* Match.valueTags(snapshot, {
      Fallback: ({ text }) => Result.succeed(text),
      Resolved: ({ value }) =>
        Match.value(definition.source).pipe(
          Match.discriminatorsExhaustive("kind")({
            discount: () =>
              discountValue(part.name, value).pipe(
                Result.flatMap((discount) =>
                  Match.value(part.field?.join(".")).pipe(
                    Match.when("code", () => Result.succeed(discount.code)),
                    Match.when("expiresAt", () =>
                      Result.succeed(expiryDate(discount, rendering.locale))
                    ),
                    Match.orElse(() =>
                      Result.fail(new EmailValueMismatch({ name: part.name }))
                    )
                  )
                )
              ),
            customer: () =>
              part.field && part.field.length > 0
                ? recordFieldText(
                    part.name,
                    value,
                    part.field,
                    rendering.locale
                  )
                : scalarOf(part.name, value, rendering.locale),
          })
        ),
    });
  });

const partText = (rendering: Rendering, part: EmailInlinePart) =>
  Match.valueTags(part, {
    Text: ({ text }) => Result.succeed(text),
    Value: (value) => valueText(rendering, value),
  });

/** A plain text: its parts' text, without formatting. */
const plainText = (rendering: Rendering, parts: Parts | undefined) =>
  Result.all((parts ?? []).map((part) => partText(rendering, part))).pipe(
    Result.map((texts) => texts.join(""))
  );

const textOf = (rendering: Rendering, textKey: string) =>
  Object.hasOwn(rendering.translation.texts, textKey)
    ? rendering.translation.texts[textKey]
    : undefined;

/**
 * A rich text as TipTap text nodes: each part's text with its marks, values
 * substituted. A link names one of the component's shared destinations.
 */
const richTextNodes = (
  rendering: Rendering,
  parts: Parts | undefined,
  links: Links
): Result.Result<JSONContent[], ValueFailure> =>
  Result.all(
    (parts ?? []).map((part) =>
      partText(rendering, part).pipe(
        Result.map((text): JSONContent[] => {
          if (text === "") return [];
          const href =
            part.link !== undefined && links && Object.hasOwn(links, part.link)
              ? links[part.link]
              : undefined;
          const marks = [
            ...(part.bold ? [{ type: "bold" }] : []),
            ...(part.italic ? [{ type: "italic" }] : []),
            ...(href ? [{ type: "link", attrs: { href } }] : []),
          ];
          return [
            marks.length > 0
              ? { type: "text", text, marks }
              : { type: "text", text },
          ];
        })
      )
    )
  ).pipe(Result.map((nodes) => nodes.flat()));

const paragraphNode = (content: JSONContent[]): JSONContent => ({
  type: "paragraph",
  content,
});

const textListNode = (
  rendering: Rendering,
  level: EmailTextListLevel,
  links: Links
): Result.Result<JSONContent, ValueFailure> =>
  Result.all(
    level.items.map((item) =>
      Result.gen(function* () {
        const text = yield* richTextNodes(
          rendering,
          textOf(rendering, item.textKey),
          links
        );
        const nested = item.list
          ? [yield* textListNode(rendering, item.list, links)]
          : [];
        return {
          type: "listItem",
          content: [paragraphNode(text), ...nested],
        };
      })
    )
  ).pipe(
    Result.map((content): JSONContent => {
      const list: JSONContent = {
        type: level.ordered ? "orderedList" : "bulletList",
        content,
      };
      if (level.start !== undefined) list.attrs = { start: level.start };
      return list;
    })
  );

const richText = (...content: JSONContent[]) =>
  renderEmailRichText({ type: "doc", content });

/** A value component's fallback, worded as a body paragraph. */
const fallbackParagraph = (text: string) =>
  richText(paragraphNode(text === "" ? [] : [{ type: "text", text }]));

const EmailValueRows = ({
  rows,
}: {
  readonly rows: readonly {
    readonly key: string;
    readonly label: string;
    readonly value: string;
  }[];
}) => (
  <Section className="mt-4">
    {rows.map((row) => (
      <Row key={row.key}>
        <Column className="w-[40%] py-1 pr-4 align-top text-[14px] leading-[22px] text-[#6b6e8a]">
          {row.label}
        </Column>
        <Column className="py-1 align-top text-[16px] leading-[25px] text-[#373a59]">
          {row.value}
        </Column>
      </Row>
    ))}
  </Section>
);

type ComponentFields = readonly {
  readonly field: readonly string[];
  readonly labelKey: string;
}[];

const recordRows = (
  rendering: Rendering,
  name: EmailValueName,
  value: Schema.Json,
  fields: ComponentFields
) =>
  Result.all(
    fields.map((field) =>
      Result.all({
        label: plainText(rendering, textOf(rendering, field.labelKey)),
        value: recordFieldText(name, value, field.field, rendering.locale),
      }).pipe(Result.map((row) => ({ ...row, key: field.labelKey })))
    )
  );

/**
 * Runs `render` on a value component's resolved value, or shows the value's
 * fallback text in place of the whole component.
 */
const valueComponent = (
  rendering: Rendering,
  name: EmailValueName,
  render: (
    value: Schema.Json,
    definition: EmailValueDefinition
  ) => Result.Result<ReactNode, ValueFailure>
): Result.Result<ReactNode, ValueFailure> =>
  resolvedValue(rendering, name).pipe(
    Result.flatMap(({ definition, snapshot }) =>
      Match.valueTags(snapshot, {
        Fallback: ({ text }) => Result.succeed(fallbackParagraph(text)),
        Resolved: ({ value }) => render(value, definition),
      })
    )
  );

const sortKeyOf = (
  name: EmailValueName,
  item: Schema.Json,
  path: readonly string[]
): Result.Result<SortKey, EmailValueMismatch> => {
  const key = valueAtPath(item, path) ?? null;
  return key === null || !Predicate.isObjectKeyword(key)
    ? Result.succeed(key)
    : Result.fail(new EmailValueMismatch({ name }));
};

/** The list's items in the component's order, up to its limit. */
const shownItems = (
  component: Extract<EmailBodyComponent, { readonly _tag: "List" }>,
  items: readonly Schema.Json[]
): Result.Result<readonly Schema.Json[], EmailValueMismatch> => {
  const { sort } = component;
  const sorted: Result.Result<readonly Schema.Json[], EmailValueMismatch> = sort
    ? Result.all(
        items.map((item) =>
          sortKeyOf(component.value, item, sort.path).pipe(
            Result.map((key) => ({ item, key }))
          )
        )
      ).pipe(
        Result.map((keyed) =>
          keyed
            .toSorted((left, right) =>
              compareSortKeys(left.key, right.key, sort.direction)
            )
            .map(({ item }) => item)
        )
      )
    : Result.succeed(items);
  return sorted.pipe(Result.map((all) => all.slice(0, component.limit)));
};

const listComponent = (
  rendering: Rendering,
  component: Extract<EmailBodyComponent, { readonly _tag: "List" }>
) =>
  valueComponent(
    rendering,
    component.value,
    (value): Result.Result<ReactNode, ValueFailure> => {
      const name = component.value;
      if (!Arr.isArray<Schema.Json>(value))
        return Result.fail(new EmailValueMismatch({ name }));
      const { fields } = component;
      return shownItems(component, value).pipe(
        Result.flatMap(
          (items): Result.Result<ReactNode, ValueFailure> =>
            fields
              ? Result.all(
                  items.map((item) => recordRows(rendering, name, item, fields))
                ).pipe(
                  Result.map((records) => (
                    <>
                      {records.map((rows, index) => (
                        <Section
                          className="mt-4 border-t border-[#e6ded2] border-solid"
                          // biome-ignore lint/suspicious/noArrayIndexKey: Snapshot items are ordered and may repeat verbatim.
                          key={index}
                        >
                          <EmailValueRows rows={rows} />
                        </Section>
                      ))}
                    </>
                  ))
                )
              : Result.all(
                  items.map((item) => scalarOf(name, item, rendering.locale))
                ).pipe(
                  Result.map((texts) =>
                    richText({
                      type: "bulletList",
                      content: texts.map((text) => ({
                        type: "listItem",
                        content: [
                          paragraphNode(
                            text === "" ? [] : [{ type: "text", text }]
                          ),
                        ],
                      })),
                    })
                  )
                )
        )
      );
    }
  );

const offerComponent = (
  rendering: Rendering,
  component: Extract<EmailBodyComponent, { readonly _tag: "Offer" }>
) =>
  valueComponent(rendering, component.value, (value) =>
    Result.all({
      discount: discountValue(component.value, value),
      label: plainText(rendering, textOf(rendering, component.labelKey)),
    }).pipe(
      Result.map(({ discount, label }) => (
        <>
          <Section className="mt-6 rounded-2xl border border-[#e6ded2] border-dashed px-6 py-5 text-center">
            <Text className="m-0 text-[14px] leading-[20px] text-[#6b6e8a]">
              {m.emailContentOfferCodeLabel({}, { locale: rendering.locale })}
            </Text>
            <Text className="m-0 mt-2 text-[24px] font-bold leading-[32px] tracking-[2px] text-navy">
              {discount.code}
            </Text>
            <Text className="m-0 mt-2 text-[14px] leading-[20px] text-[#6b6e8a]">
              {m.emailContentOfferValidUntil(
                { date: expiryDate(discount, rendering.locale) },
                { locale: rendering.locale }
              )}
            </Text>
          </Section>
          <EmailCtaButton href={component.href} label={label} />
        </>
      ))
    )
  );

const componentElement = (
  rendering: Rendering,
  component: EmailBodyComponent
): Result.Result<ReactNode, ValueFailure> =>
  Match.valueTags(component, {
    Paragraph: ({ textKey, links }) =>
      richTextNodes(rendering, textOf(rendering, textKey), links).pipe(
        Result.map((content) => richText(paragraphNode(content)))
      ),
    Heading: ({ textKey, level, links }) =>
      richTextNodes(rendering, textOf(rendering, textKey), links).pipe(
        Result.map((content) =>
          richText({ type: "heading", attrs: { level }, content })
        )
      ),
    TextList: (list) =>
      textListNode(rendering, list, list.links).pipe(Result.map(richText)),
    Divider: () => Result.succeed(richText({ type: "horizontalRule" })),
    Spacer: () => Result.succeed(richText({ type: "paragraph" })),
    Image: ({ src, altKey, href, align, width }) =>
      Result.gen(function* () {
        const alt = yield* plainText(rendering, textOf(rendering, altKey));
        return (
          <EmailBodyImage
            align={align}
            alt={alt}
            href={href}
            src={src}
            width={width}
          />
        );
      }),
    Button: ({ labelKey, href }) =>
      Result.gen(function* () {
        const label = yield* plainText(rendering, textOf(rendering, labelKey));
        return <EmailCtaButton href={href} label={label} />;
      }),
    Record: (record) =>
      valueComponent(rendering, record.value, (value) =>
        Result.gen(function* () {
          const rows = yield* recordRows(
            rendering,
            record.value,
            value,
            record.fields
          );
          return <EmailValueRows rows={rows} />;
        })
      ),
    List: (list) => listComponent(rendering, list),
    Offer: (offer) => offerComponent(rendering, offer),
  });

/**
 * Renders one language of a published email from value snapshots. It reads
 * only the document's own frozen definitions and the given snapshots, so it
 * never generates a value or reaches a provider, and an old publication
 * renders the same after today's catalogue changes.
 */
export const renderEmailContent = ({
  document,
  locale,
  values,
}: {
  readonly document: EmailDocument;
  readonly locale: string;
  readonly values: EmailValueSnapshots;
}): Result.Result<RenderedEmailContent, EmailRenderFailure> =>
  Result.gen(function* () {
    const translation = Object.hasOwn(document.translations, locale)
      ? document.translations[locale]
      : undefined;
    if (!translation || !isLocale(locale))
      return yield* Result.fail(new EmailLanguageMissing({ locale }));
    const rendering: Rendering = { document, locale, translation, values };
    const components = yield* Result.all(
      document.structure.map((component) =>
        componentElement(rendering, component).pipe(
          Result.map((element) => ({ id: component.id, element }))
        )
      )
    );
    const operationalReason = (yield* plainText(
      rendering,
      translation.operationalReason
    )).trim();
    return {
      subject: yield* plainText(rendering, translation.subject),
      preheader: yield* plainText(rendering, translation.preheader),
      operationalReason:
        operationalReason === "" ? undefined : operationalReason,
      body: (
        <>
          {components.map(({ id, element }) => (
            <Fragment key={id}>{element}</Fragment>
          ))}
        </>
      ),
    };
  });
