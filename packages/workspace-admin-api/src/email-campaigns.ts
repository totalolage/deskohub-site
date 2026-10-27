import { Effect, Schema } from "effect";
import { AudienceFilter } from "./audience-filter";
import { AdministrationCampaignBodyDocument } from "./campaign-body-document";
import {
  AdministrationCampaignAudienceId,
  AdministrationCampaignId,
} from "./campaign-identifiers";
import {
  AdministrationCampaignLocale,
  AdministrationCampaignPurpose,
} from "./campaign-locale-and-purpose";
import { DhwVersion } from "./dhw-version";
import {
  AdministrationDotyposCustomerId,
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

export const administrationCampaignAudienceTitleMaxLength = 120;

/** A trimmed, non-empty audience title of at most 120 characters. */
export const AdministrationCampaignAudienceTitle = Schema.Trim.check(
  Schema.isNonEmpty(),
  Schema.isMaxLength(administrationCampaignAudienceTitleMaxLength)
);

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
  title: AdministrationCampaignAudienceTitle,
  filter: AudienceFilter,
}).annotate(strictParseOptions);
export type AdministrationCampaignAudienceInput =
  typeof AdministrationCampaignAudienceInput.Type;

/** The request ID makes a retried creation replay the first one's result. */
export const AdministrationCampaignAudienceCreateRequest = Schema.Struct({
  requestId: CliMutationRequestId,
  audience: AdministrationCampaignAudienceInput,
}).annotate(strictParseOptions);
export const AdministrationCampaignAudiences = Schema.Array(
  AdministrationCampaignAudience
);

export const AdministrationCampaignAudienceDeleted = Schema.Struct({
  id: AdministrationCampaignAudienceId,
});
export type AdministrationCampaignAudienceDeleted =
  typeof AdministrationCampaignAudienceDeleted.Type;

export type AdministrationCampaignAudienceCreateRequest =
  typeof AdministrationCampaignAudienceCreateRequest.Type;

