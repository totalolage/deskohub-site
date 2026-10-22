import type { DotyposCustomerId } from "@deskohub/dotypos";
import type { BrowserContext } from "@playwright/test";
import { makeSignature } from "better-auth/crypto";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { accountRoleGrants } from "@/db/schema/account-role-grants";
import { authSession, authUser } from "@/db/schema/auth";
import { customerAccounts } from "@/db/schema/customer-accounts";
import { parseBetterAuthSecrets } from "@/features/account/backend/auth/auth-secrets";
import type { CustomerAccountId } from "@/features/account/customer-account";
import type { AccountRole } from "@/features/administrators/account-role";
import { sensitiveDatabaseParameter } from "@/shared/backend/logging/database-query-parameter-classifier";
import { setBrowserCookie } from "../browser";
import type { WorkspaceE2EEnvironment } from "../e2e-env";
import { type WorkspaceE2EError, workspaceE2EError } from "../errors";
import { E2EDatabase } from "../integrations/database.service";
import { runDatabaseOperation } from "../integrations/database-operation";
import { addRedaction, type Runner } from "../runtime";

/**
 * Better Auth's session cookie on an HTTPS deployment. Workspace keeps the
 * library's default prefix and enables HTTPS-only cookies outside local
 * development, so every protected preview uses the `__Secure-` name.
 */
export const workspaceE2ESessionCookieName =
  "__Secure-better-auth.session_token";

/**
 * Local `next dev` serves plain HTTP with HTTPS-only cookies off, so Better
 * Auth names its session cookie without the `__Secure-` prefix there.
 */
const developmentSessionCookieName = "better-auth.session_token";
const developmentHosts = new Set(["127.0.0.1", "localhost"]);

/**
 * The session cookie the deployment at `origin` reads: the `__Secure-`
 * cookie on HTTPS, the unprefixed one on a local development server. Any
 * other plain-HTTP origin is refused.
 */
export const workspaceE2ESessionCookieFor = (origin: string) => {
  const url = new URL(origin);
  if (url.protocol === "https:") {
    return { name: workspaceE2ESessionCookieName, secure: true } as const;
  }
  if (url.protocol === "http:" && developmentHosts.has(url.hostname)) {
    return { name: developmentSessionCookieName, secure: false } as const;
  }
  throw workspaceE2EError(
    "Seeded sessions need an HTTPS deployment or a local development server",
    { operation: "resolve synthetic account session cookie" }
  );
};

/**
 * Seeded sessions only need to outlive one case; a short expiry bounds the
 * value of a leaked preview cookie even before cleanup deletes the user.
 */
const seededSessionLifetimeMs = 60 * 60_000;

/** The preview's current Better Auth signing secret: the first configured entry. */
export type WorkspaceE2ESessionSigningSecret = {
  readonly value: string;
};

/**
 * Decodes the runner-only copy of the protected preview's versioned
 * `BETTER_AUTH_SECRETS`. Only the first entry signs, as in Better Auth. Every
 * entry is registered with the redactor before it can reach a log, and an
 * absent or malformed value fails closed without echoing it.
 */
export const resolveWorkspaceE2ESessionSigningSecret = (
  environment: Pick<
    WorkspaceE2EEnvironment,
    "WORKSPACE_E2E_BETTER_AUTH_SECRETS"
  >
): WorkspaceE2ESessionSigningSecret => {
  const raw = environment.WORKSPACE_E2E_BETTER_AUTH_SECRETS;
  addRedaction(raw, true);
  const parsed = parseBetterAuthSecrets(raw);
  if (parsed.kind === "invalid") {
    throw workspaceE2EError(
      "WORKSPACE_E2E_BETTER_AUTH_SECRETS must hold the Preview deployment's versioned BETTER_AUTH_SECRETS value. Provision it as a secret of the protected workspace-checkout-e2e GitHub Actions environment, copied from the deskohub-workspace Vercel project's Preview-only BETTER_AUTH_SECRETS (never the Production value), before running seeded-session cases (checkout, referral, and administrator coverage). They fail closed instead of skipping",
      { operation: "configure workspace e2e session seeding" }
    );
  }
  for (const secret of parsed.secrets) addRedaction(secret.value, true);
  return { value: parsed.secrets[0].value };
};

/**
 * Signs a session token as Better Auth's signed cookie does: the token, a dot,
 * and Better Auth's own HMAC signature of the token, URI-encoded.
 */
export const signWorkspaceE2ESessionToken = async (
  token: string,
  secret: WorkspaceE2ESessionSigningSecret
) => encodeURIComponent(`${token}.${await makeSignature(token, secret.value)}`);

/** A 32-character alphanumeric token, the shape Better Auth generates. */
const generateSessionToken = () =>
  Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString("hex");

export type WorkspaceE2ESyntheticAccount = {
  readonly accountId: string;
  readonly email: string;
  /** The completed profile's customer; absent while profile completion is still required. */
  readonly linkedCustomerId?: DotyposCustomerId;
  readonly name: string;
  /**
   * Account roles granted with the user, such as `administrator`. Deleting
   * the journaled user cascades the grants away.
   */
  readonly roles?: readonly AccountRole[];
};

/**
 * Inserts one verified synthetic customer account, linked to its customer when
 * the profile counts as completed, its Better Auth user, and its role grants. The caller journals the
 * account id first.
 */
