import { testEmailAddress } from "@deskohub/test-email";
import "@/shared/testing/workspace-test-env";

import { mock } from "bun:test";
import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import type { Passkey } from "@better-auth/passkey";
import type {
  Account,
  RateLimit,
  Session,
  User,
  Verification,
} from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Cause, Effect, Layer } from "effect";
import * as SqlError from "effect/unstable/sql/SqlError";
import { makeAuthDatabase } from "@/db/auth-database-client";
import { WorkspaceDatabase } from "@/db/database.service";
import { WorkspaceDatabaseAdvisoryLock } from "@/db/postgres-advisory-lock";
import { drizzleAuthTables } from "@/db/schema/auth";
import { AccountRoleGrants } from "@/features/administrators/backend/account-role-grants.service";
import { ReviewAccounts } from "@/features/review-accounts";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { ensureCustomerAccount } from "../customer-account.repository";
import { captureAccountLocalePreference } from "../customer-locale-preference";
import { revokeUnconsentedAdministrationTokens } from "./administration-agent-access";
import type {
  MagicLinkSendFunction,
  SignInEmail,
  WorkspaceAuthConfig,
} from "./auth-server";

/**
 * The Workspace Better Auth instance under test, against the migrated
 * disposable Postgres when one is configured or an in-memory store, with the
 * HTTP helpers its handler tests share.
 */

export const emitWorkspaceLog = mock(() => undefined);

mock.module("@/instrumentation", () => ({
  postHogLoggerProvider: {
    forceFlush: () => Promise.resolve(),
    getLogger: () => ({ emit: emitWorkspaceLog }),
  },
}));

const { makeWorkspaceAuth } = await import("./auth-server");

export const testDatabase = await connectWorkspacePostgresTestDatabase();

export const SECRET_V1 = Buffer.alloc(48, 21).toString("base64url");
export const SECRET_V2 = Buffer.alloc(48, 22).toString("base64url");
export const HOST = "workspace.test";

export interface CapturedMagicLink {
  readonly email: string;
  readonly url: string;
  readonly token: string;
  readonly code?: string;
  readonly metadata?: SignInEmail["metadata"];
}

export type TestAuth = ReturnType<typeof makeTestAuth>;

/** The Postgres adapter, on the migrated disposable database by default. */
export const buildDatabaseAdapter = (pool = testDatabase!.pool) =>
  drizzleAdapter(makeAuthDatabase(pool), {
    provider: "pg",
    schema: drizzleAuthTables,
    schemaName: "auth",
  });

export type TestAuthOptions = {
  readonly database?: WorkspaceAuthConfig["database"];
  readonly secrets?: { readonly version: number; readonly value: string }[];
  readonly sentLinks?: CapturedMagicLink[];
  readonly isSignInCodeEnabled?: WorkspaceAuthConfig["isSignInCodeEnabled"];
  readonly arePasskeysEnabled?: WorkspaceAuthConfig["arePasskeysEnabled"];
  readonly verifyHuman?: WorkspaceAuthConfig["verifyHuman"];
  readonly beforeDeleteUser?: WorkspaceAuthConfig["beforeDeleteUser"];
  readonly captureAccountLocalePreference?: WorkspaceAuthConfig["captureAccountLocalePreference"];
  readonly clientMetadataTransport?: WorkspaceAuthConfig["clientMetadataTransport"];
  readonly createCustomerAccount?: WorkspaceAuthConfig["createCustomerAccount"];
  readonly hasAdministratorGrant?: WorkspaceAuthConfig["hasAdministratorGrant"];
  readonly reviewAccountCredentials?: WorkspaceAuthConfig["reviewAccountCredentials"];
  readonly isReviewAccount?: WorkspaceAuthConfig["isReviewAccount"];
  readonly registerReviewAccount?: WorkspaceAuthConfig["registerReviewAccount"];
};

/** The migrated disposable database as the Workspace database service. */
const testDatabaseLayer = () =>
  Layer.succeed(
    WorkspaceDatabase,
    WorkspaceDatabase.of({ db: testDatabase!.db })
  );

/** The real sign-in capture against the migrated disposable database. */
const realCapture: WorkspaceAuthConfig["captureAccountLocalePreference"] = (
  accountId,
  locale
) =>
  captureAccountLocalePreference(accountId, locale).pipe(
    Effect.provide(
      Layer.succeed(
        WorkspaceDatabase,
        WorkspaceDatabase.of({ db: testDatabase!.db })
      )
    )
  );

/**
 * The real durable-account creation against the migrated disposable database,
 * which an adapter wrapping the Postgres one needs before every login insert.
 */
