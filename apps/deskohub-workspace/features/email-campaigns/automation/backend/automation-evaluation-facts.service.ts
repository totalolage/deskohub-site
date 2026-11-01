import { createHash } from "node:crypto";
import {
  type DotyposCustomerId,
  DotyposService,
  dotyposIdReadBatchSize,
  dotyposIdReadRequests,
} from "@deskohub/dotypos";
import type {
  AutomationConditionFilter,
  AutomationConditionLeaf,
  InSavedAudience,
} from "@deskohub/workspace-admin-api";
import { inArray } from "drizzle-orm";
import { Context, Effect, Layer, Option } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { emailCampaignAudiences } from "@/db/schema";
import { ReservationVisits } from "@/features/reservation/backend/reservation-visits.service";
import { WorkspaceDotyposLayer } from "@/shared/backend/config/dotypos.config";
import { canonicalJson } from "@/shared/utils/canonical-json";
import {
  type AudienceCondition,
  type AudienceFilter,
  audienceLeavesOf,
} from "../../audience-filter";
import {
  type AudienceEvaluationContext,
  AudienceFactSource,
} from "../../backend/audience-evaluation-context";
import {
  type AudienceDotyposReads,
  audienceDotyposReads,
} from "../../backend/audience-facts.service";
import type { CampaignAudienceId } from "../../campaign-identifiers";
import { AutomationConditionAudienceMissing } from "../errors";
import { AutomationUnitFetchFailure } from "./automation-unit-handler";

/** The most Dotypos requests one packed unit makes (§5.3). */
const maxUnitRequestCost = 8;

/**
 * The most booked reservations a customer can have and still share a packed
 * unit: one profile request plus ⌈700 / 100⌉ visit pages fill the request
 * cap. A customer above it becomes a solo unit (§5.3).
 */
export const soloUnitBookingThreshold =
  (maxUnitRequestCost - 1) * dotyposIdReadBatchSize;

/**
 * What one automation unit evaluates: the version's entry audience
 * snapshot (intake and fire chunks), a condition step's filter, or both.
 * Recipient resolution also reads every customer's profile to check
 * reachability and deduplicate emails.
 */
type AutomationEvaluationFilters = {
  readonly entryAudience?: AudienceFilter;
  readonly condition?: AutomationConditionFilter;
  readonly reachability?: boolean;
};

/** A saved audience's definition as one evaluation read it. */
export type SavedAudienceDefinition = {
  readonly audienceId: CampaignAudienceId;
  readonly filter: AudienceFilter;
  /** Diagnoses a later edit of the audience on the run's timeline (D32). */
  readonly filterHash: string;
};

/**
 * One evaluation's filters with every saved audience they reference, read
 * live, and the Dotypos facts they need.
 */
export type AutomationEvaluationPlan = {
  readonly filters: AutomationEvaluationFilters;
  readonly savedAudiences: ReadonlyMap<
    CampaignAudienceId,
    SavedAudienceDefinition
  >;
  /**
   * Every catalogue condition the filters and their saved audiences use, so
   * one fact resolution serves them all and overlapping facts are read once.
   */
  readonly factFilter: AudienceFilter;
  readonly reads: AudienceDotyposReads;
};

/** Customers one unit evaluates and the Dotypos requests it plans for them. */
type AutomationFactsChunk = {
  readonly customers: readonly DotyposCustomerId[];
  readonly requestCost: number;
};

type ReadsForCustomers = {
  readonly reads: AudienceDotyposReads;
  readonly customers: readonly DotyposCustomerId[];
};

interface IAutomationEvaluationFacts {
  /**
   * Reads each saved audience the filters reference by its current
   * definition, in one query, and decides which Dotypos facts the
   * evaluation needs: none for purely local filters.
   */
  readonly plan: (input: {
    readonly filters: AutomationEvaluationFilters;
    readonly context: AudienceEvaluationContext;
  }) => Effect.Effect<
    AutomationEvaluationPlan,
    AutomationConditionAudienceMissing
  >;
  /** The Dotypos requests fetching these customers' facts makes. */
  readonly cost: (input: ReadsForCustomers) => Effect.Effect<number>;
  /**
   * Packs customers, in the given order, into units of at most 100 that each
   * make at most 8 Dotypos requests: one profile request if needed, plus
   * their visit reads. A customer too large for any unit alone (above 700
   * booked reservations with profiles) becomes a solo unit.
   */
  readonly pack: (
    input: ReadsForCustomers
  ) => Effect.Effect<readonly AutomationFactsChunk[]>;
  /**
   * Fetches one unit's facts with single-attempt requests, one at a time:
   * one profile page and their visits, each only if needed. The facts live
   * in memory for this invocation only.
   */
  readonly fetch: (
    input: ReadsForCustomers
  ) => Effect.Effect<AudienceFactSource, AutomationUnitFetchFailure>;
}

