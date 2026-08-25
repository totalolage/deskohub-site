import "server-only";

import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Context, Data, Effect, Layer, Schema } from "effect";
import type { SqlError } from "effect/unstable/sql/SqlError";
import {
  WorkspaceDatabase,
  type WorkspaceDatabaseClient,
} from "@/db/database.service";
import { type LegalEvidenceEvent, legalEvidenceEvents } from "@/db/schema";
import { postgresUuidV7 } from "@/db/uuid-v7";
import { legalEvidenceSchema } from "@/features/checkout/legal-evidence";
import { orderIdSchema } from "@/features/order";
import { workspaceReservationIdSchema } from "@/features/reservation/persistence-contracts";

const legalEvidenceEventInputSchema = Schema.Struct({
  orderId: Schema.optional(orderIdSchema),
  workspaceReservationId: Schema.optional(workspaceReservationIdSchema),
  evidence: legalEvidenceSchema,
}).check(
  Schema.makeFilter(
    (input) =>
      input.orderId !== undefined || input.workspaceReservationId !== undefined,
    { message: "Legal evidence must be associated with an order." }
  )
);

export class LegalEvidenceEventInputError extends Data.TaggedError(
  "LegalEvidenceEventInputError"
)<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export type LegalEvidenceEventInput =
  typeof legalEvidenceEventInputSchema.Encoded;

export interface ILegalEvidenceEventRepository {
  readonly record: (
    input: LegalEvidenceEventInput
  ) => Effect.Effect<
    LegalEvidenceEvent,
    EffectDrizzleQueryError | SqlError | LegalEvidenceEventInputError
  >;
  readonly recordMany: (
    input: readonly LegalEvidenceEventInput[]
  ) => Effect.Effect<
    readonly LegalEvidenceEvent[],
    EffectDrizzleQueryError | SqlError | LegalEvidenceEventInputError
  >;
}

export type LegalEvidenceTransaction = Parameters<
  Parameters<WorkspaceDatabaseClient["transaction"]>[0]
>[0];

const getLegalEvidenceEventRecord = (
  parsed: typeof legalEvidenceEventInputSchema.Type
) => ({
  orderId: parsed.orderId,
  workspaceReservationId: parsed.workspaceReservationId,
  documentKey: parsed.evidence.documentKey,
  documentPath: parsed.evidence.document.path,
  documentHash: parsed.evidence.documentHash,
  hashAlgorithm: parsed.evidence.document.hashAlgorithm,
  accepted: parsed.evidence.accepted,
  acceptedAt: Temporal.Instant.from(parsed.evidence.acceptedAt),
  locale: parsed.evidence.locale,
  source: parsed.evidence.source,
});

export const persistLegalEvidenceEvents = Effect.fn(
  "legalEvidenceEvents.persist"
)(function* (input: {
  readonly tx: LegalEvidenceTransaction;
  readonly events: readonly LegalEvidenceEventInput[];
}) {
  const records = yield* Effect.forEach(input.events, (event) =>
    Schema.decodeUnknownEffect(legalEvidenceEventInputSchema, {
      onExcessProperty: "error",
    })(event).pipe(
      Effect.map(getLegalEvidenceEventRecord),
      Effect.mapError(
        (cause) =>
          new LegalEvidenceEventInputError({
            message: "Legal evidence event input is invalid.",
            cause,
          })
      )
    )
  );
  if (records.length === 0) return [];

  return yield* input.tx
    .insert(legalEvidenceEvents)
    .values(records.map((event) => ({ id: postgresUuidV7, ...event })))
    .returning();
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
          const [inserted] = yield* db.transaction((tx) =>
            persistLegalEvidenceEvents({ tx, events: [input] })
          );

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
              orderId: input.orderId,
              workspaceReservationId: input.workspaceReservationId,
              documentKey: input.evidence.documentKey,
            })
          )
      );

      return LegalEvidenceEventRepository.of({
        record,
        recordMany: Effect.fn("legalEvidenceEvents.recordMany")(
          function* (input) {
            return yield* db.transaction((tx) =>
              persistLegalEvidenceEvents({ tx, events: input })
            );
          }
        ),
      });
    })
  );

  static Live = this.Default.pipe(Layer.provide(WorkspaceDatabase.Default));
}
