import { Schema } from "effect";
import {
  type AudienceAttributeDefinition,
  type AudienceAttributeKind,
  type AudienceConditionIn,
  booleanAttribute,
  choiceParam,
  countAttribute,
  dateAttribute,
  defineAudienceAttributeCatalogue,
  freeTextValues,
  lookupValues,
  optionalChoiceParam,
  optionValues,
  periodParam,
  setAttribute,
} from "./audience-attribute-kinds";
import {
  AdministrationCampaignLocale,
  AdministrationCampaignPurpose,
} from "./campaign-locale-and-purpose";
import { AdministrationReservationStatusFilter } from "./workspace-admin-api";

/**
 * The customer attributes an audience can filter on. Each entry declares its
 * kind, its wire shape (`attribute`, `params`, an `operator` and a `value` of
 * its kind), its Admin UI label, section, editor wording and defaults, and its
 * summary wording. Workspace drives evaluation, the Admin UI, summaries,
 * locale narrowing, and `dhw` validation from it by kind, so adding an
 * attribute takes an entry here and its Workspace resolver.
 */
export const audienceAttributeCatalogue = defineAudienceAttributeCatalogue({
  /**
   * Booked reservations dated by visit (the Dotypos start) or booking
   * (`reservation_confirmed_at`) within the period. Without a status only
   * booked reservations count: confirmed and never cancelled.
   */
  reservationCount: countAttribute("reservationCount", {
    label: "Reservation count",
    section: "Reservations",
    params: {
      dateBasis: choiceParam(Schema.Literals(["visit", "booking"]), {
        label: "Date basis",
        control: "toggle",
        options: {
          visit: { label: "visit date", periodVerb: "visiting " },
          booking: { label: "booking date", periodVerb: "confirmed " },
        },
      }),
      period: periodParam,
      status: optionalChoiceParam(AdministrationReservationStatusFilter, {
        label: "Reservation status",
        control: "select",
        absent: { label: "booked", nounBefore: "booked " },
        options: {
          in_progress: { label: "in progress", nounAfter: " in progress" },
          complete: { label: "complete", nounBefore: "complete " },
          cancelled: { label: "cancelled", nounBefore: "cancelled " },
          needs_refund: {
            label: "needs refund",
            nounAfter: " needing a refund",
          },
        },
      }),
    },
    reservationProduct: true,
    editor: {
      lead: [
        { param: "status" },
        { text: "reservations by" },
        { param: "dateBasis" },
      ],
      period: "Reservations",
      count: "Reservation count",
    },
    summary: {
      verb: "have",
      noun: { one: "reservation", other: "reservations" },
    },
    defaults: {
      params: { dateBasis: "visit", period: { _tag: "AnyTime" } },
      operator: "gt",
      value: 0,
    },
  }),
  /**
   * Start of the customer's latest booked reservation that has begun, of the
   * product when `params.product` names one.
   */
  lastVisit: dateAttribute("lastVisit", {
    label: "Last visit",
    section: "Reservations",
    reservationProduct: true,
    editor: { noValue: "never visited" },
    summary: {
      withValue: "have visited",
      inPeriod: "last visited",
      notInPeriod: ", with the last visit not",
      withoutValue: "have never visited",
    },
    defaults: {
      operator: "in",
      value: { _tag: "Last", count: 30, unit: "day" },
    },
  }),
  /**
   * Campaign emails Resend accepted for the customer (sent, delivered,
   * complained, or unconfirmed), dated by dispatch. Transactional emails
   * have no per-customer record and never count.
   */
  campaignEmailCount: countAttribute("campaignEmailCount", {
    label: "Campaign emails received",
    section: "Emails",
    params: {
      purpose: choiceParam(
        Schema.Union([AdministrationCampaignPurpose, Schema.Literal("any")]),
        {
          label: "Campaign purpose",
          control: "select",
          options: {
            marketing: { label: "marketing", nounBefore: "marketing " },
            operational: { label: "operational", nounBefore: "operational " },
            any: { label: "any" },
          },
        }
      ),
      period: periodParam,
    },
    editor: {
      lead: [{ param: "purpose" }, { text: "campaign emails received" }],
      period: "Emails received",
      count: "Campaign email count",
    },
    summary: {
      verb: "received",
      noun: { one: "campaign email", other: "campaign emails" },
    },
    defaults: {
      params: {
        purpose: "marketing",
        period: { _tag: "Last", count: 30, unit: "day" },
      },
      operator: "eq",
      value: 0,
    },
  }),
  /** Whether the customer has a linked Workspace account. */
  hasAccount: booleanAttribute("hasAccount", {
    label: "Workspace account",
    section: "Account",
    editor: { true: "Has", false: "Hasn’t", object: "a Workspace account" },
    summary: {
      true: "have a Workspace account",
      false: "have no Workspace account",
    },
    defaults: { operator: "is", value: true },
  }),
  /** When the customer's linked Workspace account was created. */
  accountCreated: dateAttribute("accountCreated", {
    label: "Account created",
    section: "Account",
    editor: { noValue: "no account" },
    summary: {
      withValue: "have a Workspace account",
      inPeriod: "created a Workspace account",
      notInPeriod: " not created",
      withoutValue: "have no Workspace account",
    },
    defaults: {
      operator: "in",
      value: { _tag: "Last", count: 30, unit: "day" },
    },
  }),
  /** The customer's resolved campaign locale. */
  locale: setAttribute("locale", {
    label: "Locale",
    section: "Profile",
    values: optionValues(AdministrationCampaignLocale, {
      noun: "locale",
      options: {
        "cs-CZ": { label: "Czech (cs-CZ)", name: "Czech" },
        "en-US": { label: "English (en-US)", name: "English" },
      },
    }),
    operators: ["anyOf", "noneOf"],
    narrowsLocales: true,
    editor: { lead: "Locale" },
    summary: { anyOf: "speak", noneOf: "don’t speak" },
    defaults: { operator: "anyOf", value: ["cs-CZ"] },
  }),
  /** Tags on the customer's Dotypos profile. */
  dotyposTags: setAttribute("dotyposTags", {
    label: "Dotypos tags",
    section: "Profile",
    values: freeTextValues({ noun: "tag", placeholder: "Add a tag" }),
    operators: ["anyOf", "allOf", "noneOf"],
    editor: { lead: "Tags" },
    summary: {
      anyOf: "are tagged",
      allOf: "are tagged",
      noneOf: "aren’t tagged",
    },
    defaults: { operator: "anyOf", value: [] },
  }),
  /** The discount group (ID) of the customer's Dotypos profile. */
  discountGroup: setAttribute("discountGroup", {
    label: "Discount group",
    section: "Profile",
    values: lookupValues({
      lookup: "discountGroups",
      noun: "discount group",
      choose: "Choose groups",
      freeText: { noun: "discount group ID", placeholder: "Dotypos group ID" },
    }),
    operators: ["anyOf", "noneOf"],
    editor: { lead: "Discount group" },
    summary: {
      anyOf: "are in discount group",
      noneOf: "aren’t in discount group",
    },
    defaults: { operator: "anyOf", value: [] },
  }),
});

