import type { DotyposCustomerId } from "@deskohub/dotypos";
import type { BrowserContext } from "@playwright/test";
import { makeSignature } from "better-auth/crypto";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { accountRoleGrants } from "@/db/schema/account-role-grants";
import { authSession } from "@/db/schema/auth";
import { parseBetterAuthSecrets } from "@/features/account/backend/auth/auth-secrets";
import type { CustomerAccountId } from "@/features/account/customer-account";
import type { AccountRole } from "@/features/administrators/account-role";
import { workspaceFixtures } from "@/shared/testing/workspace-fixtures.test-utils";
import type { E2EBrowserSession } from "../browser-session";
import type { WorkspaceE2EEnvironment } from "../e2e-env";
import { type WorkspaceE2EError, workspaceE2EError } from "../errors";
import { E2EDatabase } from "../integrations/database.service";
import { runDatabaseOperation } from "../integrations/database-operation";
import { addRedaction } from "../runtime";

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
    yield* runDatabaseOperation(
      "seed synthetic account",
      workspaceFixtures(db).account("e2e-synthetic-account", {
        id: account.accountId as CustomerAccountId,
        email: account.email,
        name: account.name,
        linkedCustomer: account.linkedCustomerId,
        roles: account.roles,
      })
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
        token,
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
 * Signs an E2E browser session in as one journaled synthetic account
 * without a magic link, setting the seeded session's HTTP-only, Secure, Lax
 * cookie for the preview's HTTPS origin.
 */
export const signInWorkspaceE2ESyntheticAccount = ({
  accountId,
  baseUrl,
  secret,
  session,
}: {
  readonly accountId: string;
  readonly baseUrl: string;
  readonly secret: WorkspaceE2ESessionSigningSecret;
  readonly session: E2EBrowserSession;
}): Effect.Effect<void, WorkspaceE2EError, E2EDatabase> =>
  Effect.gen(function* () {
    const value = yield* issueWorkspaceE2ESyntheticSession({
      accountId,
      secret,
    });
    yield* session.setSessionCookie({
      name: workspaceE2ESessionCookieName,
      url: baseUrl,
      value,
    });
  });

/**
 * Signs an E2E browser session in as one journaled synthetic account, with
 * the same cookie `signInWorkspaceE2ESyntheticBrowserContext` sets.
 */
export const signInWorkspaceE2ESyntheticBrowserSession = ({
  accountId,
  origin,
  secret,
  session,
}: {
  readonly accountId: string;
  readonly origin: string;
  readonly secret: WorkspaceE2ESessionSigningSecret;
  readonly session: E2EBrowserSession;
}): Effect.Effect<void, WorkspaceE2EError, E2EDatabase> =>
  Effect.gen(function* () {
    const cookie = workspaceE2ESessionCookieFor(origin);
    const value = yield* issueWorkspaceE2ESyntheticSession({
      accountId,
      secret,
    });
    yield* session
      .use(syntheticSessionCookieOperation, (page) =>
        page
          .context()
          .addCookies([toSyntheticSessionCookie(cookie, origin, value)])
      )
      .pipe(Effect.mapError(syntheticSessionCookieFailure));
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
      catch: syntheticSessionCookieFailure,
      try: () =>
        context.addCookies([toSyntheticSessionCookie(cookie, origin, value)]),
    });
  });

const syntheticSessionCookieOperation = "set synthetic account session cookie";

const syntheticSessionCookieFailure = () =>
  workspaceE2EError(`${syntheticSessionCookieOperation} failed`, {
    operation: syntheticSessionCookieOperation,
  });

/** The seeded session's HTTP-only, Lax cookie for one origin. */
const toSyntheticSessionCookie = (
  cookie: ReturnType<typeof workspaceE2ESessionCookieFor>,
  origin: string,
  value: string
): Parameters<BrowserContext["addCookies"]>[0][number] => ({
  httpOnly: true,
  name: cookie.name,
  sameSite: "Lax",
  secure: cookie.secure,
  url: origin,
  value,
});
