import {
  type EmailCustomerField,
  type EmailDocument,
  type EmailValueDefinition,
  EmailValueSnapshot,
  requiredEmailValueNames,
  selectedEmailCustomerShape as selectedEmailCustomerFields,
} from "@deskohub/workspace-admin-api";
import { Match, type Schema } from "effect";
import { sampleEmailDiscountValue } from "@/features/emails/values/discount";

const [ResolvedSnapshot, FallbackSnapshot] = EmailValueSnapshot.members;

/** How many items a sample list shows when its selection sets no limit. */
const sampleListLength = 2;

/**
 * The customer field a value shows: frozen at publication, or, for a draft
 * not yet published, what today's catalogue selects.
 */
export const emailCustomerValueField = (
  definition: EmailValueDefinition
): EmailCustomerField | undefined =>
  Match.value(definition.source).pipe(
    Match.discriminatorsExhaustive("kind")({
      customer: (source) =>
        definition["customerShape"] ?? selectedEmailCustomerFields(source),
      discount: () => undefined,
    })
  );

/**
 * A synthetic value of `field`. Strings name their field in brackets, such as
 * `[firstName]`, so a preview never passes for a real customer's data.
 */
const sampleOfField = (
  field: EmailCustomerField,
  name: string,
  listLength: number
): Schema.Json =>
  Match.value(field).pipe(
    Match.discriminatorsExhaustive("kind")({
      scalar: (scalar) =>
        scalar.choices?.[0] ??
        Match.value(scalar.type).pipe(
          Match.when("string", () => `[${name}]`),
          Match.when("number", () => 3),
          Match.when("boolean", () => true),
          Match.exhaustive
        ),
      record: (record) =>
        Object.fromEntries(
          Object.entries(record.fields).map(([key, child]) => [
            key,
            sampleOfField(child, key, sampleListLength),
          ])
        ),
      list: (list) =>
        Array.from({ length: listLength }, () =>
          sampleOfField(list.element, name, sampleListLength)
        ),
      union: (union) =>
        union.alternatives[0] === undefined
          ? null
          : sampleOfField(union.alternatives[0], name, listLength),
      unsupported: () => null,
    })
  );

const sampleSnapshot = (
  definition: EmailValueDefinition,
  locale: string,
  now: Temporal.Instant
): EmailValueSnapshot => {
  const fallback = FallbackSnapshot.make({
    text: definition.fallback?.[locale] ?? `[${definition.name}]`,
  });
  return Match.value(definition.source).pipe(
    Match.discriminatorsExhaustive("kind")({
      discount: (source) =>
        ResolvedSnapshot.make({ value: sampleEmailDiscountValue(source, now) }),
      customer: (source) => {
        const field = emailCustomerValueField(definition);
        return field
          ? ResolvedSnapshot.make({
              value: sampleOfField(
                field,
                source.path.at(-1) ?? definition.name,
                Math.min(source.limit ?? sampleListLength, sampleListLength)
              ),
            })
          : fallback;
      },
    })
  );
};

/**
 * Synthetic snapshots of the values an email shows, derived from each
 * value's field: bracketed field names for text, the non-redeemable sample
 * discount code. It reads no customer and issues no discount. A value whose
 * field is unknown shows its fallback, or its bracketed name.
 */
export const sampleEmailValues = (
  document: EmailDocument,
  locale: string,
  now: Temporal.Instant
): Record<string, EmailValueSnapshot> => {
  const required = new Set<string>(requiredEmailValueNames(document));
  return Object.fromEntries(
    document.values
      .filter((definition) => required.has(definition.name))
      .map((definition) => [
        definition.name,
        sampleSnapshot(definition, locale, now),
      ])
  );
};