export type AudienceAttributeCatalogue = typeof audienceAttributeCatalogue;

export type AudienceAttribute = keyof AudienceAttributeCatalogue;

/** Every attribute of one kind. */
export type AudienceAttributeOfKind<Kind extends AudienceAttributeKind> = {
  readonly [Attribute in AudienceAttribute]: AudienceAttributeCatalogue[Attribute]["kind"] extends Kind
    ? Attribute
    : never;
}[AudienceAttribute];

export type AudienceCondition = AudienceConditionIn<AudienceAttributeCatalogue>;

/** The condition shape of one attribute. */
export type AudienceConditionOf<Attribute extends AudienceAttribute> = Extract<
  AudienceCondition,
  { readonly attribute: Attribute }
>;

/**
 * A nested AND/OR group. An empty AND group matches every candidate, so an
 * audience whose root is `{ operator: "and", filters: [] }` reaches all
 * customers Workspace knows; an empty OR group matches nobody.
 */
export type AudienceFilterGroupOf<Condition> = {
  readonly _tag: "Group";
  readonly operator: "and" | "or";
  readonly filters: readonly AudienceFilterOf<Condition>[];
};

/** A filter tree over one catalogue's conditions. */
export type AudienceFilterOf<Condition> =
  | Condition
  | AudienceFilterGroupOf<Condition>;

export type AudienceFilterGroup = AudienceFilterGroupOf<AudienceCondition>;
export type AudienceFilter = AudienceFilterOf<AudienceCondition>;

/**
 * The condition and filter-tree schemas of a catalogue. The filter tree
 * ignores excess properties when decoded on its own; the strict API inputs
 * that embed it reject them.
 */
export const makeAudienceFilterSchemas = <
  Catalogue extends {
    readonly [Attribute in keyof Catalogue]: AudienceAttributeDefinition;
  },
>(
  catalogue: Catalogue
) => {
  type Condition = AudienceConditionIn<Catalogue>;
  const definitions: readonly AudienceAttributeDefinition[] =
    Object.values(catalogue);
  // Each entry's shapes decode to its own attribute's conditions.
  const members = definitions.flatMap(
    ({ conditions }) => conditions
  ) as readonly Schema.Codec<Condition>[];
  const group = Schema.TaggedStruct("Group", {
    operator: Schema.Literals(["and", "or"]),
    filters: Schema.Array(
      Schema.suspend((): Schema.Codec<AudienceFilterOf<Condition>> => filter)
    ),
  });
  const filter: Schema.Codec<AudienceFilterOf<Condition>> = Schema.Union<
    readonly Schema.Codec<AudienceFilterOf<Condition>>[]
  >([...members, group]).annotate({
    identifier: "AudienceFilter",
    description: `Nested AND/OR tree of attribute conditions: ${definitions
      .map(({ label }) => label.toLowerCase())
      .join(", ")}.`,
  });
  return { condition: Schema.Union(members), filter };
};

const schemas = makeAudienceFilterSchemas(audienceAttributeCatalogue);

/** One condition on one catalogued customer attribute. */
export const AudienceCondition: Schema.Codec<AudienceCondition> =
  schemas.condition;

/**
 * The filter tree a campaign audience selects its recipients with. Workspace
 * stores and evaluates this schema, and the administration API carries it, so
 * it has one definition.
 */
export const AudienceFilter: Schema.Codec<AudienceFilter> = schemas.filter;
