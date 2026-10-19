import type {
  DotyposCustomer,
  DotyposCustomerId,
  DotyposReservationId,
} from "@deskohub/dotypos";
import type {
  AudienceAttributeCatalogue,
  AudienceAttributeDefinition,
  AudienceConditionIn,
  AudienceConditionOf,
} from "@deskohub/workspace-admin-api";
import { Effect, Match } from "effect";
import type {
  AudienceCandidate,
  AudienceDateFacts,
  AudienceDateRequest,
  ConcreteCountParams,
} from "../audience-filter";
import {
  type DatePeriodBounds,
  isUnboundedPeriod,
  isWithinDatePeriodBounds,
} from "../date-period";
import { CampaignRecipientResolutionError } from "../errors";
import {
  type AudienceScope,
  scopedCustomers,
} from "./audience-evaluation-context";
import type { ICampaignCandidateRepository } from "./campaign-candidate.repository";

/** The Dotypos visits a resolution derives visit facts from. */
export type AudienceVisits = {
  /**
   * Dotypos reservations, any status, starting in the bounds. Without a
   * start of its own the set starts just before the earliest Workspace
   * reservation, so it never reads unbounded history.
   */
  readonly startingIn: (
    bounds: DatePeriodBounds
  ) => Resolved<readonly DotyposReservationId[]>;
  /** Every Dotypos reservation that has begun by `asOf`, with its start. */
  readonly begunBy: (
    asOf: Temporal.Instant
  ) => Resolved<ReadonlyMap<DotyposReservationId, Temporal.Instant>>;
};

/** What a resolver can query while resolving one audience. */
export type AudienceResolution = {
  readonly candidates: ICampaignCandidateRepository;
  /** Facts outside the scope may be missing, never wrong. */
  readonly scope: AudienceScope;
  readonly visits: AudienceVisits;
};

type Resolved<Value> = Effect.Effect<Value, CampaignRecipientResolutionError>;

/** Counts each customer's records for a count condition's request. */
export type AudienceCountResolver<Params> = {
  readonly count: (
    request: {
      readonly attribute: string;
      readonly params: ConcreteCountParams<Params>;
    },
    resolution: AudienceResolution
  ) => Resolved<ReadonlyMap<DotyposCustomerId, number>>;
};

/** Customers with a date value, and those whose value lies in the bounds. */
type AudienceDateResolver = {
  readonly dates: (
    request: AudienceDateRequest<string>,
    resolution: AudienceResolution
  ) => Resolved<AudienceDateFacts>;
};

/**
 * Reads a set or boolean attribute from what Workspace knows locally, or
 * from the Dotypos profile, which is `unknown` until it is loaded.
 */
export type AudienceValueResolver<Value> =
  | {
      readonly from: "candidate";
      readonly read: (candidate: AudienceCandidate) => Value;
    }
  | {
      readonly from: "profile";
      readonly read: (customer: DotyposCustomer) => Value;
    };

type CatalogueEntries = {
  readonly [Attribute in string]: AudienceAttributeDefinition;
};

type AttributeOfKindIn<
  Catalogue extends CatalogueEntries,
  Kind extends AudienceAttributeDefinition["kind"],
> = {
  readonly [Attribute in keyof Catalogue]: Catalogue[Attribute]["kind"] extends Kind
    ? Attribute
    : never;
}[keyof Catalogue];

type ConditionIn<
  Catalogue extends CatalogueEntries,
  Attribute extends keyof Catalogue,
> = Extract<AudienceConditionIn<Catalogue>, { readonly attribute: Attribute }>;

/** The params of a count attribute's conditions. */
export type AudienceCountParams<
  Attribute extends keyof Catalogue,
  Catalogue extends CatalogueEntries = AudienceAttributeCatalogue,
> =
  ConditionIn<Catalogue, Attribute> extends { readonly params: infer Params }
    ? Params
    : never;

type ValueIn<
  Catalogue extends CatalogueEntries,
  Attribute extends keyof Catalogue,
> =
  ConditionIn<Catalogue, Attribute> extends { readonly value: infer Value }
    ? Value
    : never;

/**
 * One resolver per catalogued attribute, of its kind's shape. An attribute
 * added to the catalogue without a resolver fails the typecheck here.
 */
export type AudienceAttributeResolvers<
  Catalogue extends CatalogueEntries = AudienceAttributeCatalogue,
> = {
  readonly [Attribute in AttributeOfKindIn<
    Catalogue,
    "count"
  >]: AudienceCountResolver<AudienceCountParams<Attribute, Catalogue>>;
} & {
  readonly [Attribute in AttributeOfKindIn<
    Catalogue,
    "date"
  >]: AudienceDateResolver;
} & {
  readonly [Attribute in AttributeOfKindIn<
    Catalogue,
    "set" | "boolean"
  >]: AudienceValueResolver<ValueIn<Catalogue, Attribute>>;
};