export const AdministrationCampaignAudienceUpdate = Schema.Struct({
  title: Schema.optionalKey(AdministrationCampaignAudienceTitle),
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

export const AdministrationCampaignTemplates = Schema.Array(
  AdministrationCampaignTemplate
);

const AdministrationCampaignOperationalReason = Schema.Trim.check(
  Schema.isNonEmpty()
);

const localeTexts = {
  subject: Schema.String,
  preheader: Schema.String,
  /** Replaces an operational campaign's footer reason line. */
  operationalReason: Schema.optionalKey(
    AdministrationCampaignOperationalReason
  ),
};

/**
 * One locale's texts. The body is Markdown; a line
 * `[[button: Label](https://example.com)]` makes a button. The server parses
 * and validates it, and exports stored bodies back to Markdown.
 */
export const AdministrationCampaignLocaleContent = Schema.Struct({
  ...localeTexts,
  bodyMarkdown: Schema.String,
}).annotate(strictParseOptions);
export type AdministrationCampaignLocaleContent =
  typeof AdministrationCampaignLocaleContent.Type;

/**
 * One locale's texts with the body as the editor's document, which keeps
 * everything the editor holds. Markdown can't: it re-reads typed text such
 * as a leading `# ` as formatting.
 */
export const AdministrationCampaignEditorLocaleContent = Schema.Struct({
  ...localeTexts,
  bodyDocument: AdministrationCampaignBodyDocument,
}).annotate(strictParseOptions);
export type AdministrationCampaignEditorLocaleContent =
  typeof AdministrationCampaignEditorLocaleContent.Type;

/** One locale's texts as a writer gives them: a Markdown or document body. */
export const AdministrationCampaignLocaleContentInput = Schema.Union([
  AdministrationCampaignLocaleContent,
  AdministrationCampaignEditorLocaleContent,
]);
export type AdministrationCampaignLocaleContentInput =
  typeof AdministrationCampaignLocaleContentInput.Type;

/** Per-locale campaign texts; a locale without content is absent. */
export const AdministrationCampaignContent = Schema.Record(
  AdministrationCampaignLocale,
  Schema.optionalKey(AdministrationCampaignLocaleContent)
);
export type AdministrationCampaignContent =
  typeof AdministrationCampaignContent.Type;

/** Per-locale texts a new campaign starts with; a locale without content is absent. */
export const AdministrationCampaignContentInput = Schema.Record(
  AdministrationCampaignLocale,
  Schema.optionalKey(AdministrationCampaignLocaleContentInput)
);
export type AdministrationCampaignContentInput =
  typeof AdministrationCampaignContentInput.Type;

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

/** A campaign with its texts as the editor holds them. */
export const AdministrationCampaignEditorContent = Schema.Struct({
  ...AdministrationCampaignSummary.fields,
  content: Schema.Record(
    AdministrationCampaignLocale,
    Schema.optionalKey(AdministrationCampaignEditorLocaleContent)
  ),
});
export type AdministrationCampaignEditorContent =
  typeof AdministrationCampaignEditorContent.Type;

export const AdministrationCampaignCreateInput = Schema.Struct({
  title: AdministrationCampaignTitle,
  purpose: AdministrationCampaignPurpose,
  templateKey: AdministrationCampaignTemplateKey,
  /** `once` when omitted. */
  delivery: Schema.optionalKey(AdministrationCampaignDelivery),
  audienceId: Schema.NullOr(AdministrationCampaignAudienceId),
  content: AdministrationCampaignContentInput,
}).annotate(strictParseOptions);
export type AdministrationCampaignCreateInput =
  typeof AdministrationCampaignCreateInput.Type;

export const AdministrationCampaignSummaries = Schema.Array(
  AdministrationCampaignSummary
);

export const AdministrationCampaignDeleted = Schema.Struct({
  id: AdministrationCampaignId,
});
export type AdministrationCampaignDeleted =
  typeof AdministrationCampaignDeleted.Type;

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
 * campaign has no content for yet needs a subject and a body, given as
 * `bodyMarkdown` or `bodyDocument` but not both.
 */
export const AdministrationCampaignLocaleContentChange = Schema.Struct({
  subject: Schema.optionalKey(Schema.String),
  preheader: Schema.optionalKey(Schema.String),
  bodyMarkdown: Schema.optionalKey(Schema.String),
  bodyDocument: Schema.optionalKey(AdministrationCampaignBodyDocument),
  operationalReason: Schema.optionalKey(
    Schema.NullOr(AdministrationCampaignOperationalReason)
  ),
})
  .check(
    Schema.makeFilter(
      (change) =>
        change.bodyMarkdown === undefined ||
        change.bodyDocument === undefined ||
        "Give the body as bodyMarkdown or bodyDocument, not both."
    )
  )
  .annotate(strictParseOptions);
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

/**
 * Renders unsaved texts, texts still being written, or a saved campaign's
 * locale in a template. Unsaved `Content` must meet the rules saving applies;
 * `UnfinishedContent` skips the body's content rules, so links, buttons and
 * images may be incomplete or point anywhere.
 */
export const AdministrationCampaignTemplatePreviewInput = Schema.Union([
  Schema.TaggedStruct("Content", {
    purpose: AdministrationCampaignPurpose,
    locale: AdministrationCampaignLocale,
    content: AdministrationCampaignLocaleContentInput,
  }).annotate(strictParseOptions),
  Schema.TaggedStruct("UnfinishedContent", {
    purpose: AdministrationCampaignPurpose,
    locale: AdministrationCampaignLocale,
    content: AdministrationCampaignLocaleContentInput,
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

/** The deployment's campaign settings a composer shows. */
export const AdministrationCampaignSettings = Schema.Struct({
  /**
   * The inbox every test send reaches, or null where campaign email isn't
   * configured; a test send then reports the missing settings.
   */
  testSendInbox: Schema.NullOr(Schema.String),
});
export type AdministrationCampaignSettings =
  typeof AdministrationCampaignSettings.Type;

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
export const campaignErrors = [
  CliInputInvalid.schema,
  CliMutationInProgress.schema,
  CliMutationRejected.schema,
  CliResourceNotFound.schema,
  CliServiceUnavailable.schema,
];

/**
 * The first `dhw` release that decodes the first visit, "any time so far",
 * and one campaign's emails. An older binary drops a stored filter's
 * `campaign` and would write "any campaign" back, so every campaign and
 * audience operation, reads included, requires it.
 */
export const campaignsMinimumDhwVersion = DhwVersion.make("1.20.0");
