import "server-only";

import {
  type DotyposCustomer,
  type DotyposCustomerId,
  type DotyposReservation,
  DotyposService,
} from "@deskohub/dotypos";
import type { AudienceAttributeOfKind } from "@deskohub/workspace-admin-api";
import { Context, Effect, Layer, Match, Option } from "effect";
import { decodeBookedReservation } from "@/features/reservation/backend/booked-reservation";
import {
  InvalidDotyposReservationInterval,
  type ReservationVisit,
} from "@/features/reservation/backend/reservation-visits.service";
import { getMeetingRoomSetupStart } from "@/features/reservation/meeting-room-early-setup";
import type { StoredWorkspaceReservationDetails } from "@/features/reservation/persistence-contracts";
import { WorkspaceDotyposLayer } from "@/shared/backend/config/dotypos.config";
import {
  type AudienceCountRequest,
  type AudienceDateRequest,
  type AudienceFacts,
  type AudienceFilter,
  audienceConditionsOf,
  audienceFactKey,
  type ConcreteCountParams,
  collectAudienceFactRequests,
  viewAudienceCondition,
} from "../audience-filter";
import {
  type DatePeriodBounds,
  isWithinDatePeriodBounds,
} from "../date-period";
import { CampaignRecipientResolutionError } from "../errors";
import {
  type AudienceCountParams,
  type AudienceCountResolver,
  type AudienceResolution,
  audienceAttributeResolvers,
} from "./audience-attribute-resolvers";
import {
  type AudienceEvaluationContext,
  AudienceFactSource,
  AudienceScope,
} from "./audience-evaluation-context";
import { CampaignCandidateRepository } from "./campaign-candidate.repository";

/**
 * Visit queries start this long before the earliest Workspace reservation
 * was created, so a reservation that began shortly before it was booked
 * still counts.
 */
const visitLowerBoundMargin = { days: 7 } as const;

/** Dotypos customers requested per live profile read. */

/** Which Dotypos facts evaluating a filter reads. */
export type AudienceDotyposReads = {
  /** Visit times: visit-basis counts over a bounded period, first and last visits. */
  readonly visits: boolean;
  /** Profiles: tags and discount group. */
  readonly profiles: boolean;
};

export interface IAudienceFactsService {
  /**
   * Resolves every count and date attribute the filter uses in each of the
   * contexts, through each attribute's resolver, for the customers in
   * `scope` (everyone by default). Live visit dates come only from bounded
   * Dotypos range queries: each starts at the period's own start or, when it
   * has none, just before the earliest Workspace reservation, and visit-date
   * queries end at the evaluation time, inclusive. Fetched visit dates come
   * from the fetched visits, which must cover the scope.
   */
  readonly resolve: (input: {
    readonly filter: AudienceFilter;
    readonly contexts: readonly AudienceEvaluationContext[];
    readonly scope?: AudienceScope;
    /** `Live` by default. */
    readonly facts?: AudienceFactSource;
  }) => Effect.Effect<AudienceFacts, CampaignRecipientResolutionError>;
  /**
   * The customers' Dotypos profiles; a customer Dotypos doesn't return is
   * absent. `Live` reads them in sequential chunks of 100. `Fetched` facts
   * hold the unit's profiles, or none when its filters didn't need them.
   */
  readonly profiles: (input: {
    readonly customers: readonly DotyposCustomerId[];
    readonly facts?: AudienceFactSource;
  }) => Effect.Effect<
    ReadonlyMap<DotyposCustomerId, DotyposCustomer>,
    CampaignRecipientResolutionError
  >;
}

/** The count resolvers, keyed so a request's attribute picks its params' resolver. */
const countResolvers: {
  readonly [Attribute in AudienceAttributeOfKind<"count">]: AudienceCountResolver<
    AudienceCountParams<Attribute>
  >;
} = audienceAttributeResolvers;

