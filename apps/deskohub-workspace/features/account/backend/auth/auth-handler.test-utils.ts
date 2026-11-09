import { testEmailAddress } from "@deskohub/test-email";
import "@/shared/testing/workspace-test-env";

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
import { Cause, Effect } from "effect";
import * as SqlError from "effect/unstable/sql/SqlError";
import { makeAuthDatabase } from "@/db/auth-database-client";
import { drizzleAuthTables } from "@/db/schema/auth";
import {
  connectWorkspacePostgresTestDatabase,
  type WorkspacePostgresTestDatabase,
} from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { captureWorkspaceLogs } from "@/shared/testing/workspace-telemetry.test-utils";
import { ensureCustomerAccount } from "../customer-account.repository";
import type { AuthHookServiceOverrides } from "./auth-hook-services.test-utils";
import type {
  MagicLinkSendFunction,
  SignInEmail,
  WorkspaceAuthConfig,
} from "./auth-server";
import { nativeAppOrigin } from "./native-app";

/**
 * The Workspace Better Auth instance under test, against the migrated
 * disposable Postgres when one is configured or an in-memory store, with the
 * HTTP helpers its handler tests share.
 */

/** The Workspace logs the auth handler's runs send. */
export const workspaceLogs = captureWorkspaceLogs();

// Imported after the instrumentation mock: the hooks' capabilities load the
// Workspace runner, which reads the logger provider when it loads.
const { makeWorkspaceAuth } = await import("./auth-server");
const { memoryAuthHookServices, postgresAuthHookServices } = await import(
  "./auth-hook-services.test-utils"
);
export const { testAccountDeletion, unavailableFlag, unbuildableFlagProvider } =
  await import("./auth-hook-services.test-utils");

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

export type TestAuthOptions = AuthHookServiceOverrides & {
  /**
   * The migrated database the logins and their Workspace records live in,
   * the configured test database by default. A suite database keeps them
   * beside the suite's other rows.
   */
  readonly postgres?: WorkspacePostgresTestDatabase;
  /** Another store; its logins keep no Workspace records. */
  readonly database?: WorkspaceAuthConfig["database"];
  readonly secrets?: { readonly version: number; readonly value: string }[];
  readonly sentLinks?: CapturedMagicLink[];
  readonly accountDeletion?: WorkspaceAuthConfig["accountDeletion"];
  readonly nativeAppLinkOrigin?: WorkspaceAuthConfig["nativeAppLinkOrigin"];
  readonly passkeyRelyingParty?: WorkspaceAuthConfig["passkeyRelyingParty"];
  readonly clientMetadataTransport?: WorkspaceAuthConfig["clientMetadataTransport"];
  readonly reviewAccountCredentials?: WorkspaceAuthConfig["reviewAccountCredentials"];
};

/**
 * The real durable-account creation against the migrated disposable database,
 * which an adapter wrapping the Postgres one needs before every login insert.
 */
export const realCreateCustomerAccount: NonNullable<
  TestAuthOptions["createCustomerAccount"]
> = (accountId) =>
  ensureCustomerAccount(accountId).pipe(Effect.provide(testDatabase!.layer));

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
  const postgres = options.postgres ?? testDatabase;
  return makeWorkspaceAuth({
    database: options.database ?? buildDatabaseAdapter(postgres!.pool),
    secrets: options.secrets ?? [{ version: 1, value: SECRET_V1 }],
    allowedHosts: [HOST],
    nativeAppLinkOrigin: options.nativeAppLinkOrigin ?? `https://${HOST}`,
    passkeyRelyingParty: options.passkeyRelyingParty ?? {
      rpID: HOST,
      origins: [`https://${HOST}`],
    },
    customerMcpResource: `https://${HOST}/api/mcp`,
    clientMetadataTransport: options.clientMetadataTransport,
    httpsOnly: true,
    reviewAccountCredentials: options.reviewAccountCredentials ?? [],
    sendMagicLink,
    // The real capabilities need the migrated disposable Postgres behind the
    // default store; any other store gets capabilities that keep no
    // Workspace records.
    services:
      postgres && !options.database
        ? postgresAuthHookServices(postgres, options)
        : memoryAuthHookServices(options),
    accountDeletion: options.accountDeletion ?? testAccountDeletion(),
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

/**
 * Calls the handler as the native app's Better Auth Expo client does: no
 * browser `Origin` header, and the app scheme in `expo-origin`, which the
 * Expo server plugin turns into the origin. Pass `null` to send neither.
 */
export const callNativeHandler = (
  auth: TestAuth,
  path: string,
  init: RequestInit = {},
  expoOrigin: string | null = nativeAppOrigin
) => {
  const headers = new Headers(init.headers);
  if (!headers.has("x-vercel-forwarded-for")) {
    headers.set("x-vercel-forwarded-for", "192.0.2.1");
  }
  if (expoOrigin !== null) headers.set("expo-origin", expoOrigin);
  return auth.handler(
    new Request(`https://${HOST}/api/auth${path}`, { ...init, headers })
  );
};

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

export const userIdForEmail = async (
  email: string,
  postgres = testDatabase!
) => {
  const result = await postgres.pool.query(
    `select id from auth."user" where email = $1`,
    [email]
  );
  return (result.rows[0]?.id as string | undefined) ?? undefined;
};

export const linkAccount = async (
  userId: string,
  dotyposCustomerId: string,
  postgres = testDatabase!
) => {
  await postgres.pool.query(
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
