import "server-only";

import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import { type BetterAuthOptions, betterAuth } from "better-auth";
import { magicLink } from "better-auth/plugins";
import { Effect, Option, Schema } from "effect";
import { after } from "next/server";
import { Resend } from "resend";
import { makeNodePostgresDatabase } from "@/db/database-client";
import { workspaceDatabasePool } from "@/db/database-provider.server";
import {
  authAccount,
  authRateLimit,
  authSession,
  authUser,
  authVerification,
} from "@/db/schema/auth";
import { env } from "@/env";
import { CustomerAccountDeletionService } from "@/features/account/backend/customer-account-deletion";
import {
  type CustomerAccountId,
  customerAccountIdSchema,
} from "@/features/account/customer-account";
import { defaultLocale, isLocale, type Locale } from "@/features/i18n";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";
import { workspaceSiteConstants } from "@/shared/utils";
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
  readonly sendMagicLink: MagicLinkSendFunction;
  readonly beforeDeleteUser: (accountId: CustomerAccountId) => Promise<void>;
};

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
    plugins: [
      magicLink({
        ...betterAuthMagicLinkOptions,
        sendMagicLink: config.sendMagicLink,
      }),
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
  drizzleAdapter(makeNodePostgresDatabase(workspaceDatabasePool), {
    provider: "pg",
    schema: {
      user: authUser,
      session: authSession,
      account: authAccount,
      verification: authVerification,
      rateLimit: authRateLimit,
    },
    schemaName: "auth",
  });

export const workspaceSendMagicLink: MagicLinkSendFunction = (data) => {
  const locale = decodeMagicLinkLocale(data);
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
