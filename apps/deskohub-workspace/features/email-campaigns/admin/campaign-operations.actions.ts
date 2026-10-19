"use server";

import {
  type CampaignOperationError,
  type CampaignOperationName,
  type CampaignOperations as CampaignOperationRegistry,
  campaignOperations,
  type OperationInput,
  type OperationOutput,
} from "@deskohub/workspace-admin-api";
import type { StandardSchemaV1 } from "@standard-schema/spec";
import { Effect, Layer, Match, Schema } from "effect";
import type {
  FlattenedValidationErrors,
  SafeActionResult,
  ValidationErrors,
} from "next-safe-action";
import { CurrentAdministrator } from "@/features/administrators/backend/current-administrator";
import { requireAdministratorAuthorization } from "@/features/administrators/server/administrator-authorization.server";
import { revalidateLocalizedPath } from "@/features/i18n/server/revalidate-localized-path";
import { defineWorkspaceAction } from "@/shared/backend/workspace-action";
import { CampaignOperations } from "../backend/campaign-operations.service";
import { OperationRequestLedger } from "../backend/operation-request-ledger.service";

const campaignOperationNames = Object.keys(campaignOperations) as [
  CampaignOperationName,
  ...CampaignOperationName[],
];

/**
 * Which operation to run, with its input as the client sent it. The port
 * decodes the input, so invalid input fails as it does for every adapter.
 */
const CampaignOperationRequest = Schema.Struct({
  operation: Schema.Literals(campaignOperationNames),
  input: Schema.Unknown,
});

export type CampaignOperationRequest<
  Name extends CampaignOperationName = CampaignOperationName,
> = {
  readonly operation: Name;
  readonly input: OperationInput<CampaignOperationRegistry[Name]>;
};

/**
 * An operation's output, or its failure as data: the category, the stable
 * `code` the admin UI localizes, and the English message as a fallback.
 */
export type CampaignOperationResult<
  Name extends CampaignOperationName = CampaignOperationName,
> =
  | {
      readonly _tag: "Success";
      readonly output: OperationOutput<CampaignOperationRegistry[Name]>;
    }
  | {
      readonly _tag: "Failure";
      readonly category: CampaignOperationError["_tag"];
      readonly code: string;
      readonly message: string;
    };

export type CampaignOperationRequestSchema<
  Name extends CampaignOperationName = CampaignOperationName,
> = StandardSchemaV1<CampaignOperationRequest<Name>>;

export type CampaignOperationValidationErrors<
  Name extends CampaignOperationName = CampaignOperationName,
> = FlattenedValidationErrors<
  ValidationErrors<CampaignOperationRequestSchema<Name>>
>;

/**
 * What the client receives for one operation: the action envelope, whose
 * `data` is the operation's result.
 */
type CampaignOperationActionResult<Name extends CampaignOperationName> =
  SafeActionResult<
    string,
    CampaignOperationRequestSchema<Name>,
    CampaignOperationValidationErrors<Name>,
    CampaignOperationResult<Name>
  >;

const toFailure = (error: CampaignOperationError): CampaignOperationResult => ({
  _tag: "Failure",
  category: error._tag,
  code: error.code,
  message: error.message,
});

const administratorRequired: CampaignOperationResult = {
  _tag: "Failure",
  category: "OperationUnauthorized",
  code: "administrator-required",
  message: "Administrator authentication is required.",
};

const campaignOperationAction = defineWorkspaceAction(
  {
    operation: "email-campaigns.admin.run-operation",
    schema: Schema.toStandardSchemaV1(CampaignOperationRequest, {
      parseOptions: { errors: "all", onExcessProperty: "error" },
    }),
    // Inputs can hold test recipients' addresses.
    logInput: false,
  },
  ({ operation, input }) =>
    requireAdministratorAuthorization.pipe(
      Effect.matchEffect({
        onFailure: () => Effect.succeed(administratorRequired),
        onSuccess: (administrator) =>
          CampaignOperations.pipe(
            Effect.flatMap((operations) =>
              operations.invoke(
                operation,
                input as OperationInput<
                  CampaignOperationRegistry[CampaignOperationName]
                >
              )
            ),
            Effect.match({
              onFailure: toFailure,
              onSuccess: (output): CampaignOperationResult => ({
                _tag: "Success",
                output,
              }),
            }),
            Effect.provideService(CurrentAdministrator, administrator),
            Effect.provide(
              Layer.mergeAll(
                OperationRequestLedger.unscoped,
                CampaignOperations.Live
              )
            )
          ),
      })
    )
);

/** Every page that lists or shows what a campaign mutation can change. */
const revalidateCampaignPages = (request: CampaignOperationRequest) => {
  revalidateLocalizedPath("/admin/email-campaigns");
  revalidateLocalizedPath("/admin/email-audiences");
  Match.value(request.input).pipe(
    Match.when({ campaignId: Match.string }, ({ campaignId }) =>
      revalidateLocalizedPath(`/admin/email-campaigns/${campaignId}`)
    ),
    Match.when({ audienceId: Match.string }, ({ audienceId }) =>
      revalidateLocalizedPath(`/admin/email-audiences/${audienceId}`)
    ),
    Match.orElse(() => undefined)
  );
};

/**
 * Runs one campaign operation through the port for the signed-in
 * administrator. A mutation that succeeds revalidates the campaign pages.
 */
export async function runCampaignOperation<Name extends CampaignOperationName>(
  request: CampaignOperationRequest<Name>
) {
  "use server";
  const result = await campaignOperationAction(request);
  if (
    result?.data?._tag === "Success" &&
    campaignOperations[request.operation].kind === "mutation"
  ) {
    revalidateCampaignPages(request);
  }
  return result as CampaignOperationActionResult<Name>;
}
