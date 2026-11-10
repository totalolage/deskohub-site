import { Effect, Schema } from "effect";
import { Multipart } from "effect/unstable/http";
import {
  HttpApiEndpoint,
  HttpApiError,
  HttpApiGroup,
  HttpApiSchema,
} from "effect/unstable/httpapi";
import { CustomerLocale } from "./customer-locale";
import {
  accountProfileSchemas,
  CustomerProfile,
  CustomerProfileCompletionInput,
  CustomerProfileInput,
  customerInputParseOptions,
  ProfileCompletionReferralOutcome,
} from "./customer-profile";
import {
  CurrentCustomerSession,
  CustomerAccountId,
  CustomerServiceUnavailable,
  customerReferralCodeHeader,
} from "./customer-session";
import { ReferralCode } from "./referral-code";

// Errors

/**
 * The signed-in account has no usable Dotypos customer profile for this
 * operation: it hasn't completed its profile, its profile needs support, or
 * its deletion is pending.
 */
export class CustomerAccountLinkRequired extends Schema.TaggedErrorClass<CustomerAccountLinkRequired>()(
  "CustomerAccountLinkRequired",
  {
    reason: Schema.Literals([
      "profile-missing",
      "support-required",
      "deletion-pending",
    ]),
  }
) {
  static schema = this.pipe(HttpApiSchema.status("Conflict"));
}

/** The account features a release can withhold. */
export const CustomerAccountFeature = Schema.Literals([
  "avatars",
  "passkeys",
  "referrals",
]).annotate({ identifier: "CustomerAccountFeature" });
export type CustomerAccountFeature = typeof CustomerAccountFeature.Type;

/** The feature isn't released, or its release couldn't be confirmed. */
export class CustomerFeatureUnavailable extends Schema.TaggedErrorClass<CustomerFeatureUnavailable>()(
  "CustomerFeatureUnavailable",
  { feature: CustomerAccountFeature }
) {
  static schema = this.pipe(HttpApiSchema.status("NotFound"));
}

export const CustomerAvatarRejectionReason = Schema.Literals([
  "file-missing",
  "file-too-large",
  "unsupported-format",
  "undecodable-image",
  "image-dimensions-too-large",
]).annotate({ identifier: "CustomerAvatarRejectionReason" });
export type CustomerAvatarRejectionReason =
  typeof CustomerAvatarRejectionReason.Type;

/** The uploaded file can't become an avatar; the reason names why. */
export class CustomerAvatarRejected extends Schema.TaggedErrorClass<CustomerAvatarRejected>()(
  "CustomerAvatarRejected",
  { reason: CustomerAvatarRejectionReason }
) {
  static schema = this.pipe(HttpApiSchema.status("UnprocessableEntity"));
}

/**
 * The marketing preference changed since the client read its `context`;
 * read it again before saving.
 */
export class CustomerMarketingPreferencesRejected extends Schema.TaggedErrorClass<CustomerMarketingPreferencesRejected>()(
  "CustomerMarketingPreferencesRejected",
  { reason: Schema.Literal("stale-context") }
) {
  static schema = this.pipe(HttpApiSchema.status("Conflict"));
}

// Account state

const isoInstant = Schema.String.annotate({
  description: "ISO 8601 instant.",
});

export const AccountPasskey = Schema.Struct({
  id: Schema.String,
  /**
   * The customer's name for it, or the provider name the server gave it.
   * Absent for an unknown authenticator.
   */
  name: Schema.optional(Schema.String),
  /** Provider resolved from the authenticator AAGUID. */
  provider: Schema.optional(Schema.String),
  createdAt: isoInstant,
}).annotate({ identifier: "AccountPasskey" });
export type AccountPasskey = typeof AccountPasskey.Type;

