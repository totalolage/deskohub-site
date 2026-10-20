import type { DotyposCustomerId } from "@deskohub/dotypos";
import {
  type AudienceAttributeDefinition,
  type AudienceAttributeOfKind,
  type AudienceBooleanAttributeDefinition,
  type AudienceConditionOf,
  type AudienceConditionType,
  type AudienceCountAttributeDefinition,
  type AudienceCountCondition,
  type AudienceCountOperatorType,
  type AudienceDateAttributeDefinition,
  type AudienceDateCondition,
  type AudienceFilterGroup,
  type AudienceFilterType,
  type AudienceParam,
  type AudienceSetAttributeDefinition,
  type AudienceSetOperatorType,
  audienceAttributeCatalogue,
  AudienceFilter as audienceFilterContractSchema,
  type CampaignEmailSourceType,
  type ReservationProductFilterType,
} from "@deskohub/workspace-admin-api";
import { Match, Option, Schema } from "effect";
import { type Locale, locales } from "@/features/i18n";
import { reservationProductFilterSchema } from "@/features/reservation/reservation-product-descriptor";
import type { AudienceEvaluationContext } from "./backend/audience-evaluation-context";
import type { CampaignId } from "./campaign-identifiers";
import {
  type DatePeriod,
  type DatePeriodBounds,
  datePeriodBounds,
} from "./date-period";

/**
 * The filter tree a campaign audience selects its recipients with. The
 * administration contract defines it, with its attribute catalogue, once for
 * Workspace, the Admin UI, and `dhw`.
 */
export type AudienceFilter = AudienceFilterType;
export type AudienceCondition = AudienceConditionType;
export type { AudienceFilterGroup };

/**
 * A condition with its catalogue entry, tagged by kind. Code that works on
 * any attribute of a kind matches on `kind` and reads the entry's metadata.
 */
export type AudienceConditionView =
  | {
      readonly kind: "count";
      readonly entry: AudienceCountAttributeDefinition;
      readonly condition: AudienceConditionOf<AudienceAttributeOfKind<"count">>;
    }
  | {
      readonly kind: "date";
      readonly entry: AudienceDateAttributeDefinition;
      readonly condition: AudienceConditionOf<AudienceAttributeOfKind<"date">>;
    }
  | {
      readonly kind: "set";
      readonly entry: AudienceSetAttributeDefinition;
      readonly condition: AudienceConditionOf<AudienceAttributeOfKind<"set">>;
    }
  | {
      readonly kind: "boolean";
      readonly entry: AudienceBooleanAttributeDefinition;
      readonly condition: AudienceConditionOf<
        AudienceAttributeOfKind<"boolean">
      >;
    };

export const viewAudienceCondition = (
  condition: AudienceCondition
): AudienceConditionView => {
  const entry: AudienceAttributeDefinition =
    audienceAttributeCatalogue[condition.attribute];
  // The catalogue keys each entry by its attribute, so the entry's kind is
  // the kind of the condition's attribute.
  return { kind: entry.kind, entry, condition } as AudienceConditionView;
};

/**
 * Three-valued result: a Dotypos condition is `unknown` until the customer's
 * profile is loaded, so local conditions can drop candidates before any
 * Dotypos request.
 */
export type AudienceFilterOutcome = "match" | "noMatch" | "unknown";

/** Locally known facts about one candidate customer. */
export type AudienceCandidate = {
  readonly dotyposCustomerId: DotyposCustomerId;
  readonly locale: Locale;
  readonly hasAccount: boolean;
};

/**
 * A param value fixed by the evaluation context: a period becomes the
 * instants it covers, and a campaign source the campaign whose emails count
 * (`null` when it names the evaluating campaign and there is none).
 */
type ConcreteParam<Value> = Value extends DatePeriod
  ? DatePeriodBounds
  : Value extends CampaignEmailSourceType
    ? CampaignId | null
    : Value;

/** A count condition's params with its period and campaign source fixed. */
export type ConcreteCountParams<Params> = {
  readonly [Param in keyof Params]: ConcreteParam<Params[Param]>;
};

type CountRequestOf<Condition extends AudienceCountCondition> =
  Condition extends unknown
    ? {
        readonly attribute: Condition["attribute"];
        readonly params: ConcreteCountParams<Condition["params"]>;
      }
    : never;

/**
 * What one count condition counts in one evaluation context. Conditions
 * whose requests are equal share one lookup, so subjects with different
 * contexts share it whenever their bounds agree.
 */
export type AudienceCountRequest = CountRequestOf<
  AudienceConditionOf<AudienceAttributeOfKind<"count">>
>;

/** Which date attribute one condition tests, in which bounds. */
export type AudienceDateRequest<
  Attribute extends string = AudienceAttributeOfKind<"date">,
> = {
  readonly attribute: Attribute;
  readonly bounds: DatePeriodBounds;
  /** Values that come into being after this instant don't exist yet. */
  readonly asOf: Temporal.Instant;
  /** Only reservations of this product count (reservation-based dates). */
  readonly product?: ReservationProductFilterType;
};

