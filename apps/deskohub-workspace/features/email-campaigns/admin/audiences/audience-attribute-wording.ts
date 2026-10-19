import type {
  AudienceAttribute,
  AudienceAttributeCatalogue,
  AudienceAttributeSection,
  AudienceCountCondition,
  AudienceEditorToken,
  AudienceSetOperatorType,
} from "@deskohub/workspace-admin-api";
import { Data } from "effect";
import { m } from "@/features/administration/i18n";
import type { Locale } from "@/features/i18n";

/** An administration message in a locale. */
export type AudienceMessage<Inputs = Record<never, never>> = (
  inputs: Inputs,
  options: { readonly locale: Locale }
) => string;

/** A choice parameter's control: its name and each option's label. */
export type AudienceChoiceWording = {
  /** Names the control for screen readers. */
  readonly label: string;
  readonly options: Readonly<Record<string, string>>;
  /** The label of an optional choice left unset. */
  readonly absent?: string;
};

/** A campaign parameter's picker: its name, "any campaign", and a lost one. */
export type AudienceCampaignSourceWording = {
  /** Names the control for screen readers. */
  readonly label: string;
  /** The search field's placeholder. */
  readonly search: string;
  /** Shown when no campaign matches the search. */
  readonly empty: string;
  /** The label of the param left unset, which counts every campaign. */
  readonly absent: string;
  /** A chosen campaign missing from the list, such as a deleted one. */
  readonly unknown: string;
};

/** The counted noun with its forms around a count, for a count summary. */
type AudienceCountPhrase = {
  /** The noun as counted for one ("booked reservation"). */
  readonly single: string;
  /** The noun as counted for none ("booked reservations"). */
  readonly none: string;
  /** The period words with a leading space, or nothing for any time. */
  readonly period: string;
};

type CountParams = AudienceCountCondition["params"];

/**
 * Whose emails a count summary counts, once its campaign is looked up: the
 * evaluating campaign, one campaign by name (or ID when campaigns weren't
 * looked up), or a chosen campaign that no longer exists.
 */
export type AudienceCampaignSourceSummary = Data.TaggedEnum<{
  This: Record<never, never>;
  Specific: { readonly campaign: string };
  Deleted: Record<never, never>;
}>;

export const AudienceCampaignSourceSummary =
  Data.taggedEnum<AudienceCampaignSourceSummary>();

export type AudienceCountWording = {
  readonly kind: "count";
  readonly label: string;
  /** The editor line after "Number of": words between parameter controls. */
  readonly lead: readonly AudienceEditorToken[];
  readonly choices: Readonly<Record<string, AudienceChoiceWording>>;
  /** Each campaign parameter's picker, by parameter name. */
  readonly campaignSources?: Readonly<
    Record<string, AudienceCampaignSourceWording>
  >;
  /** What the period applies to, for screen readers. */
  readonly period: string;
  /** What is counted, for screen readers. */
  readonly count: string;
  readonly summary: {
    /**
     * The counted noun for `count`, with the product phrase and, for a
     * campaign parameter that names one, whose emails count.
     */
    readonly noun: (
      params: CountParams,
      count: number,
      product: string,
      source: AudienceCampaignSourceSummary | undefined
    ) => string;
    /** The period as the chosen parameters introduce it. */
    readonly period: (params: CountParams, period: string) => string;
    /** "have no booked reservations …" */
    readonly none: (phrase: AudienceCountPhrase) => string;
    /** "have any booked reservations …" */
    readonly any: (phrase: AudienceCountPhrase) => string;
    /** "have at least 3 booked reservations …" */
    readonly amount: (amount: string, period: string) => string;
  };
};

export type AudienceDateWording = {
  readonly kind: "date";
  readonly label: string;
  /** The operator choice for no value ("never visited"). */
  readonly noValue: string;
  /** Each summary takes the product phrase, with a leading space, or nothing. */
  readonly summary: {
    readonly ever: (product: string) => string;
    readonly inPeriod: (product: string, period: string) => string;
    readonly notInPeriod: (product: string, period: string) => string;
    readonly never: (product: string) => string;
  };
};

