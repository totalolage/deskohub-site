import { Effect, Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup } from "effect/unstable/httpapi";
import { AudienceFilter } from "./audience-filter";
import {
  AdministrationCampaignLocale,
  AdministrationCampaignPurpose,
} from "./campaign-locale-and-purpose";
import {
  AdministrationDotyposCustomerId,
  CliBearerAuthentication,
  CliClientCompatibility,
  CliInputInvalid,
  CliMutationInProgress,
  CliMutationRejected,
  CliMutationRequestId,
  CliResourceNotFound,
  CliServiceUnavailable,
} from "./workspace-admin-api";

const strictParseOptions = {
  parseOptions: { errors: "all", onExcessProperty: "error" },
} as const;

export const AdministrationCampaignId = Schema.NonEmptyString.pipe(
  Schema.brand("CampaignId")
).annotate({
  identifier: "CampaignId",
  description: "Database-generated identifier of one email campaign.",
});
export type AdministrationCampaignId = typeof AdministrationCampaignId.Type;

export const AdministrationCampaignAudienceId = Schema.NonEmptyString.pipe(
  Schema.brand("CampaignAudienceId")
).annotate({
  identifier: "CampaignAudienceId",
  description: "Database-generated identifier of one saved campaign audience.",
});
export type AdministrationCampaignAudienceId =
  typeof AdministrationCampaignAudienceId.Type;

export const AdministrationCampaignSendId = Schema.NonEmptyString.pipe(
  Schema.brand("CampaignSendId")
).annotate({
  identifier: "CampaignSendId",
  description:
    "Database-generated identifier of the send that froze a campaign's recipients.",
});
export type AdministrationCampaignSendId =
  typeof AdministrationCampaignSendId.Type;

export const AdministrationCampaignTemplateKey = Schema.Literals(["workspace"]);
export type AdministrationCampaignTemplateKey =
  typeof AdministrationCampaignTemplateKey.Type;

/** Chosen at creation and never changed. */
export const AdministrationCampaignDelivery = Schema.Literals([
  "once",
  "automated",
]);
export type AdministrationCampaignDelivery =
  typeof AdministrationCampaignDelivery.Type;

/** One-off statuses, then the statuses only an automated campaign has. */
export const AdministrationCampaignStatus = Schema.Literals([
  "draft",
  "sending",
  "sent",
  "failed",
  "active",
  "paused",
  "archived",
]);
export type AdministrationCampaignStatus =
  typeof AdministrationCampaignStatus.Type;

export const AdministrationCampaignRecipientStatus = Schema.Literals([
  "pending",
  "sent",
  "delivered",
  "bounced",
  "complained",
  "failed",
  "unconfirmed",
  "skipped",
]);
export type AdministrationCampaignRecipientStatus =
  typeof AdministrationCampaignRecipientStatus.Type;

/** Why a recipient was skipped at delivery instead of mailed. */
export const AdministrationCampaignRecipientSkipReason = Schema.Literals([
  "missing-from-dotypos",
  "deleted-customer",
  "missing-email",
  "invalid-email",
  "consent-withdrawn",
  "outside-test-domain",
]);
export type AdministrationCampaignRecipientSkipReason =
  typeof AdministrationCampaignRecipientSkipReason.Type;

const AdministrationCampaignTitle = Schema.Trim.check(Schema.isNonEmpty());

export const AdministrationCampaignAudience = Schema.Struct({
  id: AdministrationCampaignAudienceId,
  title: Schema.String,
  filter: AudienceFilter,
  archivedAt: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  updatedAt: Schema.String,
});
export type AdministrationCampaignAudience =
  typeof AdministrationCampaignAudience.Type;

export const AdministrationCampaignAudienceInput = Schema.Struct({
  title: AdministrationCampaignTitle,
  filter: AudienceFilter,
}).annotate(strictParseOptions);
export type AdministrationCampaignAudienceInput =
  typeof AdministrationCampaignAudienceInput.Type;

/** The request ID makes a retried creation replay the first one's result. */
export const AdministrationCampaignAudienceCreateRequest = Schema.Struct({
  requestId: CliMutationRequestId,
  audience: AdministrationCampaignAudienceInput,
}).annotate(strictParseOptions);
export type AdministrationCampaignAudienceCreateRequest =
  typeof AdministrationCampaignAudienceCreateRequest.Type;

