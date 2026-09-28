import "server-only";

import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import { APIError, type BetterAuthOptions, betterAuth } from "better-auth";
import { createAuthMiddleware, isAPIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { magicLink } from "better-auth/plugins";
import { Effect, Option, Schema } from "effect";
import { after } from "next/server";
import { Resend } from "resend";
import { makeAuthDatabase } from "@/db/auth-database-client";
import { WorkspaceDatabase } from "@/db/database.service";
import { workspaceDatabasePool } from "@/db/database-provider.server";
import { drizzleAuthTables } from "@/db/schema/auth";
import { env } from "@/env";
import { CustomerAccountDeletionService } from "@/features/account/backend/customer-account-deletion";
import {
  type CustomerAccountId,
  customerAccountIdSchema,
} from "@/features/account/customer-account";
import {
  defaultLocale,
  getLocaleFromPathname,
  isLocale,
  type Locale,
} from "@/features/i18n";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";
import { workspaceSiteConstants } from "@/shared/utils";
import {
  type MagicLinkLocaleLookup,
  recoverMagicLinkDeliveryLocale,
} from "../customer-communication-preference.repository";
import { authOptions, betterAuthMagicLinkOptions } from "./auth-options";
import { renderMagicLinkEmail } from "./magic-link-email";
import {
  magicLinkCorrelationTags,
  makeMagicLinkEmailDelivery,
} from "./send-magic-link-email";

export type MagicLinkSendFunction = NonNullable<
  Parameters<typeof magicLink>[0]["sendMagicLink"]
>;

export type WorkspaceAuthConfig = {
  readonly database: NonNullable<BetterAuthOptions["database"]>;
  readonly secrets: NonNullable<BetterAuthOptions["secrets"]>;
  readonly allowedHosts: readonly string[];
  readonly httpsOnly: boolean;
  readonly areAccountsEnabled: () => Promise<boolean>;
  readonly sendMagicLink: MagicLinkSendFunction;
  readonly beforeDeleteUser: (accountId: CustomerAccountId) => Promise<void>;
  /**
   * Seeds the required preferred communication language at account creation
   * from the initiating site locale. The seed is retried with the same
   * initiating locale and a persistent failure rejects the hook so the
   * account activation request never reports success without the required
   * preference row.
   */
  readonly createAccountCommunicationPreference: (
    accountId: CustomerAccountId,
    locale: Locale
  ) => Promise<void>;
};

/**
 * Retries the preference seed with the same initiating locale so a transient
 * failure still produces the required row. A persistent failure is returned:
 * the hook only ever runs for a freshly created user row, so swallowing the
 * error here would leave an activated account permanently without its
 * required preference.
 */
const seedCommunicationPreferenceOrFail = async (
  config: WorkspaceAuthConfig,
  accountId: CustomerAccountId,
  locale: Locale
): Promise<{ readonly error: unknown } | undefined> => {
  let lastError: unknown = new Error(
    "The communication preference seed did not run."
  );
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await config.createAccountCommunicationPreference(accountId, locale);
      return undefined;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  await runWorkspaceEffect("account.magic-link.seed-locale", {
    boundary: "route",
  })(
    Effect.logWarning(
      "Customer communication preference seed failed; rejecting account activation.",
      { code: "account-communication-preference.seed-failed" }
    )
  ).catch(() => undefined);
  return { error: lastError };
};

const accountMagicLinkPaths = new Set([
  "/sign-in/magic-link",
  "/magic-link/verify",
]);
const accountsUnavailableErrors = new WeakSet<object>();

const makeAccountsUnavailableError = () => {
  const error = new APIError("SERVICE_UNAVAILABLE", {
    message: "Service Unavailable",
  });
  accountsUnavailableErrors.add(error);
  return error;
};

const isAccountsUnavailableError = (error: APIError) =>
  accountsUnavailableErrors.has(error);

const magicLinkMetadataSchema = Schema.Struct({
  locale: Schema.optional(Schema.String),
});

const decodeMagicLinkLocale = (
  data: Parameters<MagicLinkSendFunction>[0]
): Locale => {
  const decoded = Option.getOrUndefined(
    Schema.decodeOption(magicLinkMetadataSchema)(data.metadata ?? {})
  );
  const locale = decoded?.locale;
  return locale && isLocale(locale) ? locale : defaultLocale;
};

const authContextSchema = Schema.Struct({
  path: Schema.optional(Schema.String),
  query: Schema.optional(Schema.Record(Schema.String, Schema.String)),
});

type ParsedAuthContext = {
  readonly path?: string;
  readonly query?: Readonly<Record<string, string>>;
};

/**
 * Derives the initiating site language from the auth request that creates
 * the account: the magic-link verify request carries the localized callback
 * URL. Anything unparseable falls back to the site default locale.
 */
const siteLocaleFromAuthContext = (ctx: ParsedAuthContext): Locale => {
  const callbackURL = ctx.query?.callbackURL ?? ctx.path;
  if (!callbackURL) return defaultLocale;
  try {
    const fromCallback = getLocaleFromPathname(
      new URL(callbackURL, "https://auth.internal.invalid").pathname
    );
    return fromCallback ?? defaultLocale;
  } catch {
    return defaultLocale;
  }
};

/**
 * Picks the magic-link email language. A verified existing account always
 * uses its saved preference. For an existing account, an unreadable or
 * missing preference never falls back to a guessed site locale: delivery is
 * skipped so no wrong-language magic link reaches a customer. Only genuine
 * pre-account (first) delivery and a pending unverified signup keep the
 * initiating site locale.
 */
export type MagicLinkDeliveryDecision =
  | { readonly action: "deliver"; readonly locale: Locale }
  | {
      readonly action: "skip";
      readonly code:
        | "account.magic-link.locale.missing"
        | "account.magic-link.locale.read-failed";
    };

export const decideMagicLinkDelivery = (
  lookup: MagicLinkLocaleLookup,
  fallback: Locale
): MagicLinkDeliveryDecision => {
  if (lookup.kind === "account")
    return { action: "deliver", locale: lookup.locale };
  if (
    lookup.kind === "account-locale-missing" ||
    lookup.kind === "read-failed"
  ) {
    return {
      action: "skip",
      code:
        lookup.kind === "account-locale-missing"
          ? "account.magic-link.locale.missing"
          : "account.magic-link.locale.read-failed",
    };
  }
  return { action: "deliver", locale: fallback };
};

/**
 * Builds the Workspace Better Auth instance on top of the shared
 * connectionless options. The database adapter, secrets, dynamic host
 * allowlist, and lifecycle callbacks are the only runtime additions.
 */
export const makeWorkspaceAuth = (config: WorkspaceAuthConfig) => {
  const baseURL = { allowedHosts: [...config.allowedHosts] };
  if (config.httpsOnly) Object.assign(baseURL, { protocol: "https" as const });

  return betterAuth({
    ...authOptions,
    secrets: config.secrets,
    baseURL,
    database: config.database,
    logger: { disabled: true },
    onAPIError: {
      onError: (error) => {
        if (
          isAPIError(error) &&
          (error.statusCode < 500 || isAccountsUnavailableError(error))
        ) {
          return;
        }

        void runWorkspaceEffect("account.auth.handler", { boundary: "route" })(
          Effect.logError("Better Auth request failed.", {
            code: "account.auth.handler",
          })
        ).catch(() => undefined);

        // Keep better-call from falling through to its raw error logger.
        // biome-ignore lint: This synchronous third-party callback must return a fixed APIError.
        throw new APIError("INTERNAL_SERVER_ERROR", {
          message: "Internal Server Error",
        });
      },
    },
    disabledPaths: ["/update-user"],
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (accountMagicLinkPaths.has(ctx.path)) {
          let enabled = false;
          try {
            enabled = await config.areAccountsEnabled();
          } catch {
            enabled = false;
          }
          if (!enabled) return Promise.reject(makeAccountsUnavailableError());
        }

        const hasProfileFields =
          ctx.path === "/sign-in/magic-link" &&
          (Object.hasOwn(ctx.body, "name") || Object.hasOwn(ctx.body, "image"));

        if (ctx.path === "/update-user" || hasProfileFields) {
          return Promise.reject(
            new APIError("BAD_REQUEST", {
              message: "Profile fields are not accepted.",
            })
          );
        }
      }),
    },
    plugins: [
      magicLink({
        ...betterAuthMagicLinkOptions,
        sendMagicLink: config.sendMagicLink,
      }),
      // Better Auth requires `nextCookies` to be the last plugin: it forwards
      // Set-Cookie headers into the Next.js cookie store for Server Action
      // `auth.api` calls and defers RSC-only session refreshes.
      nextCookies(),
    ],
    databaseHooks: {
      session: {
        create: {
          before: async (session) => ({
            data: {
              ...session,
              ipAddress: null,
              userAgent: null,
            },
          }),
        },
      },
      user: {
        create: {
          after: async (user, ctx) => {
            const accountId = Option.getOrUndefined(
              Schema.decodeOption(customerAccountIdSchema)(user.id)
            );
            if (!accountId) return;
            // The auth request context is the I/O boundary: parse it here.
            const parsedCtx = Option.getOrUndefined(
              Schema.decodeUnknownOption(authContextSchema)(ctx)
            );
            const locale = siteLocaleFromAuthContext(parsedCtx ?? {});
            const seedFailure = await seedCommunicationPreferenceOrFail(
              config,
              accountId,
              locale
            );
            if (seedFailure) {
              // The user row is already committed when this hook runs, but
              // the required preference row is missing, so the activation
              // request must not report success; the initiating locale stays
              // attached to every retried seed attempt and the delivery-path
              // recovery reseeds from it idempotently.
              return Promise.reject(
                seedFailure.error instanceof Error
                  ? seedFailure.error
                  : new Error(
                      "The customer communication preference seed failed."
                    )
              );
            }
          },
        },
      },
    },
    user: {
      ...authOptions.user,
      deleteUser: {
        ...authOptions.user?.deleteUser,
        enabled: true,
        beforeDelete: (user) => {
          const accountId = Option.getOrUndefined(
            Schema.decodeOption(customerAccountIdSchema)(user.id)
          );
          if (!accountId) {
            return Promise.reject(
              new Error(
                "The deleting session carried an invalid account identifier."
              )
            );
          }
          return config.beforeDeleteUser(accountId);
        },
      },
    },
  });
};