/** Customers whose date attribute has a value, and whose value is in the period. */
export type AudienceDateFacts = {
  readonly withValue: ReadonlySet<DotyposCustomerId>;
  readonly inPeriod: ReadonlySet<DotyposCustomerId>;
};

/**
 * Resolved count and date attributes, keyed by {@link audienceFactKey}. A
 * candidate missing from a count map has a count of zero, so "= 0" and "< N"
 * match customers without any records.
 */
export type AudienceFacts = {
  readonly counts: ReadonlyMap<string, ReadonlyMap<DotyposCustomerId, number>>;
  readonly dates: ReadonlyMap<string, AudienceDateFacts>;
};

/**
 * Requests are built from decoded schema values in the entry's param order,
 * so their key order is stable; instants serialize as ISO strings.
 */
export const audienceFactKey = (
  request:
    | { readonly attribute: string; readonly params: object }
    | AudienceDateRequest<string>
): string => JSON.stringify(request);

const anyTime: DatePeriod = { _tag: "AnyTime" };

const concreteCampaignSource = (
  source: CampaignEmailSourceType,
  { campaignId }: AudienceEvaluationContext
): CampaignId | null =>
  Match.value(source).pipe(
    Match.tagsExhaustive({
      Specific: ({ campaignId: specific }) => specific,
      This: () => Option.getOrNull(campaignId),
    })
  );

/**
 * What a count param holds: a choice, a period, a campaign source, or the
 * product filter, which isn't a catalogued param.
 */
type CountParamValue =
  | string
  | DatePeriod
  | CampaignEmailSourceType
  | ReservationProductFilterType;

/** One param value fixed by the context, by its param's part. */
const concreteParam = (
  param: AudienceParam | undefined,
  value: CountParamValue,
  context: AudienceEvaluationContext
) =>
  param === undefined
    ? // The product filter isn't a catalogued param; it needs no context.
      value
    : Match.value(param).pipe(
        Match.discriminatorsExhaustive("part")({
          choice: () => value,
          // The condition decoded with the param's schema, so the value is
          // of its part.
          period: () => datePeriodBounds(value as DatePeriod, context),
          campaign: () =>
            concreteCampaignSource(value as CampaignEmailSourceType, context),
        })
      );

/**
 * The count condition's request in one evaluation context, with each param
 * fixed by its part in the condition's catalogue entry.
 */
export const countFactRequest = <Condition extends AudienceCountCondition>(
  entry: Pick<AudienceCountAttributeDefinition, "params">,
  { attribute, params }: Condition,
  context: AudienceEvaluationContext
): CountRequestOf<Condition> =>
  ({
    attribute,
    params: Object.fromEntries(
      // A decoded condition's params hold only its entry's param values and
      // its product filter.
      (Object.entries(params) as [string, CountParamValue][]).map(
        ([key, value]) => [
          key,
          concreteParam(entry.params[key], value, context),
        ]
      )
    ),
  }) as CountRequestOf<Condition>;

/** "Has no value" needs only the customers with one, so it asks for any time. */
export const dateFactRequest = <Condition extends AudienceDateCondition>(
  condition: Condition,
  context: AudienceEvaluationContext
): AudienceDateRequest<Condition["attribute"]> => ({
  attribute: condition.attribute,
  bounds: datePeriodBounds(
    condition.operator === "none" ? anyTime : condition.value,
    context
  ),
  asOf: context.now,
  ...(condition.params && { product: condition.params.product }),
});

export const audienceConditionsOf = (
  filter: AudienceFilter
): readonly AudienceCondition[] =>
  filter._tag === "Group"
    ? filter.filters.flatMap(audienceConditionsOf)
    : [filter];

/**
 * Every count and date lookup the tree needs in any of the contexts,
 * deduplicated. One context for everyone (a one-off send) asks once per
 * distinct condition.
 */
export const collectAudienceFactRequests = (
  filter: AudienceFilter,
  contexts: readonly AudienceEvaluationContext[]
): {
  readonly counts: readonly AudienceCountRequest[];
  readonly dates: readonly AudienceDateRequest[];
} => {
  const counts = new Map<string, AudienceCountRequest>();
  const dates = new Map<string, AudienceDateRequest>();
  const views = audienceConditionsOf(filter).map(viewAudienceCondition);
  for (const context of contexts) {
    for (const view of views) {
      Match.value(view).pipe(
        Match.discriminatorsExhaustive("kind")({
          count: ({ entry, condition }) => {
            const request = countFactRequest(entry, condition, context);
            counts.set(audienceFactKey(request), request);
          },
          date: ({ condition }) => {
            const request = dateFactRequest(condition, context);
            dates.set(audienceFactKey(request), request);
          },
          set: () => undefined,
          boolean: () => undefined,
        })
      );
    }
  }
  return { counts: [...counts.values()], dates: [...dates.values()] };
};

