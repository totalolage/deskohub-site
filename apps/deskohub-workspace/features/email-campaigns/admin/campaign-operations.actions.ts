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
import { Effect, Match, Schema } from "effect";
import type {
  FlattenedValidationErrors,
  SafeActionResult,
  ValidationErrors,
} from "next-safe-action";
import {
  type AdministrationPath,
  administrationHref,
} from "@/features/administration/administration-href";
import { defineAdministrationAction } from "@/features/administrators/server/administration-request.server";
import { CampaignOperations } from "../backend/campaign-operations.service";
import { emailCampaignsActionFailureCopy } from "./campaign-operation-failure";
import { campaignOperationCapabilities } from "./campaign-operation-query.server";

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

/** Runs the operation through the port, with its failure as data. */
const operationResult = ({
  operation,
  input,
}: typeof CampaignOperationRequest.Type) =>
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
    })
  );

/** Every page that lists or shows what a campaign mutation can change. */
const campaignPages = ({
  input,
}: CampaignOperationRequest): readonly AdministrationPath[] => [
  administrationHref("/[locale]/admin/email-campaigns"),
  administrationHref("/[locale]/admin/email-audiences"),
  ...Match.value(input).pipe(
    Match.when({ campaignId: Match.string }, ({ campaignId }) => [
      administrationHref("/[locale]/admin/email-campaigns/[campaignId]", {
        campaignId,
      }),
    ]),
    Match.when({ audienceId: Match.string }, ({ audienceId }) => [
      administrationHref("/[locale]/admin/email-audiences/[audienceId]", {
        audienceId,
      }),
    ]),
    Match.orElse(() => [])
  ),
];

const campaignOperationAction = defineAdministrationAction(
  {
    operation: "email-campaigns.admin.run-operation",
    schema: Schema.toStandardSchemaV1(CampaignOperationRequest, {
      parseOptions: { errors: "all", onExcessProperty: "error" },
    }),
    // Inputs can hold test recipients' addresses.
    logInput: false,
    failureCopy: emailCampaignsActionFailureCopy,
    capabilities: campaignOperationCapabilities,
    unauthorizedResult: administratorRequired,
    revalidates: (request, result) =>
      result._tag === "Success" &&
      campaignOperations[request.operation].kind === "mutation"
        ? // The port decoded the input of an operation that succeeded.
          campaignPages(request as CampaignOperationRequest)
        : [],
  },
  operationResult
);

/**
 * Runs one campaign operation through the port for the signed-in
 * administrator. A mutation that succeeds revalidates the campaign pages.
 */
export async function runCampaignOperation<Name extends CampaignOperationName>(
  request: CampaignOperationRequest<Name>
) {
  "use server";
  const result = await campaignOperationAction(request);
  return result as CampaignOperationActionResult<Name>;
}
