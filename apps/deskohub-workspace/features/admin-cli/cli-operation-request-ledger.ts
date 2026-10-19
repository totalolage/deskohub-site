import {
  CliMutationInProgress,
  CliMutationRejected,
  type CliSessionIdType,
  campaignOperations,
  OperationConflict,
  OperationInProgress,
} from "@deskohub/workspace-admin-api";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Effect, Match, type Schema } from "effect";
import type { SqlError } from "effect/unstable/sql/SqlError";
import type { CliStoredMutation, CliStoredMutationResult } from "@/db/schema";
import type {
  OperationLedgerRequest,
  OperationRequestLedger,
} from "@/features/email-campaigns/backend/operation-request-ledger.service";
import type { CliMutationIdempotency } from "./cli-mutation-idempotency.service";

/**
 * The stored form of each ledger operation. The kinds predate the port, so
 * a retry that spans a deployment still matches its first request.
 */
const storedMutation = (request: OperationLedgerRequest): CliStoredMutation =>
  Match.value(request).pipe(
    Match.discriminatorsExhaustive("operation")({
      createCampaignAudience: ({ input }) => ({
        kind: "campaign-audience-create" as const,
        audience: input.audience,
      }),
      createCampaign: ({ input }) => ({
        kind: "campaign-create" as const,
        campaign: input.campaign,
      }),
      duplicateCampaign: ({ input }) => ({
        kind: "campaign-duplicate" as const,
        campaignId: input.campaignId,
      }),
    })
  );

/**
 * The CLI's request ledger: one per session, stored with the other CLI
 * mutations, so a retried request replays its first result.
 */
export const cliOperationRequestLedger = (
  mutations: CliMutationIdempotency["Service"],
  sessionId: CliSessionIdType
): OperationRequestLedger["Service"] => ({
  applyOnce: (entry) =>
    // A generic operation name can't pair the stored result with its output.
    applyLedgerEntry(mutations, sessionId, entry) as never,
});

const applyLedgerEntry = <E, R>(
  mutations: CliMutationIdempotency["Service"],
  sessionId: CliSessionIdType,
  entry: OperationLedgerRequest & {
    readonly apply: Effect.Effect<CliStoredMutationResult, E, R>;
  }
) =>
  mutations
    .applyOnce({
      request: {
        sessionId,
        requestId: entry.input.requestId,
        mutation: storedMutation(entry),
      },
      result: campaignOperations[entry.operation].output,
      apply: entry.apply,
    })
    .pipe(Effect.mapError(toLedgerFailure));

/** The ledger's own failures become port errors; others pass through. */
const toLedgerFailure = <E>(
  error:
    | E
    | CliMutationInProgress
    | CliMutationRejected
    | EffectDrizzleQueryError
    | Schema.SchemaError
    | SqlError
) => {
  if (error instanceof CliMutationInProgress) {
    return new OperationInProgress({
      code: "request-in-progress",
      message: error.message,
      requestId: error.requestId,
    });
  }
  if (error instanceof CliMutationRejected) {
    return new OperationConflict({
      code: "request-id-reused",
      message: error.message,
    });
  }
  return error;
};
