import {
  type AudienceCountAttributeDefinition,
  type AudienceCountCondition,
  type AudienceCountOperatorType,
  type AudienceDateCondition,
  type AudienceSetAttributeDefinition,
  type AudienceSetCondition,
  type AudienceValueLookup,
  CampaignEmailSource,
  type CampaignEmailSourceType,
  type ReservationProductFilterType,
  type ReservationProductPropertyCondition,
} from "@deskohub/workspace-admin-api";
import { Match, Schema } from "effect";
import { m } from "@/features/administration/i18n";
import type { Locale } from "@/features/i18n";
import { reservationProductProperty } from "@/features/reservation/reservation-product-descriptor";
import {
  type AudienceFilter,
  audienceConditionsOf,
  viewAudienceCondition,
} from "../audience-filter";
import type { CampaignDelivery, CampaignStatus } from "../campaign-states";
import type { DatePeriod } from "../date-period";
import {
  AudienceCampaignSourceSummary,
  type AudienceCountWording,
  type AudienceDateWording,
  type AudienceSetWording,
  audienceAttributeWording,
} from "./audiences/audience-attribute-wording";
import {
  reservationProductFamilyLabel,
  reservationProductPropertyLabel,
  reservationProductPropertyUnit,
} from "./audiences/reservation-product-wording";
import { describeDatePeriod } from "./date-period-phrases";

/** A looked-up value an audience can filter by, such as a discount group. */
export type AudienceValueOption = {
  readonly id: string;
  readonly name: string;
};

/** A Dotypos discount group an audience can filter by. */
export type DiscountGroupOption = AudienceValueOption;

/** A campaign an audience can count the emails of, with its state for badges. */
export type AudienceCampaignOption = AudienceValueOption & {
  readonly delivery: CampaignDelivery;
  readonly status: CampaignStatus;
};

/** The value lists Workspace looked up; a missing one shows raw values. */
export type AudienceValueLookups = {
  readonly [Lookup in AudienceValueLookup]?:
    | readonly AudienceValueOption[]
    | undefined;
} & {
  /** Campaign names for counts of one campaign's emails. */
  readonly campaigns?: readonly AudienceCampaignOption[] | undefined;
};

type ListType = "conjunction" | "disjunction";

/** Chosen values joined for a sentence; nothing chosen yet reads as a gap. */
const joined = (
  values: readonly string[],
  type: ListType,
  locale: Locale
): string =>
  values.length === 0
    ? m.emailCampaignsAudienceSummaryGap({}, { locale })
    : new Intl.ListFormat(locale, { type }).format(values);

const quoted = (value: string, locale: Locale) =>
  m.emailCampaignsAudienceSummaryQuoted({ value }, { locale });

/**
 * A literal count: "at least 3 emails", "fewer than 2 emails", "at most 0
 * emails", …. `noun` inflects the counted noun for a count.
 */
const describeAmount = (
  operator: AudienceCountOperatorType,
  value: number,
  noun: (count: number) => string,
  locale: Locale
): string =>
  // A half-typed number reads as a gap until the operator finishes it.
  Number.isInteger(value)
    ? m.emailCampaignsAudienceSummaryAmount(
        { operator, count: value, noun: noun(value), none: noun(0) },
        { locale }
      )
    : m.emailCampaignsAudienceSummaryAmountPending(
        { none: noun(0) },
        { locale }
      );

/** Comparisons that read naturally: "no emails", "any emails". */
const naturalCounts: Readonly<Record<string, "none" | "any">> = {
  "eq 0": "none",
  "lt 1": "none",
  "gt 0": "any",
  "gte 1": "any",
};

/** One property condition of a product filter ("tier Reserved Desk"). */
const describeProductProperty = (
  family: ReservationProductFilterType["family"],
  condition: ReservationProductPropertyCondition,
  locale: Locale
): string => {
  const options = { locale };
  const property = reservationProductPropertyLabel(
    family,
    condition.property,
    locale
  ).toLocaleLowerCase(locale);
  const names = (values: readonly string[], type: ListType) => {
    const descriptor = reservationProductProperty(family, condition.property);
    return joined(
      values.map(
        (id) =>
          (descriptor?.kind === "enum" &&
            descriptor.values.find((value) => value.id === id)?.name(locale)) ||
          id
      ),
      type,
      locale
    );
  };
  return Match.value(condition).pipe(
    Match.when({ operator: "anyOf" }, ({ value }) =>
      m.emailCampaignsAudienceSummaryProductAnyOf(
        { property, values: names(value, "disjunction") },
        options
      )
    ),
    Match.when({ operator: "noneOf" }, ({ value }) =>
      m.emailCampaignsAudienceSummaryProductNoneOf(
        { property, values: names(value, "conjunction") },
        options
      )
    ),
    Match.when({ operator: "is" }, ({ value }) =>
      value
        ? m.emailCampaignsAudienceSummaryProductEnabled({ property }, options)
        : m.emailCampaignsAudienceSummaryProductDisabled({ property }, options)
    ),
    Match.when(
      { operator: Match.is("eq", "ne", "lt", "lte", "gt", "gte") },
      ({ operator, value }) =>
        describeAmount(
          operator,
          value,
          (count) =>
            reservationProductPropertyUnit(
              family,
              condition.property,
              count,
              locale
            ),
          locale
        )
    ),
    Match.exhaustive
  );
};