/**
 * The Dotypos facts the filter reads in these contexts, by each attribute
 * resolver's declaration, so a unit fetches only those.
 */
export const audienceDotyposReads = (
  filter: AudienceFilter,
  contexts: readonly AudienceEvaluationContext[]
): AudienceDotyposReads => {
  const requests = collectAudienceFactRequests(filter, contexts);
  return {
    visits:
      requests.counts.some(readsVisits) ||
      requests.dates.some(
        ({ attribute }) => audienceAttributeResolvers[attribute].readsVisits
      ),
    profiles: audienceConditionsOf(filter).some((condition) =>
      Match.value(viewAudienceCondition(condition)).pipe(
        Match.discriminatorsExhaustive("kind")({
          count: () => false,
          date: () => false,
          set: ({ condition: { attribute } }) =>
            audienceAttributeResolvers[attribute].from === "profile",
          boolean: ({ condition: { attribute } }) =>
            audienceAttributeResolvers[attribute].from === "profile",
        })
      )
    ),
  };
};

/**
 * A visit's booked start, read with its stored details when early setup
 * holds it from before then; a visit without a readable interval fails the
 * resolution.
 */
const visitStart = (
  reservation: DotyposReservation,
  details?: StoredWorkspaceReservationDetails
): Effect.Effect<Temporal.Instant, CampaignRecipientResolutionError> =>
  Option.match(decodeBookedReservation(reservation, details).interval, {
    onNone: () =>
      Effect.fail(
        CampaignRecipientResolutionError.dotypos(
          new InvalidDotyposReservationInterval({
            message: "Dotypos returned an invalid reservation interval",
          })
        )
      ),
    onSome: ({ startsAt }) => Effect.succeed(startsAt),
  });

/**
 * The exclusive end of a Dotypos start-date query. Dotypos filters have no
 * inclusive upper bound, and its start dates carry at most millisecond
 * precision, so "at or before t" asks for "before t + 1 ms".
 */
const dotyposStartsBefore = (bounds: DatePeriodBounds) =>
  bounds.startsAtOrBefore?.add({ milliseconds: 1 }) ?? bounds.startsBefore;

/** Whether the request's attribute resolver reads Dotypos visits for it. */
const readsVisits = <
  Attribute extends AudienceAttributeOfKind<"count">,
>(request: {
  readonly attribute: Attribute;
  readonly params: ConcreteCountParams<AudienceCountParams<Attribute>>;
}) => countResolvers[request.attribute].readsVisits(request);

/** Counts through the request's attribute resolver. */
const resolveCount = <Attribute extends AudienceAttributeOfKind<"count">>(
  request: {
    readonly attribute: Attribute;
    readonly params: ConcreteCountParams<AudienceCountParams<Attribute>>;
    readonly reservationsAsOf?: Temporal.Instant;
  },
  resolution: AudienceResolution
) => countResolvers[request.attribute].count(request, resolution);

/** Dates through the request's attribute resolver. */
const resolveDates = (
  request: AudienceDateRequest,
  resolution: AudienceResolution
) => audienceAttributeResolvers[request.attribute].dates(request, resolution);

type VisitReads = Pick<AudienceResolution, "visitsIn" | "pastVisits">;

export class AudienceFactsService extends Context.Service<
  AudienceFactsService,
  IAudienceFactsService
