import { defineRelationsPart, sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { Locale } from "@/features/i18n";
import inlangSettings from "../../project.inlang/settings.json" with {
  type: "json",
};
import { sensitiveText } from "../sensitive-text";
import { customerAccounts } from "./customer-accounts";
import { quotedSqlList } from "./sql-list";

export const authSchema = pgSchema("auth");

export const authUser = authSchema.table(
  "user",
  {
    // Every login belongs to a durable customer account, created first; the
    // account outlives the login, so the reference never cascades.
    id: text("id")
      .primaryKey()
      .references(() => customerAccounts.id, { onDelete: "restrict" }),
    name: text("name").notNull(),
    email: sensitiveText("email").notNull(),
    emailVerified: boolean("email_verified").default(false).notNull(),
    image: text("image"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
    deletionRequestedAt: timestamp("deletion_requested_at", {
      withTimezone: true,
    }),
    locale: text("locale").$type<Locale>(),
  },
  (t) => [
    uniqueIndex("user_email_unique_idx").on(t.email),
    check(
      "user_locale_check",
      sql`${t.locale} in (${quotedSqlList(inlangSettings.locales)})`
    ),
  ]
);

export const authSession = authSchema.table(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: sensitiveText("token").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .$onUpdate(() => new Date()),
    ipAddress: sensitiveText("ip_address"),
    userAgent: sensitiveText("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
  },
  (t) => [
    uniqueIndex("session_token_unique_idx").on(t.token),
    index("session_user_id_idx").on(t.userId),
    index("session_expires_at_idx").on(t.expiresAt),
  ]
);

export const authAccount = authSchema.table(
  "account",
  {
    id: text("id").primaryKey(),
    issuer: text("issuer").notNull(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
    accessToken: sensitiveText("access_token"),
    refreshToken: sensitiveText("refresh_token"),
    idToken: sensitiveText("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", {
      withTimezone: true,
    }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", {
      withTimezone: true,
    }),
    scope: text("scope"),
    password: sensitiveText("password"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("account_issuer_account_unique_idx").on(t.issuer, t.accountId),
    index("account_user_id_idx").on(t.userId),
  ]
);

export const authVerification = authSchema.table(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: sensitiveText("identifier").notNull(),
    value: sensitiveText("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index("verification_identifier_idx").on(t.identifier),
    index("verification_expires_at_idx").on(t.expiresAt),
  ]
);

export const authRateLimit = authSchema.table(
  "rate_limit",
  {
    id: text("id").primaryKey(),
    key: sensitiveText("key").notNull(),
    count: integer("count").notNull(),
    lastRequest: bigint("last_request", { mode: "number" }).notNull(),
  },
  (t) => [
    uniqueIndex("rate_limit_key_unique_idx").on(t.key),
    index("rate_limit_last_request_idx").on(t.lastRequest),
  ]
);

/**
 * WebAuthn credentials of the `@better-auth/passkey` plugin. Each row belongs
 * to one customer and goes with the user by cascade, so account deletion
 * removes every passkey with the identity rows. `transports` holds the
 * comma-joined transport hints and `aaguid` the authenticator model.
 */
export const authPasskey = authSchema.table(
  "passkey",
  {
    id: text("id").primaryKey(),
    name: sensitiveText("name"),
    publicKey: text("public_key").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
    credentialID: text("credential_id").notNull(),
    // The WebAuthn signature counter is an unsigned 32-bit value.
    counter: bigint("counter", { mode: "number" }).notNull(),
    deviceType: text("device_type").notNull(),
    backedUp: boolean("backed_up").notNull(),
    transports: text("transports"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
    aaguid: text("aaguid"),
  },
  (t) => [
    index("passkey_user_id_idx").on(t.userId),
    uniqueIndex("passkey_credential_id_unique_idx").on(t.credentialID),
  ]
);

/** Registered OAuth clients that customers' agents use to access Workspace. */
export const authOauthClient = authSchema.table(
  "oauth_client",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id").notNull(),
    clientSecret: sensitiveText("client_secret"),
    clientDiscoveryId: text("client_discovery_id"),
    disabled: boolean("disabled").default(false),
    skipConsent: boolean("skip_consent"),
    enableEndSession: boolean("enable_end_session"),
    subjectType: text("subject_type"),
    scopes: text("scopes").array(),
    clientCredentialsScopes: text("client_credentials_scopes")
      .array()
      .default([]),
    userId: text("user_id").references(() => authUser.id, {
      onDelete: "cascade",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
    name: text("name"),
    uri: text("uri"),
    icon: text("icon"),
    contacts: text("contacts").array(),
    tos: text("tos"),
    policy: text("policy"),
    softwareId: text("software_id"),
    softwareVersion: text("software_version"),
    softwareStatement: text("software_statement"),
    redirectUris: text("redirect_uris").array().notNull(),
    postLogoutRedirectUris: text("post_logout_redirect_uris").array(),
    backchannelLogoutUri: text("backchannel_logout_uri"),
    backchannelLogoutSessionRequired: boolean(
      "backchannel_logout_session_required"
    ),
    tokenEndpointAuthMethod: text("token_endpoint_auth_method"),
    applicationType: text("application_type"),
    jwks: text("jwks"),
    jwksUri: text("jwks_uri"),
    grantTypes: text("grant_types").array(),
    responseTypes: text("response_types").array(),
    requirePKCE: boolean("require_pkce"),
    dpopBoundAccessTokens: boolean("dpop_bound_access_tokens").default(false),
    referenceId: text("reference_id"),
    metadata: jsonb("metadata"),
  },
  (t) => [
    uniqueIndex("oauth_client_client_id_unique_idx").on(t.clientId),
    index("oauth_client_user_id_idx").on(t.userId),
  ]
);

/** Protected resource metadata and token policy used by the OAuth provider. */
export const authOauthResource = authSchema.table(
  "oauth_resource",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    name: text("name").notNull(),
    accessTokenTtl: integer("access_token_ttl"),
    refreshTokenTtl: integer("refresh_token_ttl"),
    signingAlgorithm: text("signing_algorithm"),
    signingKeyId: text("signing_key_id"),
    allowedScopes: text("allowed_scopes").array(),
    customClaims: jsonb("custom_claims"),
    dpopBoundAccessTokensRequired: boolean(
      "dpop_bound_access_tokens_required"
    ).default(false),
    disabled: boolean("disabled").default(false),
    createdAt: timestamp("created_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
    policyVersion: integer("policy_version").default(1),
    metadata: jsonb("metadata"),
  },
  (t) => [uniqueIndex("oauth_resource_identifier_unique_idx").on(t.identifier)]
);

/** Links registered OAuth clients to the protected resources they can request. */
export const authOauthClientResource = authSchema.table(
  "oauth_client_resource",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id")
      .notNull()
      .references(() => authOauthClient.clientId, { onDelete: "cascade" }),
    resourceId: text("resource_id")
      .notNull()
      .references(() => authOauthResource.identifier, {
        onDelete: "cascade",
      }),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at", { withTimezone: true }),
  },
  (t) => [
    index("oauth_client_resource_client_id_idx").on(t.clientId),
    index("oauth_client_resource_resource_id_idx").on(t.resourceId),
    uniqueIndex("oauth_client_resource_pair_unique_idx").on(
      t.clientId,
      t.resourceId
    ),
  ]
);

/** Opaque OAuth refresh tokens; deleting a customer revokes their grants. */
export const authOauthRefreshToken = authSchema.table(
  "oauth_refresh_token",
  {
    id: text("id").primaryKey(),
    token: sensitiveText("token").notNull(),
    clientId: text("client_id")
      .notNull()
      .references(() => authOauthClient.clientId, { onDelete: "cascade" }),
    sessionId: text("session_id").references(() => authSession.id, {
      onDelete: "set null",
    }),
    userId: text("user_id")
      .notNull()
      .references(() => authUser.id, { onDelete: "cascade" }),
    referenceId: text("reference_id"),
    authorizationCodeId: text("authorization_code_id"),
    resources: text("resources").array(),
    requestedUserInfoClaims: text("requested_user_info_claims").array(),
    /** The consent that authorized the token; deleting it revokes the token. */
    consentId: text("consent_id").references(() => authOauthConsent.id, {
      onDelete: "cascade",
    }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }),
    revoked: timestamp("revoked", { withTimezone: true }),
    rotatedAt: timestamp("rotated_at", { withTimezone: true }),
    rotationReplayResponse: sensitiveText("rotation_replay_response"),
    rotationReplayExpiresAt: timestamp("rotation_replay_expires_at", {
      withTimezone: true,
    }),
    authTime: timestamp("auth_time", { withTimezone: true }),
    confirmation: jsonb("confirmation"),
    scopes: text("scopes").array().notNull(),
  },
  (t) => [
    uniqueIndex("oauth_refresh_token_token_unique_idx").on(t.token),
    index("oauth_refresh_token_client_id_idx").on(t.clientId),
    index("oauth_refresh_token_session_id_idx").on(t.sessionId),
    index("oauth_refresh_token_user_id_idx").on(t.userId),
    index("oauth_refresh_token_authorization_code_id_idx").on(
      t.authorizationCodeId
    ),
    index("oauth_refresh_token_consent_id_idx").on(t.consentId),
  ]
);

/** Opaque OAuth access tokens stored for revocation and introspection. */
export const authOauthAccessToken = authSchema.table(
  "oauth_access_token",
  {
    id: text("id").primaryKey(),
    token: sensitiveText("token"),
    clientId: text("client_id")
      .notNull()
      .references(() => authOauthClient.clientId, { onDelete: "cascade" }),
    sessionId: text("session_id").references(() => authSession.id, {
      onDelete: "set null",
    }),
    userId: text("user_id").references(() => authUser.id, {
      onDelete: "cascade",
    }),
    referenceId: text("reference_id"),
    authorizationCodeId: text("authorization_code_id"),
    resources: text("resources").array(),
    requestedUserInfoClaims: text("requested_user_info_claims").array(),
    /** The consent that authorized the token; deleting it revokes the token. */
    consentId: text("consent_id").references(() => authOauthConsent.id, {
      onDelete: "cascade",
    }),
    refreshId: text("refresh_id").references(() => authOauthRefreshToken.id, {
      onDelete: "cascade",
    }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }),
    revoked: timestamp("revoked", { withTimezone: true }),
    confirmation: jsonb("confirmation"),
    scopes: text("scopes").array().notNull(),
  },
  (t) => [
    uniqueIndex("oauth_access_token_token_unique_idx").on(t.token),
    index("oauth_access_token_client_id_idx").on(t.clientId),
    index("oauth_access_token_session_id_idx").on(t.sessionId),
    index("oauth_access_token_user_id_idx").on(t.userId),
    index("oauth_access_token_authorization_code_id_idx").on(
      t.authorizationCodeId
    ),
    index("oauth_access_token_refresh_id_idx").on(t.refreshId),
    index("oauth_access_token_consent_id_idx").on(t.consentId),
  ]
);

/** Customer approval records for OAuth client scopes and protected resources. */
export const authOauthConsent = authSchema.table(
  "oauth_consent",
  {
    id: text("id").primaryKey(),
    clientId: text("client_id")
      .notNull()
      .references(() => authOauthClient.clientId, { onDelete: "cascade" }),
    userId: text("user_id").references(() => authUser.id, {
      onDelete: "cascade",
    }),
    referenceId: text("reference_id"),
    resources: text("resources").array(),
    requestedUserInfoClaims: text("requested_user_info_claims").array(),
    scopes: text("scopes").array().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }),
  },
  (t) => [
    index("oauth_consent_client_id_idx").on(t.clientId),
    index("oauth_consent_user_id_idx").on(t.userId),
  ]
);