/** An AI assistant the customer let use their account. */
export const CustomerAgentConnection = Schema.Struct({
  /** The customer's consent; disconnecting removes it. */
  id: Schema.String,
  /** The name from the assistant's metadata; absent when it gives none. */
  name: Schema.optional(Schema.String),
  /** The host the assistant's metadata lives on. */
  host: Schema.optional(Schema.String),
  /** What the customer allowed, in the consent page's order. */
  scopes: Schema.Array(Schema.String),
  /** Whether the administrator also let it use the administration. */
  administration: Schema.Boolean,
  connectedAt: isoInstant,
}).annotate({ identifier: "CustomerAgentConnection" });
export type CustomerAgentConnection = typeof CustomerAgentConnection.Type;

export const CustomerAvatar = Schema.Struct({
  url: Schema.String,
  version: Schema.optional(Schema.Int),
}).annotate({ identifier: "CustomerAvatar" });
export type CustomerAvatar = typeof CustomerAvatar.Type;

/** `hidden` while avatars aren't released. */
export const CustomerAvatarPresentation = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("hidden") }),
  Schema.Struct({
    kind: Schema.Literal("available"),
    avatar: Schema.NullOr(CustomerAvatar),
  }),
]).annotate({ identifier: "CustomerAvatarPresentation" });
export type CustomerAvatarPresentation = typeof CustomerAvatarPresentation.Type;

export const Money = Schema.Struct({
  /** The amount in minor units of `exponent`. */
  value: Schema.Int,
  exponent: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  currency: Schema.String.check(Schema.isPattern(/^[A-Z]{3}$/)),
}).annotate({ identifier: "Money" });
export type Money = typeof Money.Type;

const count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0));

export const ReferralAccountSummary = Schema.Struct({
  code: ReferralCode,
  /** Every customer who joined with this customer's referral. */
  inviteeCount: count,
  /** Invited customers who currently count toward the referrer discount. */
  eligibleInviteeCount: count,
  /** Exact percentage as a canonical decimal, without a percent sign. */
  discount: Schema.String,
  /**
   * Referral discounts applied to the customer's own paid bookings, less
   * refunds, one positive total per currency, ordered by currency code.
   */
  savings: Schema.Array(Money),
}).annotate({ identifier: "ReferralAccountSummary" });
export type ReferralAccountSummary = typeof ReferralAccountSummary.Type;

/** The account referral summary with the customer's absolute share link. */
export const ReferralAccountOverview = Schema.Struct({
  summary: ReferralAccountSummary,
  shareUrl: Schema.String,
}).annotate({ identifier: "ReferralAccountOverview" });
export type ReferralAccountOverview = typeof ReferralAccountOverview.Type;

/**
 * Sign-in methods and connected assistants need only the session, so every
 * account state carries them, whether or not the Dotypos profile is
 * available.
 */
const sessionSettingsFields = {
  /**
   * Whether the account offers deletion: `pending` once it is requested and
   * retryable, `withheld` for a review account or while that can't be ruled
   * out.
   */
  deletion: Schema.Literals(["offered", "pending", "withheld"]),
  /** The account's passkeys; absent while passkeys aren't released. */
  passkeys: Schema.optional(
    Schema.Struct({
      accountId: CustomerAccountId,
      /** Null when the list couldn't be read. */
      passkeys: Schema.NullOr(Schema.Array(AccountPasskey)),
    })
  ),
  /**
   * The connected AI assistants, null when they couldn't be read. Absent
   * while deletion is pending.
   */
  assistants: Schema.optional(
    Schema.NullOr(Schema.Array(CustomerAgentConnection))
  ),
  /**
   * The account's saved language, null when it has none. It is any locale
   * tag, not only one this contract serves, so a locale added later never
   * fails an older client's decoding; a client ignores a tag it doesn't
   * support.
   */
  locale: Schema.NullOr(Schema.String).annotate({
    description:
      "The account's saved locale tag, or null when none is saved. Clients ignore tags they don't support.",
  }),
} as const;

const accountState = <
  const Kind extends string,
  Fields extends Schema.Struct.Fields,
>(
  kind: Kind,
  fields: Fields
) =>
  Schema.Struct({
    kind: Schema.Literal(kind),
    email: Schema.String,
    ...sessionSettingsFields,
    ...fields,
  });