/** Free-text value entry: the field and its chips. */
export type AudienceValueEntryWording = {
  readonly placeholder: string;
  /** Names the field for screen readers ("Add tag"). */
  readonly add: string;
  readonly remove: (value: string) => string;
};

type AudienceSetValuesWording =
  | {
      readonly _tag: "Options";
      readonly options: Readonly<
        Record<string, { readonly label: string; readonly name: string }>
      >;
    }
  | { readonly _tag: "FreeText"; readonly entry: AudienceValueEntryWording }
  | {
      readonly _tag: "Lookup";
      /** The button that opens the looked-up list. */
      readonly choose: string;
      readonly remove: (name: string) => string;
      readonly unknown: (id: string) => string;
      /** Entry by ID when the list couldn't be looked up. */
      readonly entry: AudienceValueEntryWording;
    };

export type AudienceSetWording = {
  readonly kind: "set";
  readonly label: string;
  readonly lead: string;
  readonly values: AudienceSetValuesWording;
  /** Shown when no value is chosen. */
  readonly emptyError: string;
  /** The predicate for each operator, around the joined values. */
  readonly summary: Partial<
    Readonly<Record<AudienceSetOperatorType, (values: string) => string>>
  >;
};

export type AudienceBooleanWording = {
  readonly kind: "boolean";
  readonly label: string;
  readonly true: string;
  readonly false: string;
  /** What the choice is about ("a Workspace account"). */
  readonly object: string;
  readonly summary: { readonly true: string; readonly false: string };
};

export type AudienceAttributeWording =
  | AudienceCountWording
  | AudienceDateWording
  | AudienceSetWording
  | AudienceBooleanWording;

type AudienceAttributeWordings = {
  readonly [Attribute in AudienceAttribute]: Extract<
    AudienceAttributeWording,
    { readonly kind: AudienceAttributeCatalogue[Attribute]["kind"] }
  >;
};

const reservationNouns = {
  in_progress: m.emailCampaignsAudienceReservationCountNounInProgress,
  complete: m.emailCampaignsAudienceReservationCountNounComplete,
  cancelled: m.emailCampaignsAudienceReservationCountNounCancelled,
  needs_refund: m.emailCampaignsAudienceReservationCountNounNeedsRefund,
} as const;

const campaignEmailNouns = {
  marketing: m.emailCampaignsAudienceCampaignEmailCountNounMarketing,
  operational: m.emailCampaignsAudienceCampaignEmailCountNounOperational,
  any: m.emailCampaignsAudienceCampaignEmailCountNounAny,
} as const;

const chosen = <Options extends object>(
  options: Options,
  key: string | undefined
): Options[keyof Options] | undefined =>
  Object.entries(options).find(([option]) => option === key)?.[1];

/** The option a choice parameter holds, as an entry of `options`. */
const optionOf = <Options extends object>(
  options: Options,
  params: CountParams,
  param: string
): Options[keyof Options] | undefined =>
  Object.entries(options).find(([option]) => option === params[param])?.[1];

/**
 * The Admin UI wording of every catalogued attribute in a locale: labels,
 * editor words, and summary phrases. The catalogue keeps the structure; the
 * words come from the administration messages.
 */
