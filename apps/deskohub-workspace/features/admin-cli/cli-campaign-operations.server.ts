import {
  type CampaignOperationError,
  type CampaignOperationName,
  type CampaignOperations as CampaignOperationRegistry,
  CliInputInvalid,
  CliMutationInProgress,
  CliMutationRejected,
  CliResourceNotFound,
  CliServiceUnavailable,
  CliSessionUnauthorized,
  CurrentAdministrationCaller,
  type OperationInput,
} from "@deskohub/workspace-admin-api";
import { Effect, Match } from "effect";
import { CurrentAdministrator } from "@/features/administrators/backend/current-administrator";
import { CampaignOperations } from "@/features/email-campaigns/backend/campaign-operations.service";
import { OperationRequestLedger } from "@/features/email-campaigns/backend/operation-request-ledger.service";
import { mapAdministrationApiFailure } from "./administration-api-failure";
import {
  CliMutationIdempotency,
  mutationScopeOf,
} from "./cli-mutation-idempotency.service";
import { cliOperationRequestLedger } from "./cli-operation-request-ledger";

/**
 * Maps a port error category to the CLI error with the same HTTP status:
 * invalid input 400, conflict and a request still being applied 409, not
 * found 404, unavailable 503. A revoked administrator is unauthorized (401),
 * as when the bearer middleware notices it first.
 */
const toCliFailure = (error: CampaignOperationError) =>
  Match.value(error).pipe(
    Match.tagsExhaustive({
      OperationUnauthorized: ({ message }) =>
        new CliSessionUnauthorized({ message }),
      OperationInputInvalid: ({ code, message }) =>
        new CliInputInvalid({ code, message }),
      OperationConflict: ({ code, message }) =>
        new CliMutationRejected({ code, message }),
      OperationNotFound: ({ code, message }) =>
        new CliResourceNotFound({ code, message }),
      OperationUnavailable: ({ code, message }) =>
        new CliServiceUnavailable({ code, message }),
      OperationInProgress: ({ message, requestId }) =>
        new CliMutationInProgress({ message, requestId }),
    })
  );

/**
 * Runs a campaign operation for the calling administrator, with the ledger
 * of the caller's channel. Every campaign and automation endpoint is the
 * operation of the same name with the request's params, query and payload
 * as its input.
 */
export const cliCampaignOperationInvoker = Effect.gen(function* () {
  const operations = yield* CampaignOperations;
  const mutations = yield* CliMutationIdempotency;

  const invoke = <Name extends CampaignOperationName>(
    name: Name,
    input: OperationInput<CampaignOperationRegistry[Name]>
  ) =>
    CurrentAdministrationCaller.pipe(
      Effect.flatMap(({ actor, channel }) =>
        operations
          .invoke(name, input)
          .pipe(
            mapAdministrationApiFailure(toCliFailure),
            Effect.provideService(CurrentAdministrator, actor),
            Effect.provideService(
              OperationRequestLedger,
              cliOperationRequestLedger(mutations, mutationScopeOf(channel))
            )
          )
      )
    );

  return invoke;
});
