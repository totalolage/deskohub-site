import type {
  AudienceAttribute,
  AudienceCountCondition,
  CampaignEmailSourceType,
} from "@deskohub/workspace-admin-api";
import { Effect, Match } from "effect";
import {
  type AudienceFilter,
  audienceConditionsOf,
  viewAudienceCondition,
} from "./audience-filter";
import type { CampaignId } from "./campaign-identifiers";
import type { DatePeriod } from "./date-period";
import { AudienceFilterContextInvalid } from "./errors";

type CampaignEmailSource = CampaignEmailSourceType;

/** The attributes, period kinds, and campaign sources a filter tree uses. */
export type AudienceFilterUsage = {
  readonly attributes: ReadonlySet<AudienceAttribute>;
  readonly periods: ReadonlySet<DatePeriod["_tag"]>;
  readonly campaignSources: ReadonlySet<CampaignEmailSource["_tag"]>;
  readonly specificCampaignIds: readonly CampaignId[];
};

/** Attributes, period kinds, and campaign sources, as plain lists. */
export type AudienceFilterUses = {
  readonly attributes: readonly AudienceAttribute[];
  readonly periods: readonly DatePeriod["_tag"][];
  readonly campaignSources: readonly CampaignEmailSource["_tag"][];
};

type ConditionUsage = {
  readonly periods: readonly DatePeriod[];
  readonly campaignSources: readonly CampaignEmailSource[];
};

/**
 * The periods and campaign sources a count condition's params hold. The
 * catalogue entry's params say which param is a period and which a
 * campaign, and each param holds its part's value.
 */
const countConditionUsage = (
  params: AudienceCountCondition["params"],
  entryParams: Readonly<Record<string, { readonly part: string }>>
): ConditionUsage => {
  const valuesOf = (part: string) =>
    Object.entries(entryParams).flatMap(([name, param]) =>
      param.part === part && params[name] !== undefined ? [params[name]] : []
    );
  return {
    periods: valuesOf("period") as DatePeriod[],
    campaignSources: valuesOf("campaign") as CampaignEmailSource[],
  };
};

/**
 * What a filter tree uses, read from each condition's catalogue entry by
 * kind: count params of the period and campaign parts, and the period of a
 * date condition that has a value.
 */
export const audienceFilterUsage = (
  filter: AudienceFilter
): AudienceFilterUsage => {
  const conditions = audienceConditionsOf(filter);
  const usages = conditions.map(
    (condition): ConditionUsage =>
      Match.value(viewAudienceCondition(condition)).pipe(
        Match.discriminatorsExhaustive("kind")({
          count: ({ entry, condition }) =>
            countConditionUsage(condition.params, entry.params),
          date: ({ condition }) => ({
            periods: condition.operator === "none" ? [] : [condition.value],
            campaignSources: [],
          }),
          set: () => ({ periods: [], campaignSources: [] }),
          boolean: () => ({ periods: [], campaignSources: [] }),
        })
      )
  );
  const periods = usages.flatMap((usage) => usage.periods);
  const campaignSources = usages.flatMap((usage) => usage.campaignSources);
  return {
    attributes: new Set(conditions.map(({ attribute }) => attribute)),
    periods: new Set(periods.map(({ _tag }) => _tag)),
    campaignSources: new Set(campaignSources.map(({ _tag }) => _tag)),
    specificCampaignIds: [
      ...new Set(
        campaignSources.flatMap((source) =>
          source._tag === "Specific" ? [source.campaignId] : []
        )
      ),
    ],
  };
};

/**
 * What saved audiences, and so one-off campaigns, can't hold. Trigger
 * windows and "this campaign" need an automation's trigger and campaign, so
 * only automation conditions use them.
 */
const savedAudienceUnavailableUses = {
  attributes: [],
  periods: ["TriggerWindow"],
  campaignSources: ["This"],
} as const satisfies AudienceFilterUses;

/** What holds a filter tree: a saved audience or an automation's condition step. */
export type AudienceFilterHolder = "saved-audience" | "automation-condition";

/**
 * What each holder can't hold. An automation condition has the trigger and
 * the campaign, so it holds everything.
 */
const unavailableUses: Readonly<
  Record<AudienceFilterHolder, AudienceFilterUses>
> = {
  "saved-audience": savedAudienceUnavailableUses,
  "automation-condition": { attributes: [], periods: [], campaignSources: [] },
};

/** Whether `holder` can hold conditions on `attribute`. */
export const canHoldAttribute = (
  holder: AudienceFilterHolder,
  attribute: AudienceAttribute
) => !unavailableUses[holder].attributes.includes(attribute);

/** Whether `holder` can hold periods of kind `period`. */
export const canHoldPeriod = (
  holder: AudienceFilterHolder,
  period: DatePeriod["_tag"]
) => !unavailableUses[holder].periods.includes(period);

/** Whether `holder` can hold campaign email sources of kind `source`. */
export const canHoldCampaignSource = (
  holder: AudienceFilterHolder,
  source: CampaignEmailSource["_tag"]
) => !unavailableUses[holder].campaignSources.includes(source);

/**
 * Whether `holder` can hold "is (not) in saved audience" leaves. Saved
 * audiences don't nest, so only automation conditions hold them.
 */
export const canHoldSavedAudienceMembership = (holder: AudienceFilterHolder) =>
  holder === "automation-condition";

/** Whether a saved audience can hold conditions on `attribute`. */
export const isSavedAudienceAttribute = (attribute: AudienceAttribute) =>
  canHoldAttribute("saved-audience", attribute);

/** What `filter` uses that a saved audience can't hold, possibly nothing. */
export const savedAudienceUnavailableUsesIn = (
  filter: AudienceFilter
): AudienceFilterUses => {
  const usage = audienceFilterUsage(filter);
  return {
    attributes: savedAudienceUnavailableUses.attributes.filter((attribute) =>
      usage.attributes.has(attribute)
    ),
    periods: savedAudienceUnavailableUses.periods.filter((period) =>
      usage.periods.has(period)
    ),
    campaignSources: savedAudienceUnavailableUses.campaignSources.filter(
      (source) => usage.campaignSources.has(source)
    ),
  };
};

const hasUses = (uses: AudienceFilterUses) =>
  uses.attributes.length > 0 ||
  uses.periods.length > 0 ||
  uses.campaignSources.length > 0;

/** Whether a saved audience, and so a one-off campaign, can hold `filter`. */
export const isSavedAudienceFilter = (filter: AudienceFilter): boolean =>
  !hasUses(savedAudienceUnavailableUsesIn(filter));

/** Fails when `filter` uses anything a saved audience can't hold. */
export const ensureSavedAudienceFilter = (
  filter: AudienceFilter
): Effect.Effect<void, AudienceFilterContextInvalid> => {
  const uses = savedAudienceUnavailableUsesIn(filter);
  return hasUses(uses)
    ? Effect.fail(new AudienceFilterContextInvalid({ uses }))
    : Effect.void;
};