export const AdministrationCampaignAudienceUpdate = Schema.Struct({
  title: Schema.optionalKey(AdministrationCampaignTitle),
  filter: Schema.optionalKey(AudienceFilter),
}).annotate(strictParseOptions);
export type AdministrationCampaignAudienceUpdate =
  typeof AdministrationCampaignAudienceUpdate.Type;

export const AdministrationCampaignTemplate = Schema.Struct({
  key: AdministrationCampaignTemplateKey,
  name: Schema.String,
  description: Schema.String,
});
export type AdministrationCampaignTemplate =
  typeof AdministrationCampaignTemplate.Type;

const AdministrationCampaignOperationalReason = Schema.Trim.check(
  Schema.isNonEmpty()
);

/**
 * One locale's texts. The body is Markdown; a line
 * `[[button: Label](https://example.com)]` makes a button. The server parses
 * and validates it, and exports stored bodies back to Markdown.
 */
export const AdministrationCampaignLocaleContent = Schema.Struct({
  subject: Schema.String,
  preheader: Schema.String,
  bodyMarkdown: Schema.String,
  /** Replaces an operational campaign's footer reason line. */
  operationalReason: Schema.optionalKey(
    AdministrationCampaignOperationalReason
  ),
}).annotate(strictParseOptions);
export type AdministrationCampaignLocaleContent =
  typeof AdministrationCampaignLocaleContent.Type;

/** Per-locale campaign texts; a locale without content is absent. */
export const AdministrationCampaignContent = Schema.Record(
  AdministrationCampaignLocale,
  Schema.optionalKey(AdministrationCampaignLocaleContent)
);
export type AdministrationCampaignContent =
  typeof AdministrationCampaignContent.Type;

export const AdministrationCampaignSummary = Schema.Struct({
  id: AdministrationCampaignId,
  title: Schema.String,
  purpose: AdministrationCampaignPurpose,
  templateKey: AdministrationCampaignTemplateKey,
  /** Servers and stored results that predate automated campaigns omit it. */
  delivery: AdministrationCampaignDelivery.pipe(
    Schema.withDecodingDefaultTypeKey(Effect.succeed("once" as const))
  ),
  status: AdministrationCampaignStatus,
  audienceId: Schema.NullOr(AdministrationCampaignAudienceId),
  locales: Schema.Array(AdministrationCampaignLocale),
  createdAt: Schema.String,
  updatedAt: Schema.String,
});
export type AdministrationCampaignSummary =
  typeof AdministrationCampaignSummary.Type;

export const AdministrationCampaignDetail = Schema.Struct({
  ...AdministrationCampaignSummary.fields,
  content: AdministrationCampaignContent,
});
export type AdministrationCampaignDetail =
  typeof AdministrationCampaignDetail.Type;

export const AdministrationCampaignCreateInput = Schema.Struct({
  title: AdministrationCampaignTitle,
  purpose: AdministrationCampaignPurpose,
  templateKey: AdministrationCampaignTemplateKey,
  audienceId: Schema.NullOr(AdministrationCampaignAudienceId),
  content: AdministrationCampaignContent,
}).annotate(strictParseOptions);
export type AdministrationCampaignCreateInput =
  typeof AdministrationCampaignCreateInput.Type;

/** The request ID makes a retried creation replay the first one's draft. */
export const AdministrationCampaignCreateRequest = Schema.Struct({
  requestId: CliMutationRequestId,
  campaign: AdministrationCampaignCreateInput,
}).annotate(strictParseOptions);
export type AdministrationCampaignCreateRequest =
  typeof AdministrationCampaignCreateRequest.Type;

/** The request ID makes a retried duplication replay the first one's draft. */
export const AdministrationCampaignDuplicateRequest = Schema.Struct({
  requestId: CliMutationRequestId,
}).annotate(strictParseOptions);
export type AdministrationCampaignDuplicateRequest =
  typeof AdministrationCampaignDuplicateRequest.Type;

/**
 * Changes to one locale's texts. Omitted fields keep their value; a null
 * `operationalReason` restores the default reason line. A locale the
 * campaign has no content for yet needs a subject and a body.
 */
