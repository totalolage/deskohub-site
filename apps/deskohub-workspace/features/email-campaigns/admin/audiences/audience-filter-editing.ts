import {
  type AdministrationCampaignAudienceIdType,
  type AudienceAttribute,
  type AudienceAttributeDefinition,
  type AudienceFilterGroupOf,
  type AudienceFilterOf,
  type AutomationConditionLeaf,
  audienceAttributeCatalogue,
  type DatePeriodUnitType,
  type InSavedAudienceType as InSavedAudience,
} from "@deskohub/workspace-admin-api";
import { Match } from "effect";
import type {
  AudienceCondition,
  AudienceFilterGroup,
} from "../../audience-filter";
import type { DatePeriod } from "../../date-period";

export type { AudienceCondition, AudienceFilterGroup };

/** A leaf the builder edits: a catalogue condition or saved-audience membership. */
export type AudienceFilterLeaf = AutomationConditionLeaf;

/** The builder always edits a group, so a bare stored condition gets an AND root. */
export const asRootGroup = <Leaf extends AudienceFilterLeaf>(
  filter: AudienceFilterOf<Leaf>
): AudienceFilterGroupOf<Leaf> =>
  filter._tag === "Group"
    ? filter
    : { _tag: "Group", operator: "and", filters: [filter] };

const lastThirtyDays: DatePeriod = { _tag: "Last", count: 30, unit: "day" };

const monthBeforeTrigger: DatePeriod = {
  _tag: "TriggerWindow",
  side: "before",
  count: 1,
  unit: "month",
};

/** A condition with the entry's defaults. */
export const newConditionFrom = ({
  attribute,
  defaults,
}: AudienceAttributeDefinition) => ({
  attribute,
  _tag: "Condition" as const,
  ...defaults,
});

/** Starting values for a condition an operator adds or switches to. */
export const newCondition = (attribute: AudienceAttribute): AudienceCondition =>
  // Each entry's defaults are typed against its own attribute's condition.
  newConditionFrom(audienceAttributeCatalogue[attribute]) as AudienceCondition;

/**
 * The audience a new saved-audience membership leaf holds until the operator
 * picks one. It is no valid audience ID, so the form reports it as missing.
 */
export const unchosenSavedAudience = "" as AdministrationCampaignAudienceIdType;

/** "Is in saved audience" with no audience picked yet. */
export const newSavedAudienceMembership = (): InSavedAudience => ({
  _tag: "InAudience",
  operator: "in",
  audienceId: unchosenSavedAudience,
});

/** An empty group nested in `parent`, which usually flips the parent's logic. */
export const newNestedGroup = <Leaf extends AudienceFilterLeaf>(
  parent: AudienceFilterGroupOf<Leaf>
): AudienceFilterGroupOf<Leaf> => ({
  _tag: "Group",
  operator: parent.operator === "and" ? "or" : "and",
  filters: [],
});

export const appendFilter = <Leaf extends AudienceFilterLeaf>(
  group: AudienceFilterGroupOf<Leaf>,
  filter: AudienceFilterOf<Leaf>
): AudienceFilterGroupOf<Leaf> => ({
  ...group,
  filters: [...group.filters, filter],
});

export const replaceFilterAt = <Leaf extends AudienceFilterLeaf>(
  group: AudienceFilterGroupOf<Leaf>,
  index: number,
  filter: AudienceFilterOf<Leaf>
): AudienceFilterGroupOf<Leaf> => ({
  ...group,
  filters: group.filters.map((current, i) => (i === index ? filter : current)),
});

export const removeFilterAt = <Leaf extends AudienceFilterLeaf>(
  group: AudienceFilterGroupOf<Leaf>,
  index: number
): AudienceFilterGroupOf<Leaf> => ({
  ...group,
  filters: group.filters.filter((_, i) => i !== index),
});

/** Adds or removes one chosen value, keeping the original order. */
export const toggleSetValue = <Value>(
  selected: readonly Value[],
  value: Value,
  checked: boolean
): readonly Value[] => {
  const others = selected.filter((current) => current !== value);
  return checked ? [...others, value] : others;
};

export type DatePeriodKind = DatePeriod["_tag"];

/**
 * The period after the operator switches its kind, keeping the dates and
 * count it already had where the new kind uses them.
 */
export const switchDatePeriod = (
  period: DatePeriod,
  kind: DatePeriodKind,
  today: string
): DatePeriod => {
  const dates = Match.value(period).pipe(
    Match.tagsExhaustive({
      AnyTime: () => ({ from: today, to: today }),
      Past: () => ({ from: today, to: today }),
      Last: () => ({ from: today, to: today }),
      Range: ({ from, to }) => ({ from, to }),
      Since: ({ date }) => ({ from: date, to: date }),
      Onward: ({ date }) => ({ from: date, to: date }),
      Until: ({ date }) => ({ from: date, to: date }),
      TriggerWindow: () => ({ from: today, to: today }),
    })
  );
  return Match.value(kind).pipe(
    Match.when("AnyTime", (): DatePeriod => ({ _tag: "AnyTime" })),
    Match.when("Past", (): DatePeriod => ({ _tag: "Past" })),
    Match.when(
      "Last",
      (): DatePeriod => (period._tag === "Last" ? period : lastThirtyDays)
    ),
    Match.when(
      "Range",
      (): DatePeriod => ({ _tag: "Range", from: dates.from, to: dates.to })
    ),
    Match.when(
      "Since",
      (): DatePeriod => ({ _tag: "Since", date: dates.from })
    ),
    Match.when(
      "Onward",
      (): DatePeriod => ({ _tag: "Onward", date: dates.from })
    ),
    Match.when("Until", (): DatePeriod => ({ _tag: "Until", date: dates.to })),
    Match.when(
      "TriggerWindow",
      (): DatePeriod =>
        period._tag === "TriggerWindow" ? period : monthBeforeTrigger
    ),
    Match.exhaustive
  );
};

export const isDatePeriodUnit = (value: string): value is DatePeriodUnitType =>
  value === "day" || value === "week" || value === "month" || value === "year";