>()("@deskohub-workspace/email-campaigns/AudienceFactsService") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const candidates = yield* CampaignCandidateRepository;
      const dotypos = yield* DotyposService;

      /** Where visit queries without their own start begin; none without reservations. */
      const visitLowerBound = candidates.earliestReservationAt.pipe(
        Effect.map((createdAt) =>
          createdAt
            ?.toZonedDateTimeISO("UTC")
            .subtract(visitLowerBoundMargin)
            .toInstant()
        ),
        Effect.mapError(CampaignRecipientResolutionError.database)
      );

      /** Each visit's booked start, with the stored details early setup needs. */
      const bookedStarts = (visits: readonly DotyposReservation[]) =>
        candidates
          .earlySetupDetails(
            visits.flatMap(({ id }) => (id === undefined ? [] : [id]))
          )
          .pipe(
            Effect.mapError(CampaignRecipientResolutionError.database),
            Effect.flatMap((details) =>
              Effect.forEach(visits, (visit) =>
                visitStart(
                  visit,
                  visit.id === undefined ? undefined : details.get(visit.id)
                ).pipe(Effect.map((startsAt) => [visit.id, startsAt] as const))
              )
            )
          );

      /**
       * The visits booked in the bounds, by ID, with their booked starts.
       * Dotypos holds an early-setup meeting room from before its booked
       * start, so the query starts that much earlier and the booked starts
       * decide what stays.
       */
      const listVisitsIn = (bounds: DatePeriodBounds) =>
        visitLowerBound.pipe(
          Effect.map((lowerBound) => bounds.startsAtOrAfter ?? lowerBound),
          Effect.flatMap((startsAtOrAfter) =>
            startsAtOrAfter === undefined
              ? Effect.succeed([])
              : dotypos
                  .listReservations({
                    startsAtOrAfter:
                      getMeetingRoomSetupStart(startsAtOrAfter).toString(),
                    ...Option.match(
                      Option.fromNullishOr(dotyposStartsBefore(bounds)),
                      {
                        onNone: () => ({}),
                        onSome: (startsBefore) => ({
                          startsBefore: startsBefore.toString(),
                        }),
                      }
                    ),
                  })
                  .pipe(
                    Effect.mapError(CampaignRecipientResolutionError.dotypos),
                    Effect.flatMap(bookedStarts)
                  )
          ),
          Effect.map(
            (starts) =>
              new Map(
                starts.flatMap(([id, startsAt]) =>
                  id !== undefined && isWithinDatePeriodBounds(bounds, startsAt)
                    ? [[id, startsAt] as const]
                    : []
                )
              )
          )
        );

      /** Every visit that has begun by `asOf`, with its booked start, in one query. */
      const visitsBegunBy = (asOf: Temporal.Instant) =>
        listVisitsIn({ startsAtOrBefore: asOf });

      /**
       * Live visit reads: range queries, and the past visits of each
       * request's evaluation time, each read at most once and only if a
       * resolver asks.
       */
      const liveVisitReads = (dates: readonly AudienceDateRequest[]) =>
        Effect.forEach(
          new Map(dates.map(({ asOf }) => [asOf.toString(), asOf])),
          ([key, asOf]) =>
            Effect.cached(visitsBegunBy(asOf)).pipe(
              Effect.map((visits) => [key, visits] as const)
            )
        ).pipe(
          Effect.map((entries): VisitReads => {
            const byInstant = new Map(entries);
            return {
              visitsIn: (bounds) =>
                listVisitsIn(bounds).pipe(
                  Effect.map((visits) => [...visits.keys()])
                ),
              pastVisits: (asOf) =>
                byInstant.get(asOf.toString()) ?? visitsBegunBy(asOf),
            };
          })
        );

      const visitReads = (
        facts: AudienceFactSource,
        dates: readonly AudienceDateRequest[]
      ): Effect.Effect<VisitReads, CampaignRecipientResolutionError> =>
        AudienceFactSource.$match(facts, {
          Live: () => liveVisitReads(dates),
          Fetched: ({ visits }) =>
            Effect.succeed(
              Option.match(visits, {
                onNone: () => unfetchedVisitReads,
                onSome: fetchedVisitReads,
              })
            ),
        });

      const liveProfiles = (customers: readonly DotyposCustomerId[]) =>
        dotypos
          .getCustomersByIds(customers, { concurrency: 1 })
          .pipe(Effect.mapError(CampaignRecipientResolutionError.dotypos));

      const keyed = <
        Request extends AudienceCountRequest | AudienceDateRequest,
        Value,
      >(
        requests: readonly Request[],
        resolve: (
          request: Request
        ) => Effect.Effect<Value, CampaignRecipientResolutionError>
      ) =>
        Effect.forEach(requests, (request) =>
          resolve(request).pipe(
            Effect.map((value) => [audienceFactKey(request), value] as const)
          )
        ).pipe(Effect.map((entries) => new Map(entries)));

      return {
        resolve: ({
          filter,
          contexts,
          scope = AudienceScope.All(),
          facts = AudienceFactSource.Live(),
        }) =>
          Effect.Do.pipe(
            Effect.tap(() =>
              Effect.when(
                Effect.die("Audience profiles are read but not fetched"),
                Effect.sync(
                  () =>
                    AudienceFactSource.$is("Fetched")(facts) &&
                    Option.isNone(facts.profiles) &&
                    audienceDotyposReads(filter, contexts).profiles
                )
              )
            ),
            Effect.let("requests", () =>
              collectAudienceFactRequests(filter, contexts)
            ),
            Effect.bind("visits", ({ requests }) =>
              visitReads(facts, requests.dates)
            ),
            Effect.let(
              "resolution",
              ({ visits }): AudienceResolution => ({
                candidates,
                scope,
                ...visits,
              })
            ),
            Effect.bind("facts", ({ requests, resolution }) =>
              Effect.all({
                counts: keyed(requests.counts, (request) =>
                  resolveCount(request, resolution)
                ),
                dates: keyed(requests.dates, (request) =>
                  resolveDates(request, resolution)
                ),
              })
            ),
            Effect.map(({ facts }) => facts),
            Effect.withSpan("AudienceFactsService.resolve")
          ),
        profiles: ({ customers, facts = AudienceFactSource.Live() }) =>
          AudienceFactSource.$match(facts, {
            Live: () => liveProfiles(customers),
            Fetched: ({ profiles }) =>
              Effect.succeed(
                Option.match(profiles, {
                  onNone: () => new Map<DotyposCustomerId, DotyposCustomer>(),
                  onSome: (fetched) =>
                    new Map(
                      customers.flatMap((id) => {
                        const profile = fetched.get(id);
                        return profile ? [[id, profile] as const] : [];
                      })
                    ),
                })
              ),
          }).pipe(Effect.withSpan("AudienceFactsService.profiles")),
      } satisfies IAudienceFactsService;
    })
  );

  static Live = this.Default.pipe(
    Layer.provide(
      Layer.mergeAll(CampaignCandidateRepository.Live, WorkspaceDotyposLayer)
    )
  );
}