export const AdministrationCampaignLocaleContentChange = Schema.Struct({
  subject: Schema.optionalKey(Schema.String),
  preheader: Schema.optionalKey(Schema.String),
  bodyMarkdown: Schema.optionalKey(Schema.String),
  operationalReason: Schema.optionalKey(
    Schema.NullOr(AdministrationCampaignOperationalReason)
  ),
}).annotate(strictParseOptions);
export type AdministrationCampaignLocaleContentChange =
  typeof AdministrationCampaignLocaleContentChange.Type;

/**
 * A draft edit. Omitted fields keep their value. In `content`, a locale
 * mapped to null loses its content; omitted locales are unchanged.
 */
export const AdministrationCampaignUpdateInput = Schema.Struct({
  title: Schema.optionalKey(AdministrationCampaignTitle),
  purpose: Schema.optionalKey(AdministrationCampaignPurpose),
  templateKey: Schema.optionalKey(AdministrationCampaignTemplateKey),
  audienceId: Schema.optionalKey(
    Schema.NullOr(AdministrationCampaignAudienceId)
  ),
  content: Schema.optionalKey(
    Schema.Record(
      AdministrationCampaignLocale,
      Schema.optionalKey(
        Schema.NullOr(AdministrationCampaignLocaleContentChange)
      )
    )
  ),
}).annotate(strictParseOptions);
export type AdministrationCampaignUpdateInput =
  typeof AdministrationCampaignUpdateInput.Type;

/** Renders either unsaved texts or a saved campaign's locale in a template. */
export const AdministrationCampaignTemplatePreviewInput = Schema.Union([
  Schema.TaggedStruct("Content", {
    purpose: AdministrationCampaignPurpose,
    locale: AdministrationCampaignLocale,
    content: AdministrationCampaignLocaleContent,
  }).annotate(strictParseOptions),
  Schema.TaggedStruct("Campaign", {
    campaignId: AdministrationCampaignId,
    locale: AdministrationCampaignLocale,
  }).annotate(strictParseOptions),
]);
export type AdministrationCampaignTemplatePreviewInput =
  typeof AdministrationCampaignTemplatePreviewInput.Type;

export const AdministrationCampaignEmailPreview = Schema.Struct({
  subject: Schema.String,
  html: Schema.String,
  text: Schema.String,
});
export type AdministrationCampaignEmailPreview =
  typeof AdministrationCampaignEmailPreview.Type;

export const AdministrationCampaignRecipientExclusionReason = Schema.Literals([
  "missing-from-dotypos",
  "deleted-customer",
  "missing-email",
  "invalid-email",
]);
export type AdministrationCampaignRecipientExclusionReason =
  typeof AdministrationCampaignRecipientExclusionReason.Type;

/** Who the campaign's audience reaches now, and who it can't. */
export const AdministrationCampaignRecipientPreview = Schema.Struct({
  recipients: Schema.Array(
    Schema.Struct({
      customerId: AdministrationDotyposCustomerId,
      locale: AdministrationCampaignLocale,
      email: Schema.String,
    })
  ),
  exclusions: Schema.Array(
    Schema.Struct({
      customerId: AdministrationDotyposCustomerId,
      reason: AdministrationCampaignRecipientExclusionReason,
    })
  ),
  /** Customers sharing one email; only `recipientCustomerId` is mailed. */
  duplicates: Schema.Array(
    Schema.Struct({
      email: Schema.String,
      recipientCustomerId: AdministrationDotyposCustomerId,
      duplicateCustomerIds: Schema.Array(AdministrationDotyposCustomerId),
    })
  ),
});
export type AdministrationCampaignRecipientPreview =
  typeof AdministrationCampaignRecipientPreview.Type;

/** Extra test recipients; the admin inbox is always included. */
export const AdministrationCampaignTestSendInput = Schema.Struct({
  recipients: Schema.Array(Schema.Trim.check(Schema.isNonEmpty())),
}).annotate(strictParseOptions);
export type AdministrationCampaignTestSendInput =
  typeof AdministrationCampaignTestSendInput.Type;

export const AdministrationCampaignTestSendResult = Schema.Struct({
  /** The admin inbox first, then the extra recipients. */
  recipients: Schema.Array(Schema.String),
  /** Every recipient got one `[TEST]` email per locale. */
  locales: Schema.Array(AdministrationCampaignLocale),
  /** When the confirmation code in these emails expires. */
  codeExpiresAt: Schema.String,
});
export type AdministrationCampaignTestSendResult =
  typeof AdministrationCampaignTestSendResult.Type;