export const seedWorkspaceE2ESyntheticAccount = (
  account: WorkspaceE2ESyntheticAccount
): Effect.Effect<void, WorkspaceE2EError, E2EDatabase> =>
  Effect.gen(function* () {
    const { db } = yield* E2EDatabase;
    const accountId = account.accountId as CustomerAccountId;
    yield* runDatabaseOperation(
      "seed synthetic account",
      db.transaction(
        Effect.fn(function* (tx) {
          yield* tx.insert(customerAccounts).values({
            id: accountId,
            dotyposCustomerId: account.linkedCustomerId ?? null,
          });
          yield* tx.insert(authUser).values({
            deletionRequestedAt: null,
            email: sensitiveDatabaseParameter(account.email),
            emailVerified: true,
            id: accountId,
            name: account.name,
          });
          if (account.roles && account.roles.length > 0) {
            yield* tx
              .insert(accountRoleGrants)
              .values(account.roles.map((role) => ({ accountId, role })));
          }
        })
      )
    );
  });

/**
 * Removes every role grant of one seeded synthetic account, as an
 * administrator's revocation does; its sessions and agent tokens stay.
 */
export const revokeWorkspaceE2ESyntheticAccountRoles = (
  accountId: string
): Effect.Effect<void, WorkspaceE2EError, E2EDatabase> =>
  Effect.gen(function* () {
    const { db } = yield* E2EDatabase;
    yield* runDatabaseOperation(
      "revoke synthetic account roles",
      db
        .delete(accountRoleGrants)
        .where(eq(accountRoleGrants.accountId, accountId as CustomerAccountId))
    );
  });

/**
 * Inserts a short-lived Better Auth session row for one journaled synthetic
 * account into the exact preview database and returns the matching signed
 * session cookie value. Nothing changes in the deployment; the app
 * authenticates the cookie through its normal session lookup.
 */
const issueWorkspaceE2ESyntheticSession = ({
  accountId,
  secret,
}: {
  readonly accountId: string;
  readonly secret: WorkspaceE2ESessionSigningSecret;
}): Effect.Effect<string, WorkspaceE2EError, E2EDatabase> =>
  Effect.gen(function* () {
    const token = generateSessionToken();
    addRedaction(token, true);
    const { db } = yield* E2EDatabase;
    const now = new Date();
    yield* runDatabaseOperation(
      "seed synthetic account session",
      db.insert(authSession).values({
        createdAt: now,
        expiresAt: new Date(now.getTime() + seededSessionLifetimeMs),
        id: crypto.randomUUID(),
        ipAddress: "",
        // The database query logger keeps its own censor, so the bearer
        // token must be marked sensitive rather than only redacted here.
        token: sensitiveDatabaseParameter(token),
        updatedAt: now,
        userAgent: "",
        userId: accountId,
      })
    );
    const value = yield* Effect.tryPromise({
      catch: (cause) =>
        workspaceE2EError("sign synthetic account session", {
          cause,
          operation: "sign synthetic account session",
        }),
      try: () => signWorkspaceE2ESessionToken(token, secret),
    });
    addRedaction(value, true);
    return value;
  });

/**
 * Signs a runner browser session in as one journaled synthetic account
 * without a magic link, setting the seeded session's cookie for the preview
 * origin in that session's own browser context.
 */
export const signInWorkspaceE2ESyntheticAccount = ({
  accountId,
  baseUrl,
  run,
  secret,
  session,
}: {
  readonly accountId: string;
  readonly baseUrl: string;
  readonly run: Runner;
  readonly secret: WorkspaceE2ESessionSigningSecret;
  readonly session: string;
}): Effect.Effect<void, WorkspaceE2EError, E2EDatabase> =>
  Effect.gen(function* () {
    const value = yield* issueWorkspaceE2ESyntheticSession({
      accountId,
      secret,
    });
    yield* setBrowserCookie(run, session, {
      name: workspaceE2ESessionCookieName,
      url: baseUrl,
      value,
    });
  });

/**
 * Signs a Playwright browser context in as one journaled synthetic account:
 * the seeded session's HTTP-only, Lax cookie is added for the target origin
 * only, Secure on a preview.
 */
export const signInWorkspaceE2ESyntheticBrowserContext = ({
  accountId,
  context,
  origin,
  secret,
}: {
  readonly accountId: string;
  readonly context: Pick<BrowserContext, "addCookies">;
  readonly origin: string;
  readonly secret: WorkspaceE2ESessionSigningSecret;
}): Effect.Effect<void, WorkspaceE2EError, E2EDatabase> =>
  Effect.gen(function* () {
    const cookie = workspaceE2ESessionCookieFor(origin);
    const value = yield* issueWorkspaceE2ESyntheticSession({
      accountId,
      secret,
    });
    yield* Effect.tryPromise({
      // Playwright causes can echo the cookie, so the cause is discarded.
      catch: () =>
        workspaceE2EError("set synthetic account session cookie failed", {
          operation: "set synthetic account session cookie",
        }),
      try: () =>
        context.addCookies([
          {
            httpOnly: true,
            name: cookie.name,
            sameSite: "Lax",
            secure: cookie.secure,
            url: origin,
            value,
          },
        ]),
    });
  });
