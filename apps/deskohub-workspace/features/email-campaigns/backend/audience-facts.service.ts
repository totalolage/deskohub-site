import "server-only";

import { type DotyposReservation, DotyposService } from "@deskohub/dotypos";
import type { AudienceAttributeOfKind } from "@deskohub/workspace-admin-api";
import { Context, Effect, Layer, Option, Schema } from "effect";
import { reservationIntervalSchema } from "@/features/reservation/reservation-interval";
import { WorkspaceDotyposLayer } from "@/shared/backend/config/dotypos.config";
import {
  type AudienceCountRequest,
  type AudienceDateRequest,
  type AudienceFacts,
  type AudienceFilter,
  audienceFactKey,
  type ConcreteCountParams,
  collectAudienceFactRequests,
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
  type AudienceVisits,
  audienceAttributeResolvers,
} from "./audience-attribute-resolvers";
import {
  type AudienceEvaluationContext,
  AudienceScope,
  type LiveVisits,
  VisitSource,
} from "./audience-evaluation-context";
import {
  type AudienceVisitSnapshotRow,
  AudienceVisitSnapshots,
} from "./audience-visit-snapshots";
import { CampaignCandidateRepository } from "./campaign-candidate.repository";

/**
 * Visit queries start this long before the earliest Workspace reservation
 * was created, so a reservation that began shortly before it was booked
 * still counts.
 */
const visitLowerBoundMargin = { days: 7 } as const;

/** The services a visit source needs; only snapshots need a reader. */
export type VisitSourceRequirement<Visits extends VisitSource> =
  Visits extends { readonly _tag: "Snapshot" } ? AudienceVisitSnapshots : never;

/**
 * Narrows an effect that reads `AudienceVisitSnapshots` only for a snapshot
 * source to what its visit source needs, so live callers provide nothing.
 */
export const requiringVisitSource = <Visits extends VisitSource, A, E>(
  effect: Effect.Effect<A, E, AudienceVisitSnapshots>
): Effect.Effect<A, E, VisitSourceRequirement<Visits>> =>
  effect as Effect.Effect<A, E, never>;

export interface IAudienceFactsService {
  /**
   * Resolves every count and date attribute the filter uses in each of the
   * contexts, through each attribute's resolver, for the customers in
   * `scope` (everyone by default). Live visits (the default) come only from
   * bounded Dotypos range queries: each starts at the period's own start or,
   * when it has none, just before the earliest Workspace reservation, and
   * visit-date queries end at the evaluation time, inclusive. A snapshot
   * source reads a completed visit load instead and calls no Dotypos.
   */
  readonly resolve: <Visits extends VisitSource = LiveVisits>(input: {
    readonly filter: AudienceFilter;
    readonly contexts: readonly AudienceEvaluationContext[];
    readonly scope?: AudienceScope;
    readonly visits?: Visits;
  }) => Effect.Effect<
    AudienceFacts,
    CampaignRecipientResolutionError,
    VisitSourceRequirement<Visits>
  >;
}

const decodeInterval = Schema.decodeUnknownEffect(reservationIntervalSchema);

/** The Dotypos start of a reservation, decoded through the interval schema. */
const visitStart = (reservation: DotyposReservation) =>
  decodeInterval({
    startsAt: reservation.startDate,
    endsAt: reservation.endDate,
  }).pipe(
    Effect.map(({ startsAt }) => Temporal.Instant.from(startsAt)),
    Effect.mapError(CampaignRecipientResolutionError.dotypos)
  );

/**
 * The exclusive end of a Dotypos start-date query. Dotypos filters have no
 * inclusive upper bound, and its start dates carry at most millisecond
 * precision, so "at or before t" asks for "before t + 1 ms".
 */
const dotyposStartsBefore = (bounds: DatePeriodBounds) =>
  bounds.startsAtOrBefore?.add({ milliseconds: 1 }) ?? bounds.startsBefore;

/** The count resolvers, keyed so a request's attribute picks its params' resolver. */
const countResolvers: {
  readonly [Attribute in AudienceAttributeOfKind<"count">]: AudienceCountResolver<
    AudienceCountParams<Attribute>
  >;
} = audienceAttributeResolvers;

/** Counts through the request's attribute resolver. */
const resolveCount = <Attribute extends AudienceAttributeOfKind<"count">>(
  request: {
    readonly attribute: Attribute;
    readonly params: ConcreteCountParams<AudienceCountParams<Attribute>>;
  },
  resolution: AudienceResolution
) => countResolvers[request.attribute].count(request, resolution);

/** Dates through the request's attribute resolver. */
const resolveDates = (
  request: AudienceDateRequest,
  resolution: AudienceResolution
) => audienceAttributeResolvers[request.attribute].dates(request, resolution);