const audienceAttributeWordings = (
  locale: Locale
): AudienceAttributeWordings => {
  const options = { locale };
  return {
    reservationCount: {
      kind: "count",
      label: m.emailCampaignsAudienceReservationCountLabel({}, options),
      lead: [
        { param: "status" },
        {
          text: m.emailCampaignsAudienceReservationCountLeadText({}, options),
        },
        { param: "dateBasis" },
      ],
      choices: {
        dateBasis: {
          label: m.emailCampaignsAudienceReservationCountDateBasisLabel(
            {},
            options
          ),
          options: {
            visit: m.emailCampaignsAudienceReservationCountDateBasisVisit(
              {},
              options
            ),
            booking: m.emailCampaignsAudienceReservationCountDateBasisBooking(
              {},
              options
            ),
          },
        },
        status: {
          label: m.emailCampaignsAudienceReservationCountStatusLabel(
            {},
            options
          ),
          absent: m.emailCampaignsAudienceReservationCountStatusBooked(
            {},
            options
          ),
          options: {
            in_progress:
              m.emailCampaignsAudienceReservationCountStatusInProgress(
                {},
                options
              ),
            complete: m.emailCampaignsAudienceReservationCountStatusComplete(
              {},
              options
            ),
            cancelled: m.emailCampaignsAudienceReservationCountStatusCancelled(
              {},
              options
            ),
            needs_refund:
              m.emailCampaignsAudienceReservationCountStatusNeedsRefund(
                {},
                options
              ),
          },
        },
      },
      period: m.emailCampaignsAudienceReservationCountPeriodLabel({}, options),
      count: m.emailCampaignsAudienceReservationCountLabel({}, options),
      summary: {
        noun: (params, count, product) =>
          (
            optionOf(reservationNouns, params, "status") ??
            m.emailCampaignsAudienceReservationCountNounBooked
          )({ count, product }, options),
        period: (params, period) =>
          params.dateBasis === "booking"
            ? m.emailCampaignsAudienceReservationCountBookingPeriod(
                { period },
                options
              )
            : m.emailCampaignsAudienceReservationCountVisitPeriod(
                { period },
                options
              ),
        none: (phrase) =>
          m.emailCampaignsAudienceReservationCountNone(phrase, options),
        any: (phrase) =>
          m.emailCampaignsAudienceReservationCountAny(phrase, options),
        amount: (amount, period) =>
          m.emailCampaignsAudienceReservationCountAmount(
            { amount, period },
            options
          ),
      },
    },
    firstVisit: {
      kind: "date",
      label: m.emailCampaignsAudienceFirstVisitLabel({}, options),
      noValue: m.emailCampaignsAudienceFirstVisitNoValue({}, options),
      summary: {
        ever: (product) =>
          m.emailCampaignsAudienceFirstVisitEver({ product }, options),
        inPeriod: (product, period) =>
          m.emailCampaignsAudienceFirstVisitInPeriod(
            { product, period },
            options
          ),
        notInPeriod: (product, period) =>
          m.emailCampaignsAudienceFirstVisitNotInPeriod(
            { product, period },
            options
          ),
        never: (product) =>
          m.emailCampaignsAudienceFirstVisitNever({ product }, options),
      },
    },
    lastVisit: {
      kind: "date",
      label: m.emailCampaignsAudienceLastVisitLabel({}, options),
      noValue: m.emailCampaignsAudienceLastVisitNoValue({}, options),
      summary: {
        ever: (product) =>
          m.emailCampaignsAudienceLastVisitEver({ product }, options),
        inPeriod: (product, period) =>
          m.emailCampaignsAudienceLastVisitInPeriod(
            { product, period },
            options
          ),
        notInPeriod: (product, period) =>
          m.emailCampaignsAudienceLastVisitNotInPeriod(
            { product, period },
            options
          ),
        never: (product) =>
          m.emailCampaignsAudienceLastVisitNever({ product }, options),
      },
    },
    campaignEmailCount: {
      kind: "count",
      label: m.emailCampaignsAudienceCampaignEmailCountLabel({}, options),
      lead: [
        { param: "purpose" },
        {
          text: m.emailCampaignsAudienceCampaignEmailCountLeadText({}, options),
        },
        { param: "campaign" },
      ],
      campaignSources: {
        campaign: {
          label: m.emailCampaignsAudienceCampaignEmailCountSourceLabel(
            {},
            options
          ),
          search: m.emailCampaignsAudienceCampaignEmailCountSourceSearch(
            {},
            options
          ),
          empty: m.emailCampaignsAudienceCampaignEmailCountSourceEmpty(
            {},
            options
          ),
          absent: m.emailCampaignsAudienceCampaignEmailCountSourceAny(
            {},
            options
          ),
          unknown: m.emailCampaignsAudienceCampaignEmailCountSourceUnknown(
            {},
            options
          ),
        },
      },
      choices: {
        purpose: {
          label: m.emailCampaignsAudienceCampaignEmailCountPurposeLabel(
            {},
            options
          ),
          options: {
            marketing:
              m.emailCampaignsAudienceCampaignEmailCountPurposeMarketing(
                {},
                options
              ),
            operational:
              m.emailCampaignsAudienceCampaignEmailCountPurposeOperational(
                {},
                options
              ),
            any: m.emailCampaignsAudienceCampaignEmailCountPurposeAny(
              {},
              options
            ),
          },
        },
      },
      period: m.emailCampaignsAudienceCampaignEmailCountPeriodLabel(
        {},
        options
      ),
      count: m.emailCampaignsAudienceCampaignEmailCountCountLabel({}, options),
      summary: {
        // One campaign's emails count whatever their purpose.
        noun: (params, count, _product, source) =>
          source
            ? AudienceCampaignSourceSummary.$match(source, {
                This: () =>
                  m.emailCampaignsAudienceCampaignEmailCountNounThis(
                    { count },
                    options
                  ),
                Specific: ({ campaign }) =>
                  m.emailCampaignsAudienceCampaignEmailCountNounSpecific(
                    { count, campaign },
                    options
                  ),
                Deleted: () =>
                  m.emailCampaignsAudienceCampaignEmailCountNounDeleted(
                    { count },
                    options
                  ),
              })
            : (
                optionOf(campaignEmailNouns, params, "purpose") ??
                m.emailCampaignsAudienceCampaignEmailCountNounAny
              )({ count }, options),
        period: (_params, period) => period,
        none: (phrase) =>
          m.emailCampaignsAudienceCampaignEmailCountNone(phrase, options),
        any: (phrase) =>
          m.emailCampaignsAudienceCampaignEmailCountAny(phrase, options),
        amount: (amount, period) =>
          m.emailCampaignsAudienceCampaignEmailCountAmount(
            { amount, period },
            options
          ),
      },
    },
    hasAccount: {
      kind: "boolean",
      label: m.emailCampaignsAudienceHasAccountLabel({}, options),
      true: m.emailCampaignsAudienceHasAccountTrue({}, options),
      false: m.emailCampaignsAudienceHasAccountFalse({}, options),
      object: m.emailCampaignsAudienceHasAccountObject({}, options),
      summary: {
        true: m.emailCampaignsAudienceHasAccountSummaryTrue({}, options),
        false: m.emailCampaignsAudienceHasAccountSummaryFalse({}, options),
      },
    },
    accountCreated: {
      kind: "date",
      label: m.emailCampaignsAudienceAccountCreatedLabel({}, options),
      noValue: m.emailCampaignsAudienceAccountCreatedNoValue({}, options),
      summary: {
        ever: () => m.emailCampaignsAudienceAccountCreatedEver({}, options),
        inPeriod: (_product, period) =>
          m.emailCampaignsAudienceAccountCreatedInPeriod({ period }, options),
        notInPeriod: (_product, period) =>
          m.emailCampaignsAudienceAccountCreatedNotInPeriod(
            { period },
            options
          ),
        never: () => m.emailCampaignsAudienceAccountCreatedNever({}, options),
      },
    },
    locale: {
      kind: "set",
      label: m.emailCampaignsAudienceLocaleLabel({}, options),
      lead: m.emailCampaignsAudienceLocaleLabel({}, options),
      values: {
        _tag: "Options",
        options: {
          "cs-CZ": {
            label: m.emailCampaignsAudienceLocaleOptionCzech({}, options),
            name: m.emailCampaignsAudienceLocaleNameCzech({}, options),
          },
          "en-US": {
            label: m.emailCampaignsAudienceLocaleOptionEnglish({}, options),
            name: m.emailCampaignsAudienceLocaleNameEnglish({}, options),
          },
        },
      },
      emptyError: m.emailCampaignsAudienceLocaleEmptyError({}, options),
      summary: {
        anyOf: (values) =>
          m.emailCampaignsAudienceLocaleSummaryAnyOf({ values }, options),
        noneOf: (values) =>
          m.emailCampaignsAudienceLocaleSummaryNoneOf({ values }, options),
      },
    },
    dotyposTags: {
      kind: "set",
      label: m.emailCampaignsAudienceDotyposTagsLabel({}, options),
      lead: m.emailCampaignsAudienceDotyposTagsLead({}, options),
      values: {
        _tag: "FreeText",
        entry: {
          placeholder: m.emailCampaignsAudienceDotyposTagsPlaceholder(
            {},
            options
          ),
          add: m.emailCampaignsAudienceDotyposTagsAdd({}, options),
          remove: (value) =>
            m.emailCampaignsAudienceDotyposTagsRemove({ value }, options),
        },
      },
      emptyError: m.emailCampaignsAudienceDotyposTagsEmptyError({}, options),
      summary: {
        anyOf: (values) =>
          m.emailCampaignsAudienceDotyposTagsSummaryAnyOf({ values }, options),
        allOf: (values) =>
          m.emailCampaignsAudienceDotyposTagsSummaryAllOf({ values }, options),
        noneOf: (values) =>
          m.emailCampaignsAudienceDotyposTagsSummaryNoneOf({ values }, options),
      },
    },
    discountGroup: {
      kind: "set",
      label: m.emailCampaignsAudienceDiscountGroupLabel({}, options),
      lead: m.emailCampaignsAudienceDiscountGroupLabel({}, options),
      values: {
        _tag: "Lookup",
        choose: m.emailCampaignsAudienceDiscountGroupChoose({}, options),
        remove: (value) =>
          m.emailCampaignsAudienceDiscountGroupRemove({ value }, options),
        unknown: (id) =>
          m.emailCampaignsAudienceDiscountGroupUnknown({ id }, options),
        entry: {
          placeholder: m.emailCampaignsAudienceDiscountGroupIdPlaceholder(
            {},
            options
          ),
          add: m.emailCampaignsAudienceDiscountGroupIdAdd({}, options),
          remove: (value) =>
            m.emailCampaignsAudienceDiscountGroupIdRemove({ value }, options),
        },
      },
      emptyError: m.emailCampaignsAudienceDiscountGroupEmptyError({}, options),
      summary: {
        anyOf: (values) =>
          m.emailCampaignsAudienceDiscountGroupSummaryAnyOf(
            { values },
            options
          ),
        noneOf: (values) =>
          m.emailCampaignsAudienceDiscountGroupSummaryNoneOf(
            { values },
            options
          ),
      },
    },
  };
};

/**
 * One attribute's wording, or nothing for an attribute the Admin UI has no
 * wording for, such as one from an extended catalogue.
 */
export const audienceAttributeWording = (
  attribute: string,
  locale: Locale
): AudienceAttributeWording | undefined =>
  chosen(audienceAttributeWordings(locale), attribute);

const sectionLabels: Readonly<
  Record<AudienceAttributeSection, AudienceMessage>
> = {
  Reservations: m.emailCampaignsAudienceSectionReservations,
  Emails: m.emailCampaignsAudienceSectionEmails,
  Account: m.emailCampaignsAudienceSectionAccount,
  Profile: m.emailCampaignsAudienceSectionProfile,
};

/** The attribute menu section's heading ("Reservations"). */
export const audienceAttributeSectionLabel = (
  section: AudienceAttributeSection,
  locale: Locale
) => sectionLabels[section]({}, { locale });