/**
 * The signed-in customer's account, derived from the authoritative Better
 * Auth session and the Dotypos link. The reservation history is not part of
 * it.
 */
export const CustomerAccountState = Schema.Union([
  accountState("authenticated-unavailable", {}),
  accountState("completion-required", {
    /** Whether the referral program is released and offers a code field. */
    referralsEnabled: Schema.Boolean,
    /** Invitation code to prefill, present only when currently usable. */
    referralCode: Schema.optional(ReferralCode),
  }),
  accountState("linked", {
    profile: CustomerProfile,
    avatar: CustomerAvatarPresentation,
    /** Whether the referral program is released and has a section. */
    referralsEnabled: Schema.Boolean,
    referrals: Schema.optional(ReferralAccountOverview),
    /**
     * Outcome of retrying the code a profile completion could not record
     * yet, present only on the request that ran the retry.
     */
    signupReferral: Schema.optional(ProfileCompletionReferralOutcome),
    /**
     * Present when the remembered referral code the request carried is moot
     * because the customer's referral is settled; the client forgets it.
     */
    rememberedReferralCodeUsed: Schema.optional(Schema.Literal(true)),
  }),
  accountState("support-required", {}),
  /**
   * An app-directory review account: no profile, and a history of sample
   * reservations and simulated holds.
   */
  accountState("review-account", {}),
  accountState("deletion-pending", {}),
]).annotate({ identifier: "CustomerAccountState" });
export type CustomerAccountState = typeof CustomerAccountState.Type;

// Mutations

/** The profile payloads, decoded as the account actions decode them. */
const ProfileUpdatePayload = CustomerProfileInput.annotate({
  identifier: "CustomerProfileInput",
  parseOptions: customerInputParseOptions,
});

const ProfileCompletionPayload = CustomerProfileCompletionInput.annotate({
  identifier: "CustomerProfileCompletionInput",
  parseOptions: customerInputParseOptions,
});

type AccountProfileSchemas = ReturnType<typeof accountProfileSchemas>;

/**
 * The save a profile payload asks for, as a handler reads it: its entered
 * phone read in the phone region of the session's saved language and decoded
 * to the phone number it holds. The payload carries the phone only as entered
 * text, because the API reads it before it knows the account; a phone with no
 * phone number in that region answers as the payload check does, with an
 * empty 400.
 */
const profileSaveReader =
  <S extends Schema.Top>(schemaOf: (schemas: AccountProfileSchemas) => S) =>
  (payload: S["Encoded"]) =>
    Effect.flatMap(CurrentCustomerSession, ({ locale }) =>
      HttpApiError.HttpApiSchemaError.wrap(
        "Payload",
        Schema.decodeEffect(schemaOf(accountProfileSchemas(locale)))(payload)
      )
    ).pipe(Effect.orDie);

/** The profile save an update's payload asks for (`profileSaveReader`). */
export const profileUpdateSaveOf = profileSaveReader(({ save }) => save);

/** The first-time completion a payload asks for (`profileSaveReader`). */
export const profileCompletionSaveOf = profileSaveReader(
  ({ completionSave }) => completionSave
);

/** The language to save on the account, as the web language switcher does. */
const LocaleUpdatePayload = Schema.Struct({ locale: CustomerLocale }).annotate({
  identifier: "CustomerLocaleUpdate",
  parseOptions: customerInputParseOptions,
});

/** The saved language. */
export const CustomerLocaleUpdated = Schema.Struct({
  locale: CustomerLocale,
}).annotate({ identifier: "CustomerLocaleUpdated" });
export type CustomerLocaleUpdated = typeof CustomerLocaleUpdated.Type;

const RememberedReferralHeaders = Schema.Struct({
  [customerReferralCodeHeader]: Schema.optionalKey(
    Schema.String.check(Schema.isMaxLength(64))
  ),
});

export const CustomerProfileUpdated = Schema.Struct({
  status: Schema.Literal("updated"),
}).annotate({ identifier: "CustomerProfileUpdated" });
export type CustomerProfileUpdated = typeof CustomerProfileUpdated.Type;