/** Compares a count with a condition's number. */
export const compareCount = (
  operator: AudienceCountOperatorType,
  actual: number,
  expected: number
): boolean =>
  Match.value(operator).pipe(
    Match.when("eq", () => actual === expected),
    Match.when("ne", () => actual !== expected),
    Match.when("lt", () => actual < expected),
    Match.when("lte", () => actual <= expected),
    Match.when("gt", () => actual > expected),
    Match.when("gte", () => actual >= expected),
    Match.exhaustive
  );

/** Compares an attribute's values with a condition's chosen values. */
export const matchesSet = <Value>(
  operator: AudienceSetOperatorType,
  actual: readonly Value[],
  selected: readonly Value[]
): boolean =>
  Match.value(operator).pipe(
    Match.when("anyOf", () => selected.some((value) => actual.includes(value))),
    Match.when("allOf", () =>
      selected.every((value) => actual.includes(value))
    ),
    Match.when(
      "noneOf",
      () => !selected.some((value) => actual.includes(value))
    ),
    Match.exhaustive
  );

/**
 * Combines a group's outcomes: AND fails on any `noMatch` and OR passes on
 * any `match`; otherwise an `unknown` keeps the group unknown.
 */
const combineAudienceOutcomes = (
  operator: AudienceFilterGroup["operator"],
  outcomes: readonly AudienceFilterOutcome[]
): AudienceFilterOutcome => {
  const decisive = operator === "and" ? "noMatch" : "match";
  if (outcomes.includes(decisive)) return decisive;
  if (outcomes.includes("unknown")) return "unknown";
  return operator === "and" ? "match" : "noMatch";
};

/**
 * The tree's outcome from its conditions' outcomes. An empty AND group
 * matches and an empty OR group doesn't.
 */
export const evaluateAudienceTree = (
  filter: AudienceFilter,
  conditionOutcome: (condition: AudienceCondition) => AudienceFilterOutcome
): AudienceFilterOutcome => {
  const evaluate = (node: AudienceFilter): AudienceFilterOutcome =>
    node._tag === "Group"
      ? combineAudienceOutcomes(node.operator, node.filters.map(evaluate))
      : conditionOutcome(node);
  return evaluate(filter);
};

const outcomeOf = (value: boolean): AudienceFilterOutcome =>
  value ? "match" : "noMatch";

/**
 * The locales a recipient of the audience can have. Only conditions on an
 * attribute that narrows locales decide a locale; every other condition is
 * unknown, so it allows every locale. An empty AND group matches everyone and
 * an empty OR group nobody, as the evaluation decides.
 */
export const audienceLocales = (filter: AudienceFilter): ReadonlySet<Locale> =>
  new Set(
    locales.filter(
      (locale) =>
        evaluateAudienceTree(filter, (condition) => {
          const view = viewAudienceCondition(condition);
          return view.kind === "set" && view.entry.narrowsLocales
            ? outcomeOf(
                matchesSet(
                  view.condition.operator,
                  [locale],
                  view.condition.value
                )
              )
            : "unknown";
        }) !== "noMatch"
    )
  );

/**
 * The single locale every recipient of the audience has, when its filter
 * allows only one. Campaign content then needs only that locale.
 */
export const audienceSingleLocale = (
  filter: AudienceFilter
): Locale | undefined => {
  const [locale, ...others] = audienceLocales(filter);
  return others.length === 0 ? locale : undefined;
};

const countProduct = ({ params }: AudienceCountCondition) => params.product;

const dateProduct = ({ params }: AudienceDateCondition) => params?.product;

/** The product filter of a reservation-based condition, if it has one. */
const audienceProductFilter = (
  view: AudienceConditionView
): ReservationProductFilterType | undefined =>
  Match.value(view).pipe(
    Match.discriminatorsExhaustive("kind")({
      count: ({ condition }) => countProduct(condition),
      date: ({ condition }) => dateProduct(condition),
      set: () => undefined,
      boolean: () => undefined,
    })
  );

/** The product filters of the tree's reservation-based conditions. */
const productFilters = (
  filter: AudienceFilter
): readonly ReservationProductFilterType[] =>
  audienceConditionsOf(filter).flatMap((condition) => {
    const product = audienceProductFilter(viewAudienceCondition(condition));
    return product ? [product] : [];
  });

const isCatalogProductFilter = Schema.is(reservationProductFilterSchema);

/**
 * The contract's filter schema, plus a check that every product filter names
 * a property of its family's catalog with a valid operator and values. The
 * Admin UI, the administration API, and stored filters all decode with it.
 */
export const audienceFilterSchema = audienceFilterContractSchema.check(
  Schema.makeFilter(
    (filter: AudienceFilter) =>
      productFilters(filter).every(isCatalogProductFilter),
    {
      message:
        "Reservation product conditions must name a catalog property with a valid value.",
    }
  )
);