/** Single-use records preventing replay of OAuth client assertions. */
export const authOauthClientAssertion = authSchema.table(
  "oauth_client_assertion",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  }
);

/**
 * Auth-only Drizzle table map: the single source of truth for the tables the
 * Better Auth Drizzle adapter and the auth Drizzle facade operate on. Not
 * re-exported from db/schema/index.ts — auth tables never join the app graph.
 */
export const drizzleAuthTables = {
  user: authUser,
  session: authSession,
  account: authAccount,
  verification: authVerification,
  rateLimit: authRateLimit,
  passkey: authPasskey,
  oauthClient: authOauthClient,
  oauthResource: authOauthResource,
  oauthClientResource: authOauthClientResource,
  oauthRefreshToken: authOauthRefreshToken,
  oauthAccessToken: authOauthAccessToken,
  oauthConsent: authOauthConsent,
  oauthClientAssertion: authOauthClientAssertion,
};

export const authRelations = defineRelationsPart(
  {
    user: authUser,
    session: authSession,
    account: authAccount,
    passkey: authPasskey,
  },
  (r) => ({
    user: {
      sessions: r.many.session({
        from: r.user.id,
        to: r.session.userId,
      }),
      accounts: r.many.account({
        from: r.user.id,
        to: r.account.userId,
      }),
      passkeys: r.many.passkey({
        from: r.user.id,
        to: r.passkey.userId,
      }),
    },
    session: {
      user: r.one.user({
        from: r.session.userId,
        to: r.user.id,
      }),
    },
    account: {
      user: r.one.user({
        from: r.account.userId,
        to: r.user.id,
      }),
    },
    passkey: {
      user: r.one.user({
        from: r.passkey.userId,
        to: r.user.id,
      }),
    },
  })
);