/** The Dotypos facts automation units evaluate audiences and conditions with. */
export class AutomationEvaluationFacts extends Context.Service<
  AutomationEvaluationFacts,
  IAutomationEvaluationFacts
>()("@deskohub-workspace/email-campaigns/AutomationEvaluationFacts") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db } = yield* WorkspaceDatabase;
      const dotypos = yield* DotyposService;
      const context = yield* Effect.context<
        WorkspaceDatabase | DotyposService
      >();

      /** A fresh `ReservationVisits` per call, so no visit outlives it. */
      const withVisits = <A, E>(
        read: (visits: ReservationVisits["Service"]) => Effect.Effect<A, E>
      ) =>
        Effect.flatMap(ReservationVisits, read).pipe(
          Effect.provide(ReservationVisits.Default),
          Effect.provideContext(context)
        );

      const readSavedAudiences = (ids: readonly CampaignAudienceId[]) =>
        ids.length === 0
          ? Effect.succeed([])
          : db
              .select({
                id: emailCampaignAudiences.id,
                filter: emailCampaignAudiences.filter,
              })
              .from(emailCampaignAudiences)
              .where(inArray(emailCampaignAudiences.id, [...ids]))
              .pipe(Effect.orDie);

      const plan: IAutomationEvaluationFacts["plan"] = ({
        filters,
        context: evaluationContext,
      }) =>
        Effect.Do.pipe(
          Effect.let("referenced", () =>
            savedAudienceReferences(filters.condition)
          ),
          Effect.bind("rows", ({ referenced }) =>
            readSavedAudiences(referenced)
          ),
          Effect.bind("savedAudiences", ({ referenced, rows }) =>
            definitionsOf(referenced, rows)
          ),
          Effect.let("factFilter", ({ savedAudiences }) =>
            factFilterOf(filters, savedAudiences)
          ),
          Effect.map(
            ({ savedAudiences, factFilter }): AutomationEvaluationPlan => {
              const reads = audienceDotyposReads(factFilter, [
                evaluationContext,
              ]);
              return {
                filters,
                savedAudiences,
                factFilter,
                reads: {
                  visits: reads.visits,
                  profiles: reads.profiles || filters.reachability === true,
                },
              };
            }
          ),
          Effect.withSpan("AutomationEvaluationFacts.plan")
        );

      const bookingsOf = ({ reads, customers }: ReadsForCustomers) =>
        reads.visits && customers.length > 0
          ? withVisits((visits) => visits.bookings(customers))
          : Effect.succeed(new Map<DotyposCustomerId, number>());

      return {
        plan,
        cost: (input) =>
          bookingsOf(input).pipe(
            Effect.map((bookings) =>
              requestCost(
                input.reads,
                totalBookings(input.customers, bookings),
                new Set(input.customers).size
              )
            ),
            Effect.withSpan("AutomationEvaluationFacts.cost")
          ),
        pack: (input) =>
          bookingsOf(input).pipe(
            Effect.map((bookings) =>
              packCustomers(input.reads, input.customers, bookings)
            ),
            Effect.withSpan("AutomationEvaluationFacts.pack")
          ),
        fetch: ({ reads, customers }) =>
          Effect.Do.pipe(
            Effect.bind("profiles", () =>
              reads.profiles
                ? dotypos
                    .getCustomersByIds(customers, { concurrency: 1 })
                    .pipe(
                      Effect.map(Option.some),
                      Effect.mapError(AutomationUnitFetchFailure.fromDotypos)
                    )
                : Effect.succeed(Option.none())
            ),
            Effect.bind("visits", () =>
              reads.visits
                ? withVisits((visits) => visits.ofCustomers(customers)).pipe(
                    Effect.map(Option.some),
                    Effect.mapError(
                      AutomationUnitFetchFailure.fromReservationVisits
                    )
                  )
                : Effect.succeed(Option.none())
            ),
            Effect.map(AudienceFactSource.Fetched),
            Effect.withSpan("AutomationEvaluationFacts.fetch")
          ),
      } satisfies IAutomationEvaluationFacts;
    })
  );

  static Live = this.Default.pipe(
    Layer.provide(
      Layer.mergeAll(WorkspaceDatabase.Default, WorkspaceDotyposLayer)
    )
  );
}

