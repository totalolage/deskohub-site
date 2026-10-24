import { Schema } from "effect";
import type { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import {
  AdministrationCampaignAudienceId,
  AdministrationCampaignId,
} from "./campaign-identifiers";
import type { DhwVersion } from "./dhw-version";
import {
  AdminCliAutomationsApi,
  AutomationActivateInput,
  AutomationDetail,
  AutomationDryRun,
  AutomationEngineHealth,
  AutomationFlowUpdate,
  AutomationPreviewRef,
  AutomationPreviewStatus,
  AutomationRunDetail,
  AutomationRunListInput,
  AutomationRunPage,
  AutomationRunRef,
  AutomationRunStats,
  AutomationRunStatsInput,
  AutomationVersionDetail,
  AutomationVersionRef,
  AutomationVersionSummary,
  automationsMinimumDhwVersion,
  CalendarPreview,
  CalendarPreviewInput,
} from "./email-automations";
import {
  AdminCliCampaignsApi,
  AdministrationCampaignAudience,
  AdministrationCampaignAudienceCreateRequest,
  AdministrationCampaignAudienceDeleted,
  AdministrationCampaignAudiences,
  AdministrationCampaignAudienceUpdate,
  AdministrationCampaignCreateRequest,
  AdministrationCampaignDeleted,
  AdministrationCampaignDetail,
  AdministrationCampaignDuplicateRequest,
  AdministrationCampaignEditorContent,
  AdministrationCampaignEmailPreview,
  AdministrationCampaignRecipientPreview,
  AdministrationCampaignRetryInput,
  AdministrationCampaignRetryResult,
  AdministrationCampaignSendInput,
  AdministrationCampaignSendResult,
  AdministrationCampaignSendStatusResult,
  AdministrationCampaignSettings,
  AdministrationCampaignSummaries,
  AdministrationCampaignTemplateKey,
  AdministrationCampaignTemplatePreviewInput,
  AdministrationCampaignTemplates,
  AdministrationCampaignTestSendInput,
  AdministrationCampaignTestSendResult,
  AdministrationCampaignUpdateInput,
  campaignsMinimumDhwVersion,
} from "./email-campaigns";
import { CliMutationRequestId } from "./workspace-admin-api";

/**
 * One operation of the campaign port: its input and output schemas, whether
 * it only reads, whether a retried request replays its first result
 * (`ledger`, the input carries a `requestId`), and the oldest `dhw` that may
 * call it.
 */
export interface OperationDefinition<
  Input extends Schema.Top = Schema.Top,
  Output extends Schema.Top = Schema.Top,
  Ledger extends boolean = boolean,
> {
  readonly kind: "query" | "mutation";
  readonly input: Input;
  readonly output: Output;
  readonly ledger: Ledger;
  readonly minimumDhwVersion: DhwVersion | undefined;
}

/** A registered operation; it also knows its own name. */
export interface Operation<
  Name extends string = string,
  Input extends Schema.Top = Schema.Top,
  Output extends Schema.Top = Schema.Top,
  Ledger extends boolean = boolean,
> extends OperationDefinition<Input, Output, Ledger> {
  readonly name: Name;
}

export type Operations = {
  readonly [name: string]: Operation;
};

type OperationOptions<Input extends Schema.Top, Output extends Schema.Top> = {
  readonly input: Input;
  readonly output: Output;
  readonly minimumDhwVersion?: DhwVersion;
};

/** A read without side effects. */
export const query = <Input extends Schema.Top, Output extends Schema.Top>({
  input,
  output,
  minimumDhwVersion,
}: OperationOptions<Input, Output>): OperationDefinition<
  Input,
  Output,
  false
> => ({
  kind: "query",
  input,
  output,
  ledger: false,
  minimumDhwVersion,
});

/**
 * A write. With `ledger`, its input carries a `requestId` and a retried
 * request replays the first one's result.
 */
export function mutation<Input extends Schema.Top, Output extends Schema.Top>(
  options: OperationOptions<Input, Output> & { readonly ledger: true }
): OperationDefinition<Input, Output, true>;
export function mutation<Input extends Schema.Top, Output extends Schema.Top>(
  options: OperationOptions<Input, Output>
): OperationDefinition<Input, Output, false>;
export function mutation<Input extends Schema.Top, Output extends Schema.Top>({
  input,
  output,
  ledger = false,
  minimumDhwVersion,
}: OperationOptions<Input, Output> & {
  readonly ledger?: boolean;
}): OperationDefinition<Input, Output> {
  return { kind: "mutation", input, output, ledger, minimumDhwVersion };
}

/** Names each definition after its key. */
export const defineOperations = <
  const Definitions extends Record<string, OperationDefinition>,
>(
  definitions: Definitions
): {
  readonly [Name in keyof Definitions & string]: Operation<
    Name,
    Definitions[Name]["input"],
    Definitions[Name]["output"],
    Definitions[Name]["ledger"]
  >;
} =>
  Object.fromEntries(
    Object.entries(definitions).map(([name, definition]) => [
      name,
      { ...definition, name },
    ])
  ) as never;

/** What an adapter passes in: the encoded input, decoded by the port. */
export type OperationInput<Op extends Operation> = Op["input"]["Encoded"];
/** What the port's handler receives after decoding. */
export type OperationDecodedInput<Op extends Operation> = Op["input"]["Type"];
export type OperationOutput<Op extends Operation> = Op["output"]["Type"];

/** Names of the operations whose retried requests replay the first result. */
export type LedgerOperationName<Ops extends Operations> = {
  readonly [Name in keyof Ops]: Ops[Name]["ledger"] extends true ? Name : never;
}[keyof Ops];

/** Names of operations that have no endpoint of the same name. */
export type OperationsWithoutEndpoint<
  Ops extends Operations,
  Endpoint extends HttpApiEndpoint.Any,
> = {
  readonly [Name in keyof Ops]: [
    Extract<Endpoint, { readonly name: Name }>,
  ] extends [never]
    ? Name
    : never;
}[keyof Ops];

/** The HTTP endpoint serving each operation, by the operation's name. */
export type OperationEndpoints<
  Ops extends Operations,
  Endpoint extends HttpApiEndpoint.Any,
> = {
  readonly [Name in keyof Ops]: Extract<Endpoint, { readonly name: Name }>;
};

/**
 * Pairs each operation with the endpoint of the same name in one of the
 * groups. An operation without one fails the typecheck.
 */
export const operationEndpoints = <
  Ops extends Operations,
  const Groups extends ReadonlyArray<HttpApiGroup.Any>,
>(
  operations: Ops,
  groups: Groups &
    ([
      OperationsWithoutEndpoint<Ops, HttpApiGroup.Endpoints<Groups[number]>>,
    ] extends [never]
      ? unknown
      : {
          readonly missingEndpoints: OperationsWithoutEndpoint<
            Ops,
            HttpApiGroup.Endpoints<Groups[number]>
          >;
        })
): OperationEndpoints<Ops, HttpApiGroup.Endpoints<Groups[number]>> =>
  Object.fromEntries(
    Object.keys(operations).map((name) => [
      name,
      groups.find((group) => Object.hasOwn(group.endpoints, name))?.endpoints[
        name
      ],
    ])
  ) as never;

const strictParseOptions = {
  parseOptions: { errors: "all", onExcessProperty: "error" },
} as const;

/** Where in the input a problem is, and what is wrong there. */
export const OperationInputIssue = Schema.Struct({
  path: Schema.Array(Schema.Union([Schema.String, Schema.Finite])),
  message: Schema.String,
});
export type OperationInputIssue = typeof OperationInputIssue.Type;

/**
 * The port's failures. `code` is a stable kebab-case id the Admin UI
 * localizes; `message` is English, actionable, and never holds customer
 * data. `cause` keeps the domain error for logs.
 */
const operationErrorFields = {
  code: Schema.String,
  message: Schema.String,
  cause: Schema.optionalKey(Schema.Defect()),
};

/** The input can't be accepted as given. */
export class OperationInputInvalid extends Schema.TaggedErrorClass<OperationInputInvalid>()(
  "OperationInputInvalid",
  {
    ...operationErrorFields,
    issues: Schema.optionalKey(Schema.Array(OperationInputIssue)),
  }
) {}

/** The current state refuses the operation. */
export class OperationConflict extends Schema.TaggedErrorClass<OperationConflict>()(
  "OperationConflict",
  operationErrorFields
) {}

export class OperationNotFound extends Schema.TaggedErrorClass<OperationNotFound>()(
  "OperationNotFound",
  operationErrorFields
) {}

/** A dependency is unavailable; retrying later can succeed. */
export class OperationUnavailable extends Schema.TaggedErrorClass<OperationUnavailable>()(
  "OperationUnavailable",
  operationErrorFields
) {}

/**
 * The caller isn't an administrator any more: the port re-reads the grant
 * on every operation, after the adapter authenticated the caller.
 */
export class OperationUnauthorized extends Schema.TaggedErrorClass<OperationUnauthorized>()(
  "OperationUnauthorized",
  operationErrorFields
) {}

/** A request with the same ID is still being applied. */
export class OperationInProgress extends Schema.TaggedErrorClass<OperationInProgress>()(
  "OperationInProgress",
  { ...operationErrorFields, requestId: CliMutationRequestId }
) {}

export type CampaignOperationError =
  | OperationUnauthorized
  | OperationInputInvalid
  | OperationConflict
  | OperationNotFound
  | OperationUnavailable
  | OperationInProgress;

export const CampaignRef = Schema.Struct({
  campaignId: AdministrationCampaignId,
}).annotate(strictParseOptions);
export type CampaignRef = typeof CampaignRef.Type;

export const CampaignAudienceRef = Schema.Struct({
  audienceId: AdministrationCampaignAudienceId,
}).annotate(strictParseOptions);
export type CampaignAudienceRef = typeof CampaignAudienceRef.Type;

/** An empty input; an empty struct would accept any object. */
const NoInput = Schema.Record(Schema.String, Schema.Never);

/** A draft edit of one campaign; omitted fields keep their value. */
export const CampaignPatchInput = Schema.Struct({
  campaignId: AdministrationCampaignId,
  ...AdministrationCampaignUpdateInput.fields,
}).annotate(strictParseOptions);
export type CampaignPatchInput = typeof CampaignPatchInput.Type;

export const CampaignDuplicateInput = Schema.Struct({
  campaignId: AdministrationCampaignId,
  ...AdministrationCampaignDuplicateRequest.fields,
}).annotate(strictParseOptions);
export type CampaignDuplicateInput = typeof CampaignDuplicateInput.Type;

export const CampaignAudiencePatchInput = Schema.Struct({
  audienceId: AdministrationCampaignAudienceId,
  ...AdministrationCampaignAudienceUpdate.fields,
}).annotate(strictParseOptions);
export type CampaignAudiencePatchInput = typeof CampaignAudiencePatchInput.Type;

export const CampaignTemplatePreviewInput = Schema.Struct({
  templateKey: AdministrationCampaignTemplateKey,
  preview: AdministrationCampaignTemplatePreviewInput,
}).annotate(strictParseOptions);
export type CampaignTemplatePreviewInput =
  typeof CampaignTemplatePreviewInput.Type;

export const CampaignTestSendInput = Schema.Struct({
  campaignId: AdministrationCampaignId,
  ...AdministrationCampaignTestSendInput.fields,
}).annotate(strictParseOptions);
export type CampaignTestSendInput = typeof CampaignTestSendInput.Type;

export const CampaignSendInput = Schema.Struct({
  campaignId: AdministrationCampaignId,
  ...AdministrationCampaignSendInput.fields,
}).annotate(strictParseOptions);
export type CampaignSendInput = typeof CampaignSendInput.Type;

export const CampaignRetryInput = Schema.Struct({
  campaignId: AdministrationCampaignId,
  ...AdministrationCampaignRetryInput.fields,
}).annotate(strictParseOptions);
export type CampaignRetryInput = typeof CampaignRetryInput.Type;

/**
 * Every campaign operation, the single contract the Admin UI, `/api/v1/cli`
 * and future adapters serve through `CampaignOperations.invoke`.
 */
export const campaignOperations = defineOperations({
  listCampaignAudiences: query({
    minimumDhwVersion: campaignsMinimumDhwVersion,
    input: NoInput,
    output: AdministrationCampaignAudiences,
  }),
  getCampaignAudience: query({
    minimumDhwVersion: campaignsMinimumDhwVersion,
    input: CampaignAudienceRef,
    output: AdministrationCampaignAudience,
  }),
  createCampaignAudience: mutation({
    minimumDhwVersion: campaignsMinimumDhwVersion,
    input: AdministrationCampaignAudienceCreateRequest,
    output: AdministrationCampaignAudience,
    ledger: true,
  }),
  updateCampaignAudience: mutation({
    minimumDhwVersion: campaignsMinimumDhwVersion,
    input: CampaignAudiencePatchInput,
    output: AdministrationCampaignAudience,
  }),
  archiveCampaignAudience: mutation({
    minimumDhwVersion: campaignsMinimumDhwVersion,
    input: CampaignAudienceRef,
    output: AdministrationCampaignAudience,
  }),
  unarchiveCampaignAudience: mutation({
    minimumDhwVersion: campaignsMinimumDhwVersion,
    input: CampaignAudienceRef,
    output: AdministrationCampaignAudience,
  }),
  deleteCampaignAudience: mutation({
    minimumDhwVersion: campaignsMinimumDhwVersion,
    input: CampaignAudienceRef,
    output: AdministrationCampaignAudienceDeleted,
  }),
  listCampaignTemplates: query({
    minimumDhwVersion: campaignsMinimumDhwVersion,
    input: NoInput,
    output: AdministrationCampaignTemplates,
  }),
  previewCampaignTemplate: query({
    minimumDhwVersion: campaignsMinimumDhwVersion,
    input: CampaignTemplatePreviewInput,
    output: AdministrationCampaignEmailPreview,
  }),
  listCampaigns: query({
    minimumDhwVersion: campaignsMinimumDhwVersion,
    input: NoInput,
    output: AdministrationCampaignSummaries,
  }),
  getCampaign: query({
    minimumDhwVersion: campaignsMinimumDhwVersion,
    input: CampaignRef,
    output: AdministrationCampaignDetail,
  }),
  /** The campaign with lossless document bodies, as the editor holds them. */
  getCampaignEditorContent: query({
    minimumDhwVersion: campaignsMinimumDhwVersion,
    input: CampaignRef,
    output: AdministrationCampaignEditorContent,
  }),
  createCampaign: mutation({
    minimumDhwVersion: campaignsMinimumDhwVersion,
    input: AdministrationCampaignCreateRequest,
    output: AdministrationCampaignDetail,
    ledger: true,
  }),
  updateCampaign: mutation({
    minimumDhwVersion: campaignsMinimumDhwVersion,
    input: CampaignPatchInput,
    output: AdministrationCampaignDetail,
  }),
  duplicateCampaign: mutation({
    minimumDhwVersion: campaignsMinimumDhwVersion,
    input: CampaignDuplicateInput,
    output: AdministrationCampaignDetail,
    ledger: true,
  }),
  deleteCampaign: mutation({
    minimumDhwVersion: campaignsMinimumDhwVersion,
    input: CampaignRef,
    output: AdministrationCampaignDeleted,
  }),
  previewCampaignRecipients: query({
    minimumDhwVersion: campaignsMinimumDhwVersion,
    input: CampaignRef,
    output: AdministrationCampaignRecipientPreview,
  }),
  getCampaignSettings: query({
    minimumDhwVersion: campaignsMinimumDhwVersion,
    input: NoInput,
    output: AdministrationCampaignSettings,
  }),
  testSendCampaign: mutation({
    minimumDhwVersion: campaignsMinimumDhwVersion,
    input: CampaignTestSendInput,
    output: AdministrationCampaignTestSendResult,
  }),
  sendCampaign: mutation({
    minimumDhwVersion: campaignsMinimumDhwVersion,
    input: CampaignSendInput,
    output: AdministrationCampaignSendResult,
  }),
  retryCampaign: mutation({
    minimumDhwVersion: campaignsMinimumDhwVersion,
    input: CampaignRetryInput,
    output: AdministrationCampaignRetryResult,
  }),
  getCampaignSendStatus: query({
    minimumDhwVersion: campaignsMinimumDhwVersion,
    input: CampaignRef,
    output: AdministrationCampaignSendStatusResult,
  }),
  getAutomation: query({
    minimumDhwVersion: automationsMinimumDhwVersion,
    input: CampaignRef,
    output: AutomationDetail,
  }),
  updateAutomationFlow: mutation({
    minimumDhwVersion: automationsMinimumDhwVersion,
    input: AutomationFlowUpdate,
    output: AutomationDetail,
  }),
  /** Starts the dry run of the current draft, or returns its job. */
  dryRunAutomation: mutation({
    minimumDhwVersion: automationsMinimumDhwVersion,
    input: CampaignRef,
    output: AutomationPreviewStatus,
  }),
  getAutomationDryRun: query({
    minimumDhwVersion: automationsMinimumDhwVersion,
    input: AutomationPreviewRef,
    output: AutomationDryRun,
  }),
  /** A retried activation returns the version the first one published. */
  activateAutomation: mutation({
    minimumDhwVersion: automationsMinimumDhwVersion,
    input: AutomationActivateInput,
    output: AutomationVersionSummary,
  }),
  pauseAutomation: mutation({
    minimumDhwVersion: automationsMinimumDhwVersion,
    input: CampaignRef,
    output: AutomationDetail,
  }),
  resumeAutomation: mutation({
    minimumDhwVersion: automationsMinimumDhwVersion,
    input: CampaignRef,
    output: AutomationDetail,
  }),
  archiveAutomation: mutation({
    minimumDhwVersion: automationsMinimumDhwVersion,
    input: CampaignRef,
    output: AutomationDetail,
  }),
  listAutomationVersions: query({
    minimumDhwVersion: automationsMinimumDhwVersion,
    input: CampaignRef,
    output: Schema.Array(AutomationVersionSummary),
  }),
  getAutomationVersion: query({
    minimumDhwVersion: automationsMinimumDhwVersion,
    input: AutomationVersionRef,
    output: AutomationVersionDetail,
  }),
  getAutomationRunStats: query({
    minimumDhwVersion: automationsMinimumDhwVersion,
    input: AutomationRunStatsInput,
    output: AutomationRunStats,
  }),
  listAutomationRuns: query({
    minimumDhwVersion: automationsMinimumDhwVersion,
    input: AutomationRunListInput,
    output: AutomationRunPage,
  }),
  getAutomationRun: query({
    minimumDhwVersion: automationsMinimumDhwVersion,
    input: AutomationRunRef,
    output: AutomationRunDetail,
  }),
  previewCalendarExpression: query({
    minimumDhwVersion: automationsMinimumDhwVersion,
    input: CalendarPreviewInput,
    output: CalendarPreview,
  }),
  getAutomationEngineHealth: query({
    minimumDhwVersion: automationsMinimumDhwVersion,
    input: NoInput,
    output: AutomationEngineHealth,
  }),
});
export type CampaignOperations = typeof campaignOperations;
export type CampaignOperationName = keyof CampaignOperations;

/** The `/api/v1/cli` endpoint of every campaign operation. */
export const campaignOperationEndpoints = operationEndpoints(
  campaignOperations,
  [AdminCliCampaignsApi, AdminCliAutomationsApi]
);