/**
 * A product filter after the reservation it narrows, with a leading space:
 * " for cowork with tier Reserved Desk and coffee", or nothing.
 */
const describeProduct = (
  product: ReservationProductFilterType | undefined,
  locale: Locale
): string => {
  if (!product) return "";
  const family = reservationProductFamilyLabel(
    product.family,
    locale
  ).toLocaleLowerCase(locale);
  const details = product.properties.map((condition) =>
    describeProductProperty(product.family, condition, locale)
  );
  const phrase =
    details.length === 0
      ? m.emailCampaignsAudienceSummaryProduct({ family }, { locale })
      : m.emailCampaignsAudienceSummaryProductWith(
          { family, details: joined(details, "conjunction", locale) },
          { locale }
        );
  return ` ${phrase}`;
};

const isCampaignEmailSource = Schema.is(CampaignEmailSource);

/**
 * Whose emails a count counts. A campaign missing from the looked-up
 * `campaigns` was deleted; without the lookup it shows by ID.
 */
const summarizeCampaignSource = (
  source: CampaignEmailSourceType,
  campaigns: readonly AudienceValueOption[] | undefined,
  locale: Locale
): AudienceCampaignSourceSummary =>
  Match.value(source).pipe(
    Match.tagsExhaustive({
      This: () => AudienceCampaignSourceSummary.This(),
      Specific: ({ campaignId }) => {
        if (!campaigns)
          return AudienceCampaignSourceSummary.Specific({
            campaign: campaignId,
          });
        const campaign = campaigns.find(({ id }) => id === campaignId);
        return campaign
          ? AudienceCampaignSourceSummary.Specific({
              campaign: quoted(campaign.name, locale),
            })
          : AudienceCampaignSourceSummary.Deleted();
      },
    })
  );

/** Context for a count summary beyond the condition and its wording. */
type CountSummaryContext = {
  /** The attribute's entry, whose campaign params name a campaign source. */
  readonly entry?: AudienceCountAttributeDefinition;
  readonly lookups?: AudienceValueLookups;
};

/**
 * "have no booked reservations for cowork visiting in the last 30 days": the
 * attribute's wording around the count, the counted noun with its product
 * and campaign source, and the period.
 */
export const describeCountCondition = (
  { params, operator, value }: AudienceCountCondition,
  wording: AudienceCountWording,
  locale: Locale,
  { entry, lookups = {} }: CountSummaryContext = {}
): string => {
  const product = describeProduct(params.product, locale);
  // An unset campaign param counts every campaign.
  const campaign = Object.entries(entry?.params ?? {})
    .filter(([, param]) => param.part === "campaign")
    .map(([name]) => params[name])
    .find(isCampaignEmailSource);
  const source =
    campaign && summarizeCampaignSource(campaign, lookups.campaigns, locale);
  const noun = (count: number) =>
    wording.summary.noun(params, count, product, source);
  const period =
    params.period._tag === "AnyTime"
      ? ""
      : ` ${wording.summary.period(params, describeDatePeriod(params.period, locale))}`;
  const natural = naturalCounts[`${operator} ${value}`];
  if (natural) {
    return wording.summary[natural]({ single: noun(1), none: noun(0), period });
  }
  return wording.summary.amount(
    describeAmount(operator, value, noun, locale),
    period
  );
};

/**
 * "last visited in the last 30 days", "have visited, with the last visit not
 * …", "have never visited": the attribute's wording, with a reservation
 * product after its verb.
 */
const describeDateCondition = (
  condition: AudienceDateCondition,
  { summary }: AudienceDateWording,
  locale: Locale
): string => {
  const product = describeProduct(condition.params?.product, locale);
  return Match.value(condition).pipe(
    Match.when({ operator: "in" }, ({ value }) =>
      value._tag === "AnyTime"
        ? summary.ever(product)
        : summary.inPeriod(product, describeDatePeriod(value, locale))
    ),
    Match.when({ operator: "notIn" }, ({ value }) =>
      summary.notInPeriod(product, describeDatePeriod(value, locale))
    ),
    Match.when({ operator: "none" }, () => summary.never(product)),
    Match.exhaustive
  );
};

/**
 * "speak Czech or English", "are tagged “vip” and “coworker”", "aren’t in
 * discount group “Staff”": the operator's wording and the values by name.
 */