/** A stored visit load's visits, filtered in memory. */
const snapshotVisits = (
  rows: Effect.Effect<
    readonly AudienceVisitSnapshotRow[],
    CampaignRecipientResolutionError
  >
): AudienceVisits => ({
  startingIn: (bounds) =>
    rows.pipe(
      Effect.map((visits) =>
        visits.flatMap(({ dotyposReservationId, startsAt }) =>
          isWithinDatePeriodBounds(bounds, startsAt)
            ? [dotyposReservationId]
            : []
        )
      )
    ),
  begunBy: (asOf) =>
    rows.pipe(
      Effect.map(
        (visits) =>
          new Map(
            visits.flatMap(({ dotyposReservationId, startsAt }) =>
              Temporal.Instant.compare(startsAt, asOf) <= 0
                ? [[dotyposReservationId, startsAt] as const]
                : []
            )
          )
      )
    ),
});

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

      const reservationsStartingIn = (bounds: DatePeriodBounds) =>
        visitLowerBound.pipe(
          Effect.map((lowerBound) => bounds.startsAtOrAfter ?? lowerBound),
          Effect.flatMap((startsAtOrAfter) =>
            startsAtOrAfter === undefined
              ? Effect.succeed([])
              : dotypos
                  .listReservations({
                    startsAtOrAfter: startsAtOrAfter.toString(),
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
                    Effect.mapError(CampaignRecipientResolutionError.dotypos)
                  )
          )
        );

      /** Every visit that has begun by `asOf`, with its start, in one query. */
      const liveVisitsBegunBy = (asOf: Temporal.Instant) =>
        reservationsStartingIn({ startsAtOrBefore: asOf }).pipe(
          Effect.flatMap((visits) =>
            Effect.forEach(visits, (visit) =>
              visitStart(visit).pipe(
                Effect.map((startsAt) => [visit.id, startsAt] as const)
              )
            )
          ),
          Effect.map(
            (starts) =>
              new Map(
                starts.flatMap(([id, startsAt]) =>
                  id === undefined ? [] : [[id, startsAt] as const]
                )
              )
          )
        );

      /**
       * Visits from Dotypos range queries. The begun visits of each request
       * instant are read at most once, and only if a resolver asks.
       */
      const liveVisits = (asOfs: readonly Temporal.Instant[]) =>
        Effect.forEach(
          new Map(asOfs.map((asOf) => [asOf.toString(), asOf])),
          ([key, asOf]) =>
            Effect.cached(liveVisitsBegunBy(asOf)).pipe(
              Effect.map((begun) => [key, begun] as const)
            )
        ).pipe(
          Effect.map((entries): AudienceVisits => {
            const begunByInstant = new Map(entries);
            return {
              startingIn: (bounds) =>
                reservationsStartingIn(bounds).pipe(
                  Effect.map((reservations) =>
                    reservations.flatMap(({ id }) =>
                      id === undefined ? [] : [id]
                    )
                  )
                ),
              begunBy: (asOf) =>
                begunByInstant.get(asOf.toString()) ?? liveVisitsBegunBy(asOf),
            };
          })
        );

      const visitsOf = (
        source: VisitSource,
        dates: readonly AudienceDateRequest[]
      ) =>
        VisitSource.$match(source, {
          Live: () => liveVisits(dates.map(({ asOf }) => asOf)),
          Snapshot: ({ id }) =>
            AudienceVisitSnapshots.use((snapshots) =>
              Effect.cached(snapshots.rows(id))
            ).pipe(Effect.map(snapshotVisits)),
        });

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
        resolve: <Visits extends VisitSource = LiveVisits>({
          filter,
          contexts,
          scope = AudienceScope.All(),
          visits: source,
        }: {
          readonly filter: AudienceFilter;
          readonly contexts: readonly AudienceEvaluationContext[];
          readonly scope?: AudienceScope;
          readonly visits?: Visits;
        }) =>
          requiringVisitSource<
            Visits,
            AudienceFacts,
            CampaignRecipientResolutionError
          >(
            Effect.Do.pipe(
              Effect.let("requests", () =>
                collectAudienceFactRequests(filter, contexts)
              ),
              Effect.bind("visits", ({ requests }) =>
                visitsOf(source ?? VisitSource.Live(), requests.dates)
              ),
              Effect.let(
                "resolution",
                ({ visits }): AudienceResolution => ({
                  candidates,
                  scope,
                  visits,
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
            )
          ),
      } satisfies IAudienceFactsService;
    })
  );

  static Live = this.Default.pipe(
    Layer.provide(
      Layer.mergeAll(CampaignCandidateRepository.Live, WorkspaceDotyposLayer)
    )
  );
}