export const CustomerProfileCompletion = Schema.Union([
  Schema.Struct({
    status: Schema.Literal("completed"),
    referral: Schema.optional(ProfileCompletionReferralOutcome),
  }),
  /** The entered referral code can't be used; nothing was saved. */
  Schema.Struct({ status: Schema.Literal("referral-code-unavailable") }),
]).annotate({ identifier: "CustomerProfileCompletion" });
export type CustomerProfileCompletion = typeof CustomerProfileCompletion.Type;

/** The largest avatar file the API accepts, before normalization. */
export const customerAvatarMaxUploadBytes = 2 * 1024 * 1024;

export const customerAvatarMediaTypes = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

/** The multipart form field that carries the avatar file. */
export const customerAvatarFileField = "file";

/**
 * The largest avatar upload body: the file plus room for its part headers and
 * the body's delimiters.
 */
export const customerAvatarMaxBodyBytes =
  customerAvatarMaxUploadBytes + 64 * 1024;

/**
 * The avatar upload, one file part of at most `customerAvatarMaxUploadBytes`
 * in a body of at most `customerAvatarMaxBodyBytes`. The Workspace parses the
 * body itself and enforces both limits.
 */
export const CustomerAvatarUpload = Schema.Struct({
  [customerAvatarFileField]: Multipart.SingleFileSchema,
}).pipe(
  HttpApiSchema.asMultipartStream({
    maxParts: 1,
    maxFileSize: customerAvatarMaxUploadBytes,
    maxFieldSize: 1024,
    maxTotalSize: customerAvatarMaxBodyBytes,
  })
);

export const CustomerMarketingConsentStatus = Schema.Literals([
  "absent",
  "active",
  "withdrawn",
]).annotate({ identifier: "CustomerMarketingConsentStatus" });

/**
 * The signed-in account's marketing consent. `context` identifies the state
 * read; a save must echo it.
 */
export const CustomerMarketingPreferences = Schema.Struct({
  status: CustomerMarketingConsentStatus,
  context: Schema.NonEmptyString,
}).annotate({ identifier: "CustomerMarketingPreferences" });
export type CustomerMarketingPreferences =
  typeof CustomerMarketingPreferences.Type;

export const SaveCustomerMarketingPreferences = Schema.Struct({
  context: Schema.NonEmptyString,
  granted: Schema.Boolean,
  /** The customer confirmed the change in the client. */
  confirmed: Schema.Literal(true),
  /** The language the client showed the consent wording in. */
  locale: CustomerLocale,
}).annotate({
  identifier: "SaveCustomerMarketingPreferences",
  parseOptions: customerInputParseOptions,
});
export type SaveCustomerMarketingPreferences =
  typeof SaveCustomerMarketingPreferences.Type;

/**
 * An instant the client sends: an ISO 8601 date and time with seconds, an
 * optional fraction, and `Z` or a `±hh:mm` offset.
 */
const isoInstantInput = Schema.String.check(
  Schema.isPattern(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/
  )
).annotate({ description: "ISO 8601 instant with an offset." });

/**
 * The app's own analytics choice on this device: whether it accepts
 * analytics, and when the customer made it.
 */
export const CustomerAnalyticsChoice = Schema.Struct({
  analytics: Schema.Boolean,
  decidedAt: isoInstantInput,
}).annotate({ identifier: "CustomerAnalyticsChoice" });
export type CustomerAnalyticsChoice = typeof CustomerAnalyticsChoice.Type;

export const SyncCustomerAnalyticsConsent = Schema.Struct({
  /** The app's own choice; null while the customer hasn't made one on it. */
  choice: Schema.NullOr(CustomerAnalyticsChoice),
  /** The language the app shows its privacy notice in. */
  locale: CustomerLocale,
}).annotate({
  identifier: "SyncCustomerAnalyticsConsent",
  parseOptions: customerInputParseOptions,
});
export type SyncCustomerAnalyticsConsent =
  typeof SyncCustomerAnalyticsConsent.Type;

