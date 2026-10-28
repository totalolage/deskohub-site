import {
  CliMutationInProgress,
  CliMutationRejected,
  CurrentAdministrationCaller,
  campaignOperations,
  OperationConflict,
  OperationInProgress,
} from "@deskohub/workspace-admin-api";
import { Effect, Match, type Schema } from "effect";
import type { CliStoredMutation, CliStoredMutationResult } from "@/db/schema";
import type { DatabaseQueryError } from "@/db/sql-constraint";
import type {
  OperationLedgerRequest,
  OperationRequestLedger,
} from "@/features/email-campaigns/backend/operation-request-ledger.service";
import type { AdministrationRequestLedger } from "./administration-request-ledger.service";

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
 * The administration API's request ledger for one caller, stored with the
 * other administration requests under the caller's channel, so a retried
 * request replays its first result.
 */
export const cliOperationRequestLedger = (
  ledger: AdministrationRequestLedger["Service"],
  caller: CurrentAdministrationCaller["Service"]
): OperationRequestLedger["Service"] => ({
  applyOnce: (entry) =>
    // A generic operation name can't pair the stored result with its output.
    applyLedgerEntry(ledger, caller, entry) as never,
});

const applyLedgerEntry = <E, R>(
  ledger: AdministrationRequestLedger["Service"],
  caller: CurrentAdministrationCaller["Service"],
  entry: OperationLedgerRequest & {
    readonly apply: Effect.Effect<CliStoredMutationResult, E, R>;
  }
) =>
  ledger
    .applyOnce({
      requestId: entry.input.requestId,
      mutation: storedMutation(entry),
      result: campaignOperations[entry.operation].output,
      apply: entry.apply,
    })
    .pipe(
      Effect.mapError(toLedgerFailure),
      Effect.provideService(CurrentAdministrationCaller, caller)
    );

/** The ledger's own failures become port errors; others pass through. */
const toLedgerFailure = <E>(
  error:
    | E
    | CliMutationInProgress
    | CliMutationRejected
    | DatabaseQueryError
    | Schema.SchemaError
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