const describeSetCondition = (
  { values }: AudienceSetAttributeDefinition,
  { operator, value }: AudienceSetCondition,
  wording: AudienceSetWording,
  lookups: AudienceValueLookups,
  locale: Locale
): string => {
  const names = value.map((chosen) =>
    Match.value(values).pipe(
      Match.tagsExhaustive({
        Options: () =>
          (wording.values._tag === "Options" &&
            wording.values.options[chosen]?.name) ||
          chosen,
        FreeText: () => quoted(chosen, locale),
        Lookup: ({ lookup }) => {
          const option = lookups[lookup]?.find(({ id }) => id === chosen);
          return option ? quoted(option.name, locale) : chosen;
        },
      })
    )
  );
  const list = joined(
    names,
    operator === "allOf" ? "conjunction" : "disjunction",
    locale
  );
  return wording.summary[operator]?.(list) ?? list;
};

/** What a customer must satisfy, as a plural predicate ("speak Czech and …"). */
const describeCondition = (
  condition: Parameters<typeof viewAudienceCondition>[0],
  lookups: AudienceValueLookups,
  locale: Locale
): string => {
  const wording = audienceAttributeWording(condition.attribute, locale);
  return Match.value(viewAudienceCondition(condition)).pipe(
    Match.discriminatorsExhaustive("kind")({
      count: ({ entry, condition: count }) =>
        wording?.kind === "count"
          ? describeCountCondition(count, wording, locale, { entry, lookups })
          : condition.attribute,
      date: ({ condition: date }) =>
        wording?.kind === "date"
          ? describeDateCondition(date, wording, locale)
          : condition.attribute,
      set: ({ entry, condition: set }) =>
        wording?.kind === "set"
          ? describeSetCondition(entry, set, wording, lookups, locale)
          : condition.attribute,
      boolean: ({ condition: boolean }) =>
        wording?.kind === "boolean"
          ? wording.summary[boolean.value ? "true" : "false"]
          : condition.attribute,
    })
  );
};

const describeFilter = (
  filter: AudienceFilter,
  lookups: AudienceValueLookups,
  locale: Locale
): string => {
  const options = { locale };
  if (filter._tag !== "Group")
    return describeCondition(filter, lookups, locale);
  if (filter.filters.length === 0) {
    return filter.operator === "and"
      ? m.emailCampaignsAudienceSummaryMatchAnything({}, options)
      : m.emailCampaignsAudienceSummaryMatchNothing({}, options);
  }
  const join =
    filter.operator === "and"
      ? m.emailCampaignsAudienceSummaryAnd
      : m.emailCampaignsAudienceSummaryOr;
  return filter.filters
    .map((child) =>
      child._tag === "Group" && child.filters.length > 1
        ? m.emailCampaignsAudienceSummaryGroup(
            { filter: describeFilter(child, lookups, locale) },
            options
          )
        : describeFilter(child, lookups, locale)
    )
    .reduce((left, right) => join({ left, right }, options));
};

const endsAtEvaluation = (period: DatePeriod): boolean =>
  Match.value(period).pipe(
    Match.tagsExhaustive({
      AnyTime: () => false,
      Past: () => true,
      Last: () => true,
      Range: () => false,
      Since: () => true,
      Onward: () => false,
      Until: () => false,
      // The trigger is a schedule's fire time, which moves with the clock.
      TriggerWindow: () => true,
    })
  );

/**
 * Whether a period in the filter moves with the evaluation time ("so far",
 * "last N days", "since", around the trigger), so the audience it describes
 * moves with the clock. A sent campaign evaluated those at its send time.
 */
export const hasPeriodEndingAtEvaluation = (filter: AudienceFilter): boolean =>
  audienceConditionsOf(filter).some((condition) =>
    Match.value(viewAudienceCondition(condition)).pipe(
      Match.discriminatorsExhaustive("kind")({
        count: ({ condition: count }) => endsAtEvaluation(count.params.period),
        date: ({ condition: date }) =>
          date.operator !== "none" && endsAtEvaluation(date.value),
        set: () => false,
        boolean: () => false,
      })
    )
  );

/**
 * One plain sentence in `locale` for an audience filter tree. Looked-up
 * values, such as discount groups, show by name when `lookups` lists them,
 * otherwise by ID.
 */
export const describeAudienceFilter = (
  filter: AudienceFilter,
  locale: Locale,
  lookups: AudienceValueLookups = {}
): string => {
  const options = { locale };
  if (filter._tag === "Group" && filter.filters.length === 0) {
    return filter.operator === "and"
      ? m.emailCampaignsAudienceSummaryEveryone({}, options)
      : m.emailCampaignsAudienceSummaryNobody({}, options);
  }
  return m.emailCampaignsAudienceSummaryCustomersWho(
    { predicate: describeFilter(filter, lookups, locale) },
    options
  );
};