const magicLinkSenderIdentity = `${workspaceSiteConstants.brand.name} <reservations@workspace.deskohub.cz>`;

export const makeResendMagicLinkSender = (apiKey: string | undefined) => {
  if (!apiKey) return null;
  const resend = new Resend(apiKey);
  return (message: {
    readonly to: string;
    readonly subject: string;
    readonly html: string;
    readonly text: string;
  }) =>
    resend.emails
      .send({
        from: magicLinkSenderIdentity,
        to: [message.to],
        subject: message.subject,
        html: message.html,
        text: message.text,
        tags: [...magicLinkCorrelationTags],
      })
      .then((result) => ({
        id: result.data?.id ?? null,
        error: result.error,
      }));
};

export const makeWorkspaceMagicLinkDelivery = (apiKey: string | undefined) =>
  makeMagicLinkEmailDelivery(
    apiKey ? makeResendMagicLinkSender(apiKey) : null,
    renderMagicLinkEmail
  );

export const makeWorkspaceAuthDatabase = () =>
  drizzleAdapter(makeAuthDatabase(workspaceDatabasePool), {
    provider: "pg",
    schema: drizzleAuthTables,
    schemaName: "auth",
  });

export const workspaceSendMagicLink: MagicLinkSendFunction = async (data) => {
  const fallbackLocale = decodeMagicLinkLocale(data);
  const lookup = await runWorkspaceEffect("account.magic-link.locale", {
    boundary: "route",
  })(
    recoverMagicLinkDeliveryLocale(data.email, fallbackLocale).pipe(
      Effect.provide(WorkspaceDatabase.Default)
    )
  ).catch(() => ({ kind: "read-failed" }) as const);
  const decision = decideMagicLinkDelivery(lookup, fallbackLocale);
  if (decision.action === "skip") {
    await runWorkspaceEffect("account.magic-link.locale", {
      boundary: "route",
    })(
      Effect.logWarning(
        "Magic-link delivery skipped for an existing account with an unreadable language preference.",
        { code: decision.code }
      )
    ).catch(() => undefined);
    return;
  }
  const locale = decision.locale;
  after(() =>
    runWorkspaceEffect("account.magic-link.deliver", { boundary: "task" })(
      makeWorkspaceMagicLinkDelivery(env.EMAIL_API_KEY).deliver({
        email: data.email,
        url: data.url,
        locale,
      })
    )
  );
};

export const workspaceBeforeDeleteUser = (accountId: CustomerAccountId) =>
  runWorkspaceEffect("account.deletion.provider-expiration", {
    boundary: "task",
  })(
    Effect.flatMap(CustomerAccountDeletionService, (service) =>
      service.requestDeletion(accountId)
    ).pipe(
      Effect.provide(CustomerAccountDeletionService.Live),
      Effect.tapError(() =>
        Effect.logWarning(
          "Customer account deletion: Dotypos expiration failed; deletion stays retryable.",
          { code: "account.deletion.retryable" }
        )
      )
    )
  );
