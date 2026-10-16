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
 * its kind), its English `label` and Admin UI section, and its defaults.
 * Workspace drives evaluation, the Admin UI structure, locale narrowing, and
 * `dhw` validation from it by kind. Adding an attribute takes an entry here,
 * its Workspace resolver, and its Admin UI wording (labels, editor words, and
 * summary phrases) in Workspace's audience attribute wording, with its
 * administration messages in both locales.
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
        control: "toggle",
        options: ["visit", "booking"],
      }),
      period: periodParam,
      status: optionalChoiceParam(AdministrationReservationStatusFilter, {
        control: "select",
        options: ["in_progress", "complete", "cancelled", "needs_refund"],
      }),
    },
    reservationProduct: true,
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
        { control: "select", options: ["marketing", "operational", "any"] }
      ),
      period: periodParam,
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
    defaults: { operator: "is", value: true },
  }),
  /** When the customer's linked Workspace account was created. */
  accountCreated: dateAttribute("accountCreated", {
    label: "Account created",
    section: "Account",
    defaults: {
      operator: "in",
      value: { _tag: "Last", count: 30, unit: "day" },
    },
  }),
  /** The customer's resolved campaign locale. */
  locale: setAttribute("locale", {
    label: "Locale",
    section: "Profile",
    values: optionValues(AdministrationCampaignLocale, ["cs-CZ", "en-US"]),
    operators: ["anyOf", "noneOf"],
    narrowsLocales: true,
    defaults: { operator: "anyOf", value: ["cs-CZ"] },
  }),
  /** Tags on the customer's Dotypos profile. */
  dotyposTags: setAttribute("dotyposTags", {
    label: "Dotypos tags",
    section: "Profile",
    values: freeTextValues(),
    operators: ["anyOf", "allOf", "noneOf"],
    defaults: { operator: "anyOf", value: [] },
  }),
  /** The discount group (ID) of the customer's Dotypos profile. */
  discountGroup: setAttribute("discountGroup", {
    label: "Discount group",
    section: "Profile",
    values: lookupValues("discountGroups"),
    operators: ["anyOf", "noneOf"],
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