/**
 * Visit reads over one unit's fetched visits: every Workspace-booked visit
 * of its customers, any status, as the live range queries return them.
 */
const fetchedVisitReads = (
  visitsByCustomer: ReadonlyMap<DotyposCustomerId, readonly ReservationVisit[]>
): VisitReads => {
  const visits = [...visitsByCustomer.values()].flat();
  return {
    visitsIn: (bounds) =>
      Effect.succeed(
        visits.flatMap(({ dotyposReservationId, startsAt }) =>
          isWithinDatePeriodBounds(bounds, startsAt)
            ? [dotyposReservationId]
            : []
        )
      ),
    pastVisits: (asOf) =>
      Effect.succeed(
        new Map(
          visits.flatMap(({ dotyposReservationId, startsAt }) =>
            Temporal.Instant.compare(startsAt, asOf) <= 0
              ? [[dotyposReservationId, startsAt] as const]
              : []
          )
        )
      ),
  };
};

/**
 * A unit that didn't fetch visits planned a filter that doesn't read them;
 * reading them anyway is a planning defect, never an empty visit set.
 */
const unfetchedVisitReads: VisitReads = {
  visitsIn: () => Effect.die("Audience visits were read but not fetched"),
  pastVisits: () => Effect.die("Audience visits were read but not fetched"),
};
