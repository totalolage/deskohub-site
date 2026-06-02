import "server-only";

import { randomUUID } from "node:crypto";
import { Context, Data, Effect, Layer } from "effect";
import { z } from "zod/v4";
import {
  type DatabaseError,
  runDb,
  WorkspaceDatabase,
} from "@/db/database.service";
import {
  type LegalEvidenceAuditEvent,
  legalEvidenceAuditEvents,
} from "@/db/schema";
import { legalEvidenceSchema } from "@/features/checkout/schemas/checkout-details";

const nullableStringSchema = z.string().min(1).nullable().optional();

const rejectedLegalEvidenceAuditInputSchema = z
  .object({
    orderId: nullableStringSchema,
    idempotencyKey: nullableStringSchema,
    evidence: legalEvidenceSchema,
  })
  .superRefine((input, ctx) => {
    if (input.evidence.accepted) {
      ctx.addIssue({
        code: "custom",
        path: ["evidence", "accepted"],
        message: "Rejected legal evidence audit events must not be accepted.",
      });
    }
  });

export class LegalEvidenceAuditInputError extends Data.TaggedError(
  "LegalEvidenceAuditInputError"
)<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

export interface RejectedLegalEvidenceAuditInput {
  readonly orderId?: string | null;
  readonly idempotencyKey?: string | null;
  readonly evidence: unknown;
}

export const parseRejectedLegalEvidenceAuditInput = (
  input: RejectedLegalEvidenceAuditInput
) => {
  const parsed = rejectedLegalEvidenceAuditInputSchema.parse(input);

  return {
    orderId: parsed.orderId ?? null,
    idempotencyKey: parsed.idempotencyKey ?? null,
    documentHash: parsed.evidence.documentHash,
    accepted: parsed.evidence.accepted,
    acceptedAt: new Date(parsed.evidence.acceptedAt),
    source: parsed.evidence.source,
  };
};

export interface LegalEvidenceAuditRepository {
  readonly recordRejected: (
    input: RejectedLegalEvidenceAuditInput
  ) => Effect.Effect<
    LegalEvidenceAuditEvent,
    DatabaseError | LegalEvidenceAuditInputError
  >;
}

export const LegalEvidenceAuditRepository =
  Context.GenericTag<LegalEvidenceAuditRepository>(
    "LegalEvidenceAuditRepository"
  );

export const LegalEvidenceAuditRepositoryLive = Layer.effect(
  LegalEvidenceAuditRepository,
  Effect.gen(function* () {
    const { db } = yield* WorkspaceDatabase;

    return LegalEvidenceAuditRepository.of({
      recordRejected: Effect.fn("legalEvidenceAudit.recordRejected")(
        function* (input) {
          const event = yield* Effect.try({
            try: () => parseRejectedLegalEvidenceAuditInput(input),
            catch: (cause) =>
              new LegalEvidenceAuditInputError({
                message: "Rejected legal evidence audit input is invalid.",
                cause,
              }),
          });

          const [inserted] = yield* runDb(
            "legalEvidenceAudit.recordRejected",
            () =>
              db
                .insert(legalEvidenceAuditEvents)
                .values({ id: randomUUID(), ...event })
                .returning()
          );

          if (!inserted) {
            return yield* Effect.fail(
              new LegalEvidenceAuditInputError({
                message: "Rejected legal evidence audit insert returned no row.",
              })
            );
          }

          return inserted;
        },
        (effect, input) =>
          effect.pipe(
            Effect.annotateLogs({
              orderId: input.orderId ?? null,
              idempotencyKey: input.idempotencyKey ?? null,
            })
          )
      ),
    });
  })
);
