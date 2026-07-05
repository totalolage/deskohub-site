import "server-only";

import { Context, Data, Effect, Layer } from "effect";
import { z } from "zod/v4";
import {
  type DatabaseError,
  runDb,
  WorkspaceDatabase,
} from "@/db/database.service";
import { type LegalEvidenceEvent, legalEvidenceEvents } from "@/db/schema";
import { postgresUuidV7 } from "@/db/uuid-v7";
import { legalEvidenceSchema } from "@/features/checkout/schemas/checkout-details";

const legalEvidenceEventInputSchema = z.object({
  workspaceReservationId: z.string().min(1).optional(),
  evidence: legalEvidenceSchema,
});

export class LegalEvidenceEventInputError extends Data.TaggedError(
  "LegalEvidenceEventInputError"
)<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export type LegalEvidenceEventInput = z.input<
  typeof legalEvidenceEventInputSchema
>;

export interface LegalEvidenceEventRepository {
  readonly record: (
    input: LegalEvidenceEventInput
  ) => Effect.Effect<
    LegalEvidenceEvent,
    DatabaseError | LegalEvidenceEventInputError
  >;
  readonly recordMany: (
    input: readonly LegalEvidenceEventInput[]
  ) => Effect.Effect<
    readonly LegalEvidenceEvent[],
    DatabaseError | LegalEvidenceEventInputError
  >;
}

export const LegalEvidenceEventRepository =
  Context.Service<LegalEvidenceEventRepository>("LegalEvidenceEventRepository");

const parseLegalEvidenceEventInput = (input: LegalEvidenceEventInput) => {
  const parsed = legalEvidenceEventInputSchema.parse(input);
  return {
    workspaceReservationId: parsed.workspaceReservationId,
    documentKey: parsed.evidence.documentKey,
    documentPath: parsed.evidence.document.path,
    documentHash: parsed.evidence.documentHash,
    hashAlgorithm: parsed.evidence.document.hashAlgorithm,
    accepted: parsed.evidence.accepted,
    acceptedAt: new Date(parsed.evidence.acceptedAt),
    locale: parsed.evidence.locale,
    source: parsed.evidence.source,
  };
};

export const LegalEvidenceEventRepositoryLive = Layer.effect(
  LegalEvidenceEventRepository,
  Effect.gen(function* () {
    const { db } = yield* WorkspaceDatabase;

    const record = Effect.fn("legalEvidenceEvents.record")(
      function* (input: LegalEvidenceEventInput) {
        const event = yield* Effect.try({
          try: () => parseLegalEvidenceEventInput(input),
          catch: (cause) =>
            new LegalEvidenceEventInputError({
              message: "Legal evidence event input is invalid.",
              cause,
            }),
        });

        const [inserted] = yield* runDb("legalEvidenceEvents.record", () =>
          db
            .insert(legalEvidenceEvents)
            .values({ id: postgresUuidV7, ...event })
            .returning()
        );

        if (!inserted) {
          return yield* Effect.fail(
            new LegalEvidenceEventInputError({
              message: "Legal evidence event insert returned no row.",
            })
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
    });
  })
);
