import { Data, type Schema } from "effect";
import type { BetterAuthSecretsMessage } from "@/features/account/backend/auth/auth-secrets";
import type { Locale } from "@/features/i18n";
import type { AudienceFilterUses } from "./audience-filter-usage";
import type { InvalidCampaignBody } from "./body/invalid-campaign-body";
import type { CampaignAudienceId, CampaignId } from "./campaign-identifiers";
import type { CampaignDelivery, CampaignStatus } from "./campaign-states";

export class CampaignNotFound extends Data.TaggedError("CampaignNotFound")<{
  readonly campaignId: CampaignId;
}> {}

export class CampaignAudienceNotFound extends Data.TaggedError(
  "CampaignAudienceNotFound"
)<{
  readonly audienceId: CampaignAudienceId;
}> {}

/**
 * Campaign content failed the body document rules (TipTap schema, link and
 * image hosts, CTA fields).
 */
export class CampaignContentInvalid extends Data.TaggedError(
  "CampaignContentInvalid"
)<{
  readonly cause: Schema.SchemaError;
}> {}

/**
 * A campaign edit adds an image that wasn't uploaded through the campaign
 * editor: it isn't in a campaign image folder of the Deskohub Cloudinary
 * account, and the campaign doesn't have it yet.
 */
export class CampaignImageNotUploaded extends Data.TaggedError(
  "CampaignImageNotUploaded"
)<{
  readonly locale: Locale;
  readonly source: string;
}> {}

/** A locale's Markdown body in a campaign edit isn't valid campaign Markdown. */
export class CampaignBodyMarkdownInvalid extends Data.TaggedError(
  "CampaignBodyMarkdownInvalid"
)<{
  readonly locale: Locale;
  readonly cause: InvalidCampaignBody;
}> {
  /** Stable across transports, so clients can tell this rejection apart. */
  static readonly code = "content-markdown-invalid";
}

/** A locale's document body in a campaign edit breaks the content rules. */
export class CampaignBodyDocumentInvalid extends Data.TaggedError(
  "CampaignBodyDocumentInvalid"
)<{
  readonly locale: Locale;
  readonly cause: InvalidCampaignBody;
}> {
  /** Stable across transports, so clients can tell this rejection apart. */
  static readonly code = "content-document-invalid";
}

/**
 * A campaign edit adds a locale the campaign has no content for without
 * giving both its subject and its body.
 */
export class CampaignLocaleContentMissing extends Data.TaggedError(
  "CampaignLocaleContentMissing"
)<{
  readonly campaignId: CampaignId;
  readonly locale: Locale;
}> {
  /** Stable across transports, so clients can tell this rejection apart. */
  static readonly code = "content-locale-missing";
}

/**
 * The campaign's content and audience are frozen: a one-off campaign left
 * Draft, or an automated one was archived.
 */
export class CampaignReadOnly extends Data.TaggedError("CampaignReadOnly")<{
  readonly campaignId: CampaignId;
  readonly status: Exclude<CampaignStatus, "draft">;
}> {
  /** Stable across transports, so clients can tell this conflict apart. */
  static readonly code = "campaign-read-only";
}

/**
 * An automated campaign that published a version can't be deleted: its runs
 * and sends reference that version. Archive it instead.
 */
export class CampaignPublished extends Data.TaggedError("CampaignPublished")<{
  readonly campaignId: CampaignId;
}> {
  /** Stable across transports, so clients can tell this conflict apart. */
  static readonly code = "campaign-published";
}

/**
 * A one-off operation (test send, confirmation, send, retry) was asked of an
 * automated campaign.
 */
export class CampaignDeliveryMismatch extends Data.TaggedError(
  "CampaignDeliveryMismatch"
)<{
  readonly campaignId: CampaignId;
  readonly delivery: CampaignDelivery;
}> {
  /** Stable across transports, so clients can tell this conflict apart. */
  static readonly code = "campaign-delivery-mismatch";
}

/**
 * Draft campaigns use the audience, or conditions of non-archived automated
 * campaigns (working copy or active version) reference it, so it can be
 * archived but not deleted.
 */
export class CampaignAudienceInUse extends Data.TaggedError(
  "CampaignAudienceInUse"
)<{
  readonly audienceId: CampaignAudienceId;
  readonly draftCampaignIds: readonly CampaignId[];
  /** Automated campaigns whose conditions reference the audience. */
  readonly automationCampaignIds?: readonly CampaignId[];
}> {
  /** Stable across transports, so clients can tell this conflict apart. */
  static readonly code = "audience-in-use";
}

/** An archived audience can't be assigned to a campaign. */
export class CampaignAudienceArchived extends Data.TaggedError(
  "CampaignAudienceArchived"
)<{
  readonly audienceId: CampaignAudienceId;
}> {}

/**
 * The audience filter uses attributes, periods, or campaign sources its
 * context can't hold: a saved audience, and so a one-off campaign, can't
 * hold trigger-relative periods or "this campaign".
 */