const database = CampaignRecipientResolutionError.database;

/**
 * Booked reservations by booking date count from local data; by visit date
 * in a bounded period they count among the Dotypos reservations starting in
 * it; by visit date at any time every booked reservation counts.
 */
const countReservations = (
  {
    params: { dateBasis, period, status, product },
  }: {
    readonly params: ConcreteCountParams<
      AudienceConditionOf<"reservationCount">["params"]
    >;
  },
  { candidates, scope, visits }: AudienceResolution
) => {
  const selection = {
    ...(status && { status }),
    ...(product && { product }),
    customers: scopedCustomers(scope),
  };
  const countSelected = (
    extra: Pick<
      Parameters<ICampaignCandidateRepository["countReservations"]>[0],
      "booked" | "dotyposReservationIds"
    >
  ) =>
    candidates
      .countReservations({ ...selection, ...extra })
      .pipe(Effect.mapError(database));
  return Match.value(dateBasis).pipe(
    Match.when("booking", () => countSelected({ booked: period })),
    Match.when("visit", () =>
      isUnboundedPeriod(period)
        ? countSelected({})
        : visits
            .startingIn(period)
            .pipe(
              Effect.flatMap((dotyposReservationIds) =>
                countSelected({ dotyposReservationIds })
              )
            )
    ),
    Match.exhaustive
  );
};

/**
 * Each customer's earliest or latest booked visit among the visits begun by
 * the request's `asOf`, of the product if given.
 */
const visitDates =
  (pick: "earliest" | "latest"): AudienceDateResolver["dates"] =>
  ({ bounds, asOf, product }, { candidates, scope, visits }) =>
    visits.begunBy(asOf).pipe(
      Effect.flatMap((startById) =>
        candidates
          .listBookedReservations([...startById.keys()], {
            ...(product && { product }),
            customers: scopedCustomers(scope),
          })
          .pipe(
            Effect.mapError(database),
            Effect.map((booked) => {
              const visitByCustomer = new Map<
                DotyposCustomerId,
                Temporal.Instant
              >();
              const replaces = (
                startsAt: Temporal.Instant,
                chosen: Temporal.Instant
              ) => {
                const order = Temporal.Instant.compare(startsAt, chosen);
                return pick === "latest" ? order > 0 : order < 0;
              };
              for (const {
                dotyposReservationId,
                dotyposCustomerId,
              } of booked) {
                const startsAt = startById.get(dotyposReservationId);
                const chosen = visitByCustomer.get(dotyposCustomerId);
                if (startsAt && (!chosen || replaces(startsAt, chosen))) {
                  visitByCustomer.set(dotyposCustomerId, startsAt);
                }
              }
              return visitByCustomer;
            })
          )
      ),
      Effect.map(
        (visitByCustomer): AudienceDateFacts => ({
          withValue: new Set(visitByCustomer.keys()),
          inPeriod: new Set(
            [...visitByCustomer].flatMap(([id, startsAt]) =>
              isWithinDatePeriodBounds(bounds, startsAt) ? [id] : []
            )
          ),
        })
      )
    );

/**
 * How Workspace resolves each catalogued attribute. Count and date
 * attributes query local data and the resolution's visits once per distinct
 * request; set and boolean attributes read each candidate.
 */
export const audienceAttributeResolvers: AudienceAttributeResolvers = {
  reservationCount: { count: countReservations },
  campaignEmailCount: {
    // The evaluating campaign without one (`null`) has sent nobody anything.
    count: (
      { params: { purpose, period, campaign } },
      { candidates, scope }
    ) =>
      campaign === null
        ? Effect.succeed(new Map<DotyposCustomerId, number>())
        : candidates
            .countReceivedCampaignEmails({
              ...(purpose !== "any" && { purpose }),
              ...(campaign && { campaignId: campaign }),
              dispatched: period,
              customers: scopedCustomers(scope),
            })
            .pipe(Effect.mapError(database)),
  },
  firstVisit: { dates: visitDates("earliest") },
  lastVisit: { dates: visitDates("latest") },
  accountCreated: {
    dates: ({ bounds }, { candidates, scope }) =>
      candidates
        .accountCreations(bounds, scopedCustomers(scope))
        .pipe(Effect.mapError(database)),
  },
  locale: { from: "candidate", read: ({ locale }) => [locale] },
  dotyposTags: { from: "profile", read: ({ tags }) => tags ?? [] },
  discountGroup: {
    from: "profile",
    read: ({ _discountGroupId }) =>
      _discountGroupId ? [_discountGroupId] : [],
  },
  hasAccount: { from: "candidate", read: ({ hasAccount }) => hasAccount },
};
