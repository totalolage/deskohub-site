import "server-only";

import { asc, sql } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Data, Effect, Layer, Schema } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { equalsAny } from "@/db/equals-any";
import { type LegalEvidenceEvent, legalEvidenceEvents } from "@/db/schema";
import { postgresUuidV7 } from "@/db/uuid-v7";
import { legalEvidenceSchema } from "@/features/checkout/legal-evidence";
import {
  type WorkspaceReservationId,
  workspaceReservationIdSchema,
} from "@/features/reservation/persistence-contracts";
import {
  type ReadLimitExceededError,
  readLimitSentinel,
  requireWithinReadLimit,
} from "@/shared/backend/read-limit";

const legalEvidenceEventInputSchema = Schema.Struct({
  workspaceReservationId: Schema.optional(workspaceReservationIdSchema),
  evidence: legalEvidenceSchema,
});

class LegalEvidenceEventInputError extends Data.TaggedError(
  "LegalEvidenceEventInputError"
)<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

type LegalEvidenceEventInput = typeof legalEvidenceEventInputSchema.Encoded;

/**
 * A legal evidence event as the customer may see it: which document version
 * they accepted, when, where, and with which acknowledgement. The document
 * path, hash and hash algorithm are the ones stored with the event, never the
 * document's current version.
 */
export type CustomerLegalEvidenceEventRecord = {
  readonly workspaceReservationId: WorkspaceReservationId;
  readonly documentKey: string;
  readonly documentPath: string;
  readonly documentHash: string;
  readonly hashAlgorithm: "sha256";
  readonly accepted: boolean;
  readonly acceptedAt: Temporal.Instant;
  readonly locale: string;
  readonly source: string;
  /**
   * Whether the customer gave early-performance consent with the document;
   * `null` for events recorded before acknowledgements were stored, whose
   * acknowledgements are unknown.
   */
  readonly earlyPerformanceConsent: boolean | null;
};

export interface ILegalEvidenceEventRepository {
  readonly record: (
    input: LegalEvidenceEventInput
  ) => Effect.Effect<
    LegalEvidenceEvent,
    EffectDrizzleQueryError | LegalEvidenceEventInputError
  >;
  readonly recordMany: (
    input: readonly LegalEvidenceEventInput[]
  ) => Effect.Effect<
    readonly LegalEvidenceEvent[],
    EffectDrizzleQueryError | LegalEvidenceEventInputError
  >;
  /**
   * Every legal evidence event recorded for the given reservations, oldest
   * first. Events without a reservation are never returned: nothing ties them
   * to a customer. The caller owns the reservations' customer scope and the
   * `limit`, which bounds the whole result: more matching events fail with
   * `ReadLimitExceededError` and return nothing.
   */
  readonly listForReservations: (input: {
    readonly workspaceReservationIds: readonly WorkspaceReservationId[];
    readonly limit: number;
  }) => Effect.Effect<
    readonly CustomerLegalEvidenceEventRecord[],
    EffectDrizzleQueryError | ReadLimitExceededError
  >;
}

const getLegalEvidenceEventRecord = (
  parsed: typeof legalEvidenceEventInputSchema.Type
) => ({
  workspaceReservationId: parsed.workspaceReservationId,
  documentKey: parsed.evidence.documentKey,
  documentPath: parsed.evidence.document.path,
  documentHash: parsed.evidence.documentHash,
  hashAlgorithm: parsed.evidence.document.hashAlgorithm,
  accepted: parsed.evidence.accepted,
  acceptedAt: Temporal.Instant.from(parsed.evidence.acceptedAt),
  locale: parsed.evidence.locale,
  source: parsed.evidence.source,
  acknowledgements: parsed.evidence.acknowledgements ?? {},
});

export class LegalEvidenceEventRepository extends Context.Service<
  LegalEvidenceEventRepository,
  ILegalEvidenceEventRepository
>()("LegalEvidenceEventRepository") {
  static Default = Layer.effect(
    this,
    Effect.gen(function* () {
      const { db } = yield* WorkspaceDatabase;

      const record = Effect.fn("legalEvidenceEvents.record")(
        function* (input: LegalEvidenceEventInput) {
          const parsed = yield* Schema.decodeUnknownEffect(
            legalEvidenceEventInputSchema,
            { onExcessProperty: "error" }
          )(input).pipe(
            Effect.mapError(
              (cause) =>
                new LegalEvidenceEventInputError({
                  message: "Legal evidence event input is invalid.",
                  cause,
                })
            )
          );
          const event = getLegalEvidenceEventRecord(parsed);

          const [inserted] = yield* db
            .insert(legalEvidenceEvents)
            .values({ id: postgresUuidV7, ...event })
            .returning();

          if (!inserted) {
            return yield* Effect.die(
              "Legal evidence event insert returned no row."
            );
          }

          return inserted;
        },
        (effect, input) =>
          effect.pipe(
            Effect.annotateLogs({
              workspaceReservationId: input.workspaceReservationId,
              documentKey: input.evidence.documentKey,
            })
          )
      );

      return LegalEvidenceEventRepository.of({
        record,
        recordMany: Effect.fn("legalEvidenceEvents.recordMany")(
          function* (input) {
            const inserted: LegalEvidenceEvent[] = [];
            for (const event of input) inserted.push(yield* record(event));
            return inserted;
          }
        ),
        listForReservations: Effect.fn(
          "legalEvidenceEvents.listForReservations"
        )(function* (input) {
          if (input.workspaceReservationIds.length === 0) return [];

          const { acknowledgements } = legalEvidenceEvents;
          const rows = yield* db
            .select({
              // The id list match below never matches a null reservation id.
              workspaceReservationId: sql<WorkspaceReservationId>`${legalEvidenceEvents.workspaceReservationId}`,
              documentKey: legalEvidenceEvents.documentKey,
              documentPath: legalEvidenceEvents.documentPath,
              documentHash: legalEvidenceEvents.documentHash,
              hashAlgorithm: legalEvidenceEvents.hashAlgorithm,
              accepted: legalEvidenceEvents.accepted,
              acceptedAt: legalEvidenceEvents.acceptedAt,
              locale: legalEvidenceEvents.locale,
              source: legalEvidenceEvents.source,
              // Reads the one allowlisted acknowledgement, not the document.
              earlyPerformanceConsent: sql<
                boolean | null
              >`case when ${acknowledgements} is null then null else coalesce((${acknowledgements} -> 'earlyPerformanceConsent') = 'true'::jsonb, false) end`,
            })
            .from(legalEvidenceEvents)
            .where(
              equalsAny(
                legalEvidenceEvents.workspaceReservationId,
                input.workspaceReservationIds
              )
            )
            .orderBy(
              asc(legalEvidenceEvents.createdAt),
              asc(legalEvidenceEvents.id)
            )
            .limit(readLimitSentinel(input.limit));
          return yield* requireWithinReadLimit(rows, input.limit);
        }),
      });
    })
  );

  static Live = this.Default.pipe(Layer.provide(WorkspaceDatabase.Default));
}