export class AudienceFilterContextInvalid extends Data.TaggedError(
  "AudienceFilterContextInvalid"
)<{
  readonly uses: AudienceFilterUses;
}> {
  /** Stable across transports, so clients can tell this rejection apart. */
  static readonly code = "audience-filter-context";
}

/** The audience filter counts emails of campaigns that don't exist. */
export class AudienceFilterCampaignNotFound extends Data.TaggedError(
  "AudienceFilterCampaignNotFound"
)<{
  readonly campaignIds: readonly CampaignId[];
}> {
  /** Stable across transports, so clients can tell this rejection apart. */
  static readonly code = "audience-filter-campaign-not-found";
}

export type CampaignConfirmationRejection =
  | "unknown-code"
  | "superseded"
  | "expired"
  | "content-changed"
  | "too-many-attempts";

/**
 * The typed confirmation code can't confirm the real send. Every rejection
 * needs a new test send except `unknown-code`, which may be a typo. A typed
 * code other than the current one counts as a failed attempt against it,
 * and the fifth failure supersedes it (`too-many-attempts`).
 */
export class CampaignConfirmationRejected extends Data.TaggedError(
  "CampaignConfirmationRejected"
)<{
  readonly campaignId: CampaignId;
  readonly reason: CampaignConfirmationRejection;
}> {}

/**
 * `BETTER_AUTH_SECRETS` holds no valid signing secret to key the
 * confirmation-code hashes and unsubscribe tokens with.
 */
export class CampaignSigningKeyInvalid extends Data.TaggedError(
  "CampaignSigningKeyInvalid"
)<{
  readonly message: BetterAuthSecretsMessage;
}> {}

/**
 * Recipients couldn't be resolved because a source was unavailable. The
 * resolution never returns a partial list, so the operator can retry.
 */
export class CampaignRecipientResolutionError extends Data.TaggedError(
  "CampaignRecipientResolutionError"
)<{
  readonly source: "dotypos" | "database";
  readonly cause: unknown;
}> {
  static readonly dotypos = (cause: unknown) =>
    new CampaignRecipientResolutionError({ source: "dotypos", cause });

  static readonly database = (cause: unknown) =>
    new CampaignRecipientResolutionError({ source: "database", cause });
}

/**
 * Outside production, campaign mail (test sends included) may reach only the
 * email test domain.
 */
export class CampaignRecipientsOutsideTestDomain extends Data.TaggedError(
  "CampaignRecipientsOutsideTestDomain"
)<{
  readonly recipientCount: number;
}> {}

/** A test-send address the admin typed isn't a valid email address. */
export class CampaignTestRecipientInvalid extends Data.TaggedError(
  "CampaignTestRecipientInvalid"
)<{
  readonly email: string;
}> {}

/** The campaign has no locale with content, so there is nothing to send. */
export class CampaignContentMissing extends Data.TaggedError(
  "CampaignContentMissing"
)<{
  readonly campaignId: CampaignId;
}> {}

/**
 * Recipients outside the content's locales would get the Czech fallback,
 * which the campaign lacks: it needs Czech content unless its audience is
 * restricted to a single locale it has content for.
 */
export class CampaignFallbackContentMissing extends Data.TaggedError(
  "CampaignFallbackContentMissing"
)<{
  readonly campaignId: CampaignId;
}> {}

/** A real send needs an audience to resolve recipients from. */
export class CampaignAudienceMissing extends Data.TaggedError(
  "CampaignAudienceMissing"
)<{
  readonly campaignId: CampaignId;
}> {}

/** The audience resolved to nobody the campaign can reach. */
export class CampaignNoRecipients extends Data.TaggedError(
  "CampaignNoRecipients"
)<{
  readonly campaignId: CampaignId;
}> {}

/** The email provider didn't accept a campaign test email. */
export class CampaignEmailDeliveryFailed extends Data.TaggedError(
  "CampaignEmailDeliveryFailed"
)<{
  readonly cause: unknown;
}> {}

/**
 * The frozen send couldn't be handed to the delivery queue. The campaign is
 * marked Failed, so retrying the undelivered recipients queues it again.
 */
export class CampaignDeliveryQueueFailed extends Data.TaggedError(
  "CampaignDeliveryQueueFailed"
)<{
  readonly campaignId: CampaignId;
  readonly cause: unknown;
}> {}

/** Only a Failed campaign can retry its undelivered recipients. */
export class CampaignNotRetryable extends Data.TaggedError(
  "CampaignNotRetryable"
)<{
  readonly campaignId: CampaignId;
  readonly status: CampaignStatus;
}> {}

/** Production campaign mail needs its sender and admin inbox configured. */
export class CampaignEmailNotConfigured extends Data.TaggedError(
  "CampaignEmailNotConfigured"
)<{
  readonly variables: readonly string[];
}> {}

/** An unsubscribe link token is malformed, forged, or names no recipient. */
export class CampaignUnsubscribeTokenInvalid extends Data.TaggedError(
  "CampaignUnsubscribeTokenInvalid"
) {}