/** The code from the latest test email confirms the real send. */
export const AdministrationCampaignSendInput = Schema.Struct({
  confirmationCode: Schema.Trim.check(Schema.isNonEmpty()),
}).annotate(strictParseOptions);
export type AdministrationCampaignSendInput =
  typeof AdministrationCampaignSendInput.Type;

const count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

export const AdministrationCampaignSendResult = Schema.Struct({
  sendId: AdministrationCampaignSendId,
  recipientCount: count,
});
export type AdministrationCampaignSendResult =
  typeof AdministrationCampaignSendResult.Type;

/**
 * Retries pending and failed recipients. `unconfirmed` recipients may
 * already have the email, so they're mailed again only when included.
 */
export const AdministrationCampaignRetryInput = Schema.Struct({
  includeUnconfirmed: Schema.Boolean,
}).annotate(strictParseOptions);
export type AdministrationCampaignRetryInput =
  typeof AdministrationCampaignRetryInput.Type;

export const AdministrationCampaignRetryResult = Schema.Struct({
  sendId: AdministrationCampaignSendId,
  retriedCount: count,
});
export type AdministrationCampaignRetryResult =
  typeof AdministrationCampaignRetryResult.Type;

export const AdministrationCampaignSendStatus = Schema.Struct({
  sendId: AdministrationCampaignSendId,
  createdAt: Schema.String,
  completedAt: Schema.NullOr(Schema.String),
  audienceId: Schema.NullOr(AdministrationCampaignAudienceId),
  /** The filter snapshot the recipients were resolved with. */
  audienceFilter: AudienceFilter,
  counts: Schema.Record(AdministrationCampaignRecipientStatus, count),
  recipients: Schema.Array(
    Schema.Struct({
      customerId: AdministrationDotyposCustomerId,
      locale: AdministrationCampaignLocale,
      status: AdministrationCampaignRecipientStatus,
      /** Set exactly when the status is `skipped`. */
      skipReason: Schema.NullOr(AdministrationCampaignRecipientSkipReason),
      statusUpdatedAt: Schema.String,
    })
  ),
});
export type AdministrationCampaignSendStatus =
  typeof AdministrationCampaignSendStatus.Type;

/** `send` is null until the campaign is sent. */
export const AdministrationCampaignSendStatusResult = Schema.Struct({
  send: Schema.NullOr(AdministrationCampaignSendStatus),
});
export type AdministrationCampaignSendStatusResult =
  typeof AdministrationCampaignSendStatusResult.Type;

/**
 * Campaign endpoints share one error set: invalid input (400), a missing
 * campaign or audience (404), a state conflict or a creation still being
 * applied under the same request ID (409), and an unavailable dependency
 * (503).
 */
const campaignErrors = [
  CliInputInvalid.schema,
  CliMutationInProgress.schema,
  CliMutationRejected.schema,
  CliResourceNotFound.schema,
  CliServiceUnavailable.schema,
];

const campaignParams = { campaignId: AdministrationCampaignId };
const audienceParams = { audienceId: AdministrationCampaignAudienceId };