export const realCreateCustomerAccount: WorkspaceAuthConfig["createCustomerAccount"] =
  (accountId) => ensureCustomerAccount(testDatabase!.db, accountId);

/** The real administrator grant read on the migrated disposable database. */
const realHasAdministratorGrant: WorkspaceAuthConfig["hasAdministratorGrant"] =
  (accountId) =>
    Effect.flatMap(AccountRoleGrants, (grants) =>
      grants.has({ accountId, role: "administrator" })
    ).pipe(
      Effect.provide(
        AccountRoleGrants.Default.pipe(Layer.provide(testDatabaseLayer()))
      )
    );

/** The review-account marker on the migrated disposable database. */
const realReviewAccounts: Pick<
  WorkspaceAuthConfig,
  "isReviewAccount" | "registerReviewAccount"
> = {
  isReviewAccount: (accountId) =>
    Effect.flatMap(ReviewAccounts, (reviewAccounts) =>
      reviewAccounts.isReviewAccount(accountId)
    ).pipe(
      Effect.provide(
        ReviewAccounts.Default.pipe(Layer.provide(testDatabaseLayer()))
      )
    ),
  registerReviewAccount: (accountId) =>
    Effect.flatMap(ReviewAccounts, (reviewAccounts) =>
      reviewAccounts.register(accountId)
    ).pipe(
      Effect.provide(
        ReviewAccounts.Default.pipe(Layer.provide(testDatabaseLayer()))
      )
    ),
};

/** The production advisory lock on the migrated disposable database. */
const realSignInEmailLock: WorkspaceAuthConfig["withSignInEmailLock"] = (
  key,
  effect
) =>
  Effect.flatMap(WorkspaceDatabaseAdvisoryLock, (advisoryLock) =>
    advisoryLock.withLock(key, effect)
  ).pipe(
    Effect.provide(WorkspaceDatabaseAdvisoryLock.makeLayer(testDatabase!.pool))
  );

/** A database failure the sign-in capture sees. */
export const captureFailure = () =>
  new EffectDrizzleQueryError({
    query: 'update "auth"."user" set "locale"',
    params: [],
    cause: Cause.fail(
      new SqlError.SqlError({
        reason: new SqlError.ConstraintError({
          cause: new Error("synthetic constraint violation"),
          message: "synthetic constraint violation",
          operation: "execute",
        }),
      })
    ),
  });

export const makeTestAuth = (options: TestAuthOptions = {}) => {
  const sendMagicLink: MagicLinkSendFunction = (data) => {
    options.sentLinks?.push(data);
  };
  const captureAccountLocalePreference:
    | WorkspaceAuthConfig["captureAccountLocalePreference"]
    | undefined =
    options.captureAccountLocalePreference ??
    // The real capture requires the migrated disposable Postgres, so
    // memory-backed auth instances default to a noop capture.
    (testDatabase && !options.database ? realCapture : () => Effect.void);
  // Memory-backed instances run in one process with no Postgres to lock.
  const withSignInEmailLock: WorkspaceAuthConfig["withSignInEmailLock"] =
    testDatabase && !options.database
      ? realSignInEmailLock
      : (_key, effect) => effect;
  return makeWorkspaceAuth({
    database: options.database ?? buildDatabaseAdapter(),
    secrets: options.secrets ?? [{ version: 1, value: SECRET_V1 }],
    allowedHosts: [HOST],
    passkeyRelyingParty: { rpID: HOST, origins: [`https://${HOST}`] },
    customerMcpResource: `https://${HOST}/api/mcp`,
    clientMetadataTransport: options.clientMetadataTransport,
    httpsOnly: true,
    isSignInCodeEnabled: options.isSignInCodeEnabled ?? (async () => false),
    arePasskeysEnabled: options.arePasskeysEnabled ?? (async () => true),
    verifyHuman: options.verifyHuman ?? (() => Effect.void),
    withSignInEmailLock,
    sendMagicLink,
    beforeDeleteUser: options.beforeDeleteUser ?? (() => Effect.void),
    createCustomerAccount:
      options.createCustomerAccount ??
      // Memory-backed instances have no customer_accounts table.
      (testDatabase && !options.database
        ? realCreateCustomerAccount
        : () => Effect.void),
    hasAdministratorGrant:
      options.hasAdministratorGrant ??
      // Memory-backed instances have no role grants.
      (testDatabase && !options.database
        ? realHasAdministratorGrant
        : () => Effect.succeed(false)),
    revokeUnconsentedAdministrationTokens:
      testDatabase && !options.database
        ? (owner) =>
            revokeUnconsentedAdministrationTokens(owner).pipe(
              Effect.provide(testDatabaseLayer())
            )
        : () => Effect.void,
    captureAccountLocalePreference,
    reviewAccountCredentials: options.reviewAccountCredentials ?? [],
    // Memory-backed instances have no customer_accounts table.
    isReviewAccount:
      options.isReviewAccount ??
      (testDatabase && !options.database
        ? realReviewAccounts.isReviewAccount
        : () => Effect.succeed(false)),
    registerReviewAccount:
      options.registerReviewAccount ??
      (testDatabase && !options.database
        ? realReviewAccounts.registerReviewAccount
        : () => Effect.void),
  });
};