/** The saved audiences a condition references, each once, in order. */
const savedAudienceReferences = (
  condition: AutomationConditionFilter | undefined
): readonly CampaignAudienceId[] => [
  ...new Set(
    condition === undefined
      ? []
      : audienceLeavesOf<AutomationConditionLeaf>(condition).flatMap((leaf) =>
          isSavedAudienceLeaf(leaf) ? [leaf.audienceId] : []
        )
  ),
];

const isSavedAudienceLeaf = (
  leaf: AutomationConditionLeaf
): leaf is InSavedAudience => leaf._tag === "InAudience";

/** Each referenced audience's definition, or the first one that's gone. */
const definitionsOf = (
  referenced: readonly CampaignAudienceId[],
  rows: readonly {
    readonly id: CampaignAudienceId;
    readonly filter: AudienceFilter;
  }[]
) => {
  const byId = new Map(rows.map((row) => [row.id, row]));
  return Effect.forEach(referenced, (audienceId) =>
    Option.match(Option.fromUndefinedOr(byId.get(audienceId)), {
      onNone: () =>
        Effect.fail(new AutomationConditionAudienceMissing({ audienceId })),
      onSome: ({ filter }) =>
        Effect.succeed([
          audienceId,
          { audienceId, filter, filterHash: savedAudienceFilterHash(filter) },
        ] as const),
    })
  ).pipe(
    Effect.map(
      (entries): ReadonlyMap<CampaignAudienceId, SavedAudienceDefinition> =>
        new Map(entries)
    )
  );
};

/** SHA-256 of the definition; key order doesn't affect it. */
const savedAudienceFilterHash = (filter: AudienceFilter) =>
  createHash("sha256").update(canonicalJson(filter)).digest("hex");

/**
 * An AND of every catalogue condition the evaluation uses. Fact requests
 * depend only on the conditions, not on how they combine.
 */
const factFilterOf = (
  { entryAudience, condition }: AutomationEvaluationFilters,
  savedAudiences: ReadonlyMap<CampaignAudienceId, SavedAudienceDefinition>
): AudienceFilter => ({
  _tag: "Group",
  operator: "and",
  filters: [
    ...(entryAudience === undefined ? [] : [entryAudience]),
    ...(condition === undefined
      ? []
      : audienceLeavesOf<AutomationConditionLeaf>(condition).filter(
          (leaf): leaf is AudienceCondition => !isSavedAudienceLeaf(leaf)
        )),
    ...[...savedAudiences.values()].map(({ filter }) => filter),
  ],
});

const totalBookings = (
  customers: readonly DotyposCustomerId[],
  bookings: ReadonlyMap<DotyposCustomerId, number>
) =>
  [...new Set(customers)].reduce(
    (total, id) => total + (bookings.get(id) ?? 0),
    0
  );

/** One profile page if needed, plus ⌈bookings / 100⌉ visit pages if needed. */
const requestCost = (
  reads: AudienceDotyposReads,
  bookings: number,
  customers: number
) =>
  (reads.profiles ? dotyposIdReadRequests(customers) : 0) +
  (reads.visits ? dotyposIdReadRequests(bookings) : 0);

type OpenChunk = {
  readonly customers: DotyposCustomerId[];
  bookings: number;
};

const packCustomers = (
  reads: AudienceDotyposReads,
  customers: readonly DotyposCustomerId[],
  bookings: ReadonlyMap<DotyposCustomerId, number>
): readonly AutomationFactsChunk[] => {
  const chunks: AutomationFactsChunk[] = [];
  let open: OpenChunk = { customers: [], bookings: 0 };
  const close = () => {
    if (open.customers.length > 0) {
      chunks.push({
        customers: open.customers,
        requestCost: requestCost(reads, open.bookings, open.customers.length),
      });
    }
    open = { customers: [], bookings: 0 };
  };
  for (const id of new Set(customers)) {
    const booked = reads.visits ? (bookings.get(id) ?? 0) : 0;
    if (requestCost(reads, booked, 1) > maxUnitRequestCost) {
      // Units follow id order, so the open unit closes before a solo one.
      close();
      chunks.push({
        customers: [id],
        requestCost: requestCost(reads, booked, 1),
      });
      continue;
    }
    if (
      open.customers.length >= dotyposIdReadBatchSize ||
      requestCost(reads, open.bookings + booked, open.customers.length + 1) >
        maxUnitRequestCost
    ) {
      close();
    }
    open.customers.push(id);
    open.bookings += booked;
  }
  close();
  return chunks;
};