/**
 * The account's analytics decision the app takes over its own choice, which
 * it stores as its choice dated `decidedAt`. `withdraw`: the account withdrew
 * analytics after the app's accepting choice. `grant`: the app holds no
 * choice and the account granted analytics under the current privacy
 * notice; the app accepts analytics without asking. `unchanged`: the app
 * keeps its own choice, or keeps asking.
 */
export const CustomerAnalyticsConsentSync = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("unchanged") }),
  Schema.Struct({ kind: Schema.Literal("withdraw"), decidedAt: isoInstant }),
  Schema.Struct({ kind: Schema.Literal("grant"), decidedAt: isoInstant }),
]).annotate({ identifier: "CustomerAnalyticsConsentSync" });
export type CustomerAnalyticsConsentSync =
  typeof CustomerAnalyticsConsentSync.Type;

/**
 * The signed-in account's analytics preference: granted when its current
 * decision is a grant, under any privacy notice.
 */
export const CustomerAnalyticsPreference = Schema.Struct({
  granted: Schema.Boolean,
}).annotate({ identifier: "CustomerAnalyticsPreference" });
export type CustomerAnalyticsPreference =
  typeof CustomerAnalyticsPreference.Type;

export const SaveCustomerAnalyticsPreference = Schema.Struct({
  granted: Schema.Boolean,
  /** The language the client showed the privacy notice in. */
  locale: CustomerLocale,
}).annotate({
  identifier: "SaveCustomerAnalyticsPreference",
  parseOptions: customerInputParseOptions,
});
export type SaveCustomerAnalyticsPreference =
  typeof SaveCustomerAnalyticsPreference.Type;

/**
 * The analytics decision the account just made, which the app stores as its
 * own choice dated `decidedAt`.
 */
export const CustomerAnalyticsPreferenceSaved = Schema.Struct({
  granted: Schema.Boolean,
  decidedAt: isoInstant,
}).annotate({ identifier: "CustomerAnalyticsPreferenceSaved" });
export type CustomerAnalyticsPreferenceSaved =
  typeof CustomerAnalyticsPreferenceSaved.Type;

export const RequestCustomerAccountDeletion = Schema.Struct({
  confirmed: Schema.Literal(true),
}).annotate({
  identifier: "RequestCustomerAccountDeletion",
  parseOptions: customerInputParseOptions,
});

/**
 * How a deletion request ended. `reauthentication-required` asks the
 * customer to sign in again first; `refused` is a review account.
 */
export const CustomerAccountDeletionResult = Schema.Struct({
  status: Schema.Literals([
    "deleted",
    "reauthentication-required",
    "refused",
    "failed",
  ]),
}).annotate({ identifier: "CustomerAccountDeletionResult" });
export type CustomerAccountDeletionResult =
  typeof CustomerAccountDeletionResult.Type;

// Endpoints

/**
 * The signed-in customer's own account. Sign-out, passkey rename and delete,
 * and assistant disconnect are Better Auth's (`CustomerAuthApi`).
 */
