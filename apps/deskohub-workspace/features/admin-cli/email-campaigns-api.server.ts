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
  CurrentCliSession,
  type OperationInput,
  WorkspaceAdminApi,
} from "@deskohub/workspace-admin-api";
import { Effect, Match } from "effect";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { CurrentAdministrator } from "@/features/administrators/backend/current-administrator";
import { CampaignOperations } from "@/features/email-campaigns/backend/campaign-operations.service";
import { OperationRequestLedger } from "@/features/email-campaigns/backend/operation-request-ledger.service";
import { mapAdministrationApiFailure } from "./administration-api-failure";
import { CliAuthentication } from "./cli-authentication.service";
import { CliMutationIdempotency } from "./cli-mutation-idempotency.service";
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
 * Every campaign endpoint is the port's operation of the same name: the
 * session's administrator, the session's mutation ledger, and the request's
 * params and payload as the input.
 */
export const AdminCliCampaignsApiHandlers = HttpApiBuilder.group(
  WorkspaceAdminApi,
  "campaigns",
  Effect.fn(function* (handlers) {
    const operations = yield* CampaignOperations;
    const authentication = yield* CliAuthentication;
    const mutations = yield* CliMutationIdempotency;

    const invoke = <Name extends CampaignOperationName>(
      name: Name,
      input: OperationInput<CampaignOperationRegistry[Name]>
    ) =>
      CurrentCliSession.pipe(
        Effect.flatMap((session) =>
          authentication.sessionAdministrator(session.id).pipe(
            Effect.mapError((cause) =>
              cause._tag === "CliSessionUnauthorized"
                ? cause
                : new CliServiceUnavailable({
                    message:
                      "The administration API is temporarily unavailable.",
                  })
            ),
            Effect.flatMap((administrator) =>
              operations
                .invoke(name, input)
                .pipe(
                  mapAdministrationApiFailure(toCliFailure),
                  Effect.provideService(CurrentAdministrator, administrator),
                  Effect.provideService(
                    OperationRequestLedger,
                    cliOperationRequestLedger(mutations, session.id)
                  )
                )
            )
          )
        )
      );

    return handlers
      .handle("listCampaignAudiences", () =>
        invoke("listCampaignAudiences", {})
      )
      .handle("getCampaignAudience", ({ params }) =>
        invoke("getCampaignAudience", params)
      )
      .handle("createCampaignAudience", ({ payload }) =>
        invoke("createCampaignAudience", payload)
      )
      .handle("updateCampaignAudience", ({ params, payload }) =>
        invoke("updateCampaignAudience", { ...params, ...payload })
      )
      .handle("archiveCampaignAudience", ({ params }) =>
        invoke("archiveCampaignAudience", params)
      )
      .handle("unarchiveCampaignAudience", ({ params }) =>
        invoke("unarchiveCampaignAudience", params)
      )
      .handle("deleteCampaignAudience", ({ params }) =>
        invoke("deleteCampaignAudience", params)
      )
      .handle("listCampaignTemplates", () =>
        invoke("listCampaignTemplates", {})
      )
      .handle("previewCampaignTemplate", ({ params, payload }) =>
        invoke("previewCampaignTemplate", { ...params, preview: payload })
      )
      .handle("listCampaigns", () => invoke("listCampaigns", {}))
      .handle("getCampaign", ({ params }) => invoke("getCampaign", params))
      .handle("createCampaign", ({ payload }) =>
        invoke("createCampaign", payload)
      )
      .handle("updateCampaign", ({ params, payload }) =>
        invoke("updateCampaign", { ...params, ...payload })
      )
      .handle("duplicateCampaign", ({ params, payload }) =>
        invoke("duplicateCampaign", { ...params, ...payload })
      )
      .handle("deleteCampaign", ({ params }) =>
        invoke("deleteCampaign", params)
      )
      .handle("previewCampaignRecipients", ({ params }) =>
        invoke("previewCampaignRecipients", params)
      )
      .handle("testSendCampaign", ({ params, payload }) =>
        invoke("testSendCampaign", { ...params, ...payload })
      )
      .handle("sendCampaign", ({ params, payload }) =>
        invoke("sendCampaign", { ...params, ...payload })
      )
      .handle("retryCampaign", ({ params, payload }) =>
        invoke("retryCampaign", { ...params, ...payload })
      )
      .handle("getCampaignSendStatus", ({ params }) =>
        invoke("getCampaignSendStatus", params)
      );
  })
);