export const AdminCliCampaignsApi = HttpApiGroup.make("campaigns")
  .add(
    HttpApiEndpoint.get("listCampaignAudiences", "/campaign-audiences", {
      success: Schema.Array(AdministrationCampaignAudience),
      error: campaignErrors,
    })
  )
  .add(
    HttpApiEndpoint.get(
      "getCampaignAudience",
      "/campaign-audiences/:audienceId",
      {
        params: audienceParams,
        success: AdministrationCampaignAudience,
        error: campaignErrors,
      }
    )
  )
  .add(
    HttpApiEndpoint.post("createCampaignAudience", "/campaign-audiences", {
      payload: AdministrationCampaignAudienceCreateRequest,
      success: AdministrationCampaignAudience,
      error: campaignErrors,
    })
  )
  .add(
    HttpApiEndpoint.patch(
      "updateCampaignAudience",
      "/campaign-audiences/:audienceId",
      {
        params: audienceParams,
        payload: AdministrationCampaignAudienceUpdate,
        success: AdministrationCampaignAudience,
        error: campaignErrors,
      }
    )
  )
  .add(
    HttpApiEndpoint.post(
      "archiveCampaignAudience",
      "/campaign-audiences/:audienceId/archive",
      {
        params: audienceParams,
        success: AdministrationCampaignAudience,
        error: campaignErrors,
      }
    )
  )
  .add(
    HttpApiEndpoint.post(
      "unarchiveCampaignAudience",
      "/campaign-audiences/:audienceId/unarchive",
      {
        params: audienceParams,
        success: AdministrationCampaignAudience,
        error: campaignErrors,
      }
    )
  )
  .add(
    HttpApiEndpoint.delete(
      "deleteCampaignAudience",
      "/campaign-audiences/:audienceId",
      {
        params: audienceParams,
        success: Schema.Struct({ id: AdministrationCampaignAudienceId }),
        error: campaignErrors,
      }
    )
  )
  .add(
    HttpApiEndpoint.get("listCampaignTemplates", "/campaign-templates", {
      success: Schema.Array(AdministrationCampaignTemplate),
    })
  )
  .add(
    HttpApiEndpoint.post(
      "previewCampaignTemplate",
      "/campaign-templates/:templateKey/preview",
      {
        params: { templateKey: AdministrationCampaignTemplateKey },
        payload: AdministrationCampaignTemplatePreviewInput,
        success: AdministrationCampaignEmailPreview,
        error: campaignErrors,
      }
    )
  )
  .add(
    HttpApiEndpoint.get("listCampaigns", "/campaigns", {
      success: Schema.Array(AdministrationCampaignSummary),
      error: campaignErrors,
    })
  )
  .add(
    HttpApiEndpoint.get("getCampaign", "/campaigns/:campaignId", {
      params: campaignParams,
      success: AdministrationCampaignDetail,
      error: campaignErrors,
    })
  )
  .add(
    HttpApiEndpoint.post("createCampaign", "/campaigns", {
      payload: AdministrationCampaignCreateRequest,
      success: AdministrationCampaignDetail,
      error: campaignErrors,
    })
  )
  .add(
    HttpApiEndpoint.patch("updateCampaign", "/campaigns/:campaignId", {
      params: campaignParams,
      payload: AdministrationCampaignUpdateInput,
      success: AdministrationCampaignDetail,
      error: campaignErrors,
    })
  )
  .add(
    HttpApiEndpoint.post(
      "duplicateCampaign",
      "/campaigns/:campaignId/duplicate",
      {
        params: campaignParams,
        payload: AdministrationCampaignDuplicateRequest,
        success: AdministrationCampaignDetail,
        error: campaignErrors,
      }
    )
  )
  .add(
    HttpApiEndpoint.delete("deleteCampaign", "/campaigns/:campaignId", {
      params: campaignParams,
      success: Schema.Struct({ id: AdministrationCampaignId }),
      error: campaignErrors,
    })
  )
  .add(
    HttpApiEndpoint.get(
      "previewCampaignRecipients",
      "/campaigns/:campaignId/recipients",
      {
        params: campaignParams,
        success: AdministrationCampaignRecipientPreview,
        error: campaignErrors,
      }
    )
  )
  .add(
    HttpApiEndpoint.post(
      "testSendCampaign",
      "/campaigns/:campaignId/test-send",
      {
        params: campaignParams,
        payload: AdministrationCampaignTestSendInput,
        success: AdministrationCampaignTestSendResult,
        error: campaignErrors,
      }
    )
  )
  .add(
    HttpApiEndpoint.post("sendCampaign", "/campaigns/:campaignId/send", {
      params: campaignParams,
      payload: AdministrationCampaignSendInput,
      success: AdministrationCampaignSendResult,
      error: campaignErrors,
    })
  )
  .add(
    HttpApiEndpoint.post("retryCampaign", "/campaigns/:campaignId/retry", {
      params: campaignParams,
      payload: AdministrationCampaignRetryInput,
      success: AdministrationCampaignRetryResult,
      error: campaignErrors,
    })
  )
  .add(
    HttpApiEndpoint.get(
      "getCampaignSendStatus",
      "/campaigns/:campaignId/status",
      {
        params: campaignParams,
        success: AdministrationCampaignSendStatusResult,
        error: campaignErrors,
      }
    )
  )
  .middleware(CliBearerAuthentication)
  // Added last, so it runs first: an outdated `dhw` is refused before its
  // session is read. Every campaign endpoint already declares the
  // `CliInputInvalid` it fails with, so released binaries print it.
  .middleware(CliClientCompatibility)
  .prefix("/api/v1/cli");