type MemoryAuthStore = {
  readonly user: User[];
  readonly session: Session[];
  readonly account: Account[];
  readonly verification: Verification[];
  readonly rateLimit: RateLimit[];
  readonly passkey: Passkey[];
  readonly oauthClient: unknown[];
  readonly oauthResource: unknown[];
  readonly oauthClientResource: unknown[];
  readonly oauthRefreshToken: unknown[];
  readonly oauthAccessToken: unknown[];
  readonly oauthConsent: unknown[];
  readonly oauthClientAssertion: unknown[];
};

/**
 * An empty in-memory store with every model the Workspace instance uses. The
 * OAuth provider seeds the MCP resource when the instance starts, so the
 * store needs its models even in tests that never authorize an agent.
 */
export const makeMemoryAuthStore = (): MemoryAuthStore => ({
  user: [],
  session: [],
  account: [],
  verification: [],
  rateLimit: [],
  passkey: [],
  oauthClient: [],
  oauthResource: [],
  oauthClientResource: [],
  oauthRefreshToken: [],
  oauthAccessToken: [],
  oauthConsent: [],
  oauthClientAssertion: [],
});

export const makeMemoryTestAuth = (
  options: Omit<TestAuthOptions, "database"> = {}
) => {
  const store = makeMemoryAuthStore();
  const auth = makeTestAuth({
    ...options,
    database: memoryAdapter(store),
  });
  return { auth, store };
};

export const callHandler = (
  auth: TestAuth,
  path: string,
  init: RequestInit = {}
) =>
  auth.handler(
    new Request(`https://${HOST}/api/auth${path}`, {
      ...init,
      headers: {
        origin: `https://${HOST}`,
        "x-vercel-forwarded-for": "192.0.2.1",
        ...((init.headers as Record<string, string>) ?? {}),
      },
    })
  );

const runIpOctet = Math.floor(Math.random() * 200) + 20;
let ipCounter = 0;
/**
 * A private IPv4 address no other request of this run used. The run's octet
 * keeps concurrent runs apart; the counter spans two octets, so a suite can
 * make more than 255 requests and every address stays valid.
 */
export const uniqueIp = () => {
  ipCounter += 1;
  return `172.${16 + Math.floor(ipCounter / 256)}.${runIpOctet}.${ipCounter % 256}`;
};

const runCustomerPrefix = Math.floor(Math.random() * 900000) + 100000;
let customerCounter = 0;
export const uniqueDotyposCustomerId = () => {
  customerCounter += 1;
  return `${runCustomerPrefix}${customerCounter}`;
};

export const uniqueEmail = (label: string) =>
  testEmailAddress(`${label}-${crypto.randomUUID()}`);
export const signInForMagicLink = (
  auth: TestAuth,
  email: string,
  callbackURL?: string,
  ip: string = uniqueIp()
) =>
  callHandler(auth, "/sign-in/magic-link", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-vercel-forwarded-for": ip,
    },
    body: JSON.stringify(callbackURL ? { email, callbackURL } : { email }),
  });

export const getSessionCookie = (response: Response) =>
  response.headers
    .getSetCookie()
    .find((cookie) => cookie.includes("session_token="));

export const cookieJar = (setCookie: string) => setCookie.split(";")[0]!;

export const userIdForEmail = async (email: string) => {
  const result = await testDatabase!.pool.query(
    `select id from auth."user" where email = $1`,
    [email]
  );
  return (result.rows[0]?.id as string | undefined) ?? undefined;
};

export const linkAccount = async (
  userId: string,
  dotyposCustomerId: string
) => {
  await testDatabase!.pool.query(
    `update customer_accounts set dotypos_customer_id = $2 where id = $1`,
    [userId, dotyposCustomerId]
  );
};

const verifyLinkPath = (link: CapturedMagicLink) =>
  link.url.slice(`https://${HOST}/api/auth`.length);

export const verifyMagicLink = (
  auth: TestAuth,
  link: CapturedMagicLink,
  ip: string = uniqueIp()
) =>
  callHandler(auth, verifyLinkPath(link), {
    headers: { "x-vercel-forwarded-for": ip },
  });