export const CustomerAccountApi = HttpApiGroup.make("account")
  .add(
    HttpApiEndpoint.get("getAccount", "/", {
      headers: RememberedReferralHeaders,
      success: CustomerAccountState,
      error: CustomerServiceUnavailable.schema,
    })
  )
  .add(
    HttpApiEndpoint.put("updateProfile", "/profile", {
      payload: ProfileUpdatePayload,
      success: CustomerProfileUpdated,
      error: [
        CustomerAccountLinkRequired.schema,
        CustomerServiceUnavailable.schema,
      ],
    })
  )
  .add(
    /**
     * Saves the account's language, which the account's emails and signed-in
     * site use. It is the account's own setting, not Dotypos data, so an
     * account without a Dotypos profile saves it too.
     */
    HttpApiEndpoint.put("updateLocale", "/locale", {
      payload: LocaleUpdatePayload,
      success: CustomerLocaleUpdated,
      error: [
        CustomerAccountLinkRequired.schema,
        CustomerServiceUnavailable.schema,
      ],
    })
  )
  .add(
    HttpApiEndpoint.post("completeProfile", "/profile", {
      headers: RememberedReferralHeaders,
      payload: ProfileCompletionPayload,
      success: CustomerProfileCompletion,
      error: [
        CustomerAccountLinkRequired.schema,
        CustomerServiceUnavailable.schema,
      ],
    })
  )
  .add(
    HttpApiEndpoint.put("uploadAvatar", "/avatar", {
      payload: CustomerAvatarUpload,
      success: CustomerAvatar,
      error: [
        CustomerAvatarRejected.schema,
        CustomerFeatureUnavailable.schema,
        CustomerAccountLinkRequired.schema,
        CustomerServiceUnavailable.schema,
      ],
    })
  )
  .add(
    HttpApiEndpoint.delete("removeAvatar", "/avatar", {
      success: HttpApiSchema.NoContent,
      error: [
        CustomerFeatureUnavailable.schema,
        CustomerAccountLinkRequired.schema,
        CustomerServiceUnavailable.schema,
      ],
    })
  )
  .add(
    HttpApiEndpoint.get("listPasskeys", "/passkeys", {
      success: Schema.Array(AccountPasskey),
      error: [
        CustomerFeatureUnavailable.schema,
        CustomerServiceUnavailable.schema,
      ],
    })
  )
  .add(
    HttpApiEndpoint.get("listAssistantConnections", "/assistant-connections", {
      success: Schema.Array(CustomerAgentConnection),
      error: CustomerServiceUnavailable.schema,
    })
  )
  .add(
    HttpApiEndpoint.get("getMarketingPreferences", "/marketing-preferences", {
      success: CustomerMarketingPreferences,
      error: [
        CustomerAccountLinkRequired.schema,
        CustomerServiceUnavailable.schema,
      ],
    })
  )
  .add(
    HttpApiEndpoint.put("saveMarketingPreferences", "/marketing-preferences", {
      payload: SaveCustomerMarketingPreferences,
      success: HttpApiSchema.NoContent,
      error: [
        CustomerMarketingPreferencesRejected.schema,
        CustomerAccountLinkRequired.schema,
        CustomerServiceUnavailable.schema,
      ],
    })
  )
  .add(
    HttpApiEndpoint.post("syncAnalyticsConsent", "/analytics-consent", {
      payload: SyncCustomerAnalyticsConsent,
      success: CustomerAnalyticsConsentSync,
      error: [
        CustomerAccountLinkRequired.schema,
        CustomerServiceUnavailable.schema,
      ],
    })
  )
  .add(
    HttpApiEndpoint.get("getAnalyticsPreference", "/analytics-preference", {
      success: CustomerAnalyticsPreference,
      error: [
        CustomerAccountLinkRequired.schema,
        CustomerServiceUnavailable.schema,
      ],
    })
  )
  .add(
    HttpApiEndpoint.put("saveAnalyticsPreference", "/analytics-preference", {
      payload: SaveCustomerAnalyticsPreference,
      success: CustomerAnalyticsPreferenceSaved,
      error: [
        CustomerAccountLinkRequired.schema,
        CustomerServiceUnavailable.schema,
      ],
    })
  )
  .add(
    HttpApiEndpoint.get("getReferrals", "/referrals", {
      success: ReferralAccountOverview,
      error: [
        CustomerFeatureUnavailable.schema,
        CustomerAccountLinkRequired.schema,
        CustomerServiceUnavailable.schema,
      ],
    })
  )
  .add(
    HttpApiEndpoint.post(
      "acknowledgeSignupReferral",
      "/referrals/signup-acknowledgement",
      {
        success: HttpApiSchema.NoContent,
        error: [
          CustomerFeatureUnavailable.schema,
          CustomerAccountLinkRequired.schema,
          CustomerServiceUnavailable.schema,
        ],
      }
    )
  )
  .add(
    HttpApiEndpoint.post("requestDeletion", "/deletion", {
      payload: RequestCustomerAccountDeletion,
      success: CustomerAccountDeletionResult,
    })
  )
  .prefix("/account");
