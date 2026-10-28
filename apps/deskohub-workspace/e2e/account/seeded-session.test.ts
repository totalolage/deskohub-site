import { describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import type {
  Account,
  RateLimit,
  Session,
  User,
  Verification,
} from "better-auth";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { Effect, Logger, References } from "effect";
import { authOptions } from "@/features/account/backend/auth/auth-options";
import { makeDatabaseClient, makeDatabasePool } from "../../db/database-client";
import type { E2EBrowserSession } from "../browser-session";
import { WorkspaceE2EError } from "../errors";
import { E2EDatabase } from "../integrations/database.service";
import { redact } from "../runtime";
import {
  resolveWorkspaceE2ESessionSigningSecret,
  signInWorkspaceE2ESyntheticAccount,
  signWorkspaceE2ESessionToken,
  workspaceE2ESessionCookieFor,
  workspaceE2ESessionCookieName,
} from "./seeded-session";

const host = "workspace-session.test";
const currentSecret = "synthetic-current-session-signing-secret-0123456789";
const retiredSecret = "synthetic-retired-session-signing-secret-9876543210";

/**
 * The deployed instance's connectionless options with a memory store: the
 * same cookie naming, HTTPS-only prefix, signing secret selection, and
 * database session lookup the protected preview uses.
 */
const makeDeployedShapeAuth = (
  origin: { readonly host: string; readonly protocol: "http" | "https" } = {
    host,
    protocol: "https",
  }
) => {
  const store = {
    account: [] as Account[],
    rateLimit: [] as RateLimit[],
    session: [] as Session[],
    user: [] as User[],
    verification: [] as Verification[],
  };
  const auth = betterAuth({
    ...authOptions,
    baseURL: { allowedHosts: [origin.host], protocol: origin.protocol },
    database: memoryAdapter(store),
    secrets: [
      { value: currentSecret, version: 2 },
      { value: retiredSecret, version: 1 },
    ],
  });
  return { auth, store };
};

const seedStoredSession = (
  store: ReturnType<typeof makeDeployedShapeAuth>["store"],
  token: string
) => {
  const now = new Date();
  store.user.push({
    createdAt: now,
    email: testEmailAddress("seeded"),
    emailVerified: true,
    id: "seeded-user",
    image: null,
    name: "Seeded User",
    updatedAt: now,
  });
  store.session.push({
    createdAt: now,
    expiresAt: new Date(now.getTime() + 60 * 60_000),
    id: "seeded-session",
    ipAddress: "",
    token,
    updatedAt: now,
    userAgent: "",
    userId: "seeded-user",
  });
};

const readSession = (
  auth: ReturnType<typeof makeDeployedShapeAuth>["auth"],
  cookie: string,
  origin = `https://${host}`
) =>
  auth.api.getSession({
    headers: new Headers({
      cookie,
      host: new URL(origin).host,
      origin,
    }),
  });

const unreachable = Effect.die("the failed insert reached the browser");

/** A browser session the database-log test must never touch. */
const unreachableBrowserSession: E2EBrowserSession = {
  activate: () => unreachable,
  captureFailureArtifacts: () => unreachable,
  clearDiagnostics: () => unreachable,
  close: () => unreachable,
  describeCookie: () => unreachable,
  diagnostics: unreachable,
  evaluate: () => unreachable,
  primePreviewAccess: () => unreachable,
  setSessionCookie: () => unreachable,
  use: () => unreachable,
};

describe("workspace e2e seeded sessions", () => {
  test("Better Auth accepts the seeded cookie signed with the current secret", async () => {
    const { auth, store } = makeDeployedShapeAuth();
    const token = "a".repeat(16) + "b".repeat(16);
    seedStoredSession(store, token);
    const secret = resolveWorkspaceE2ESessionSigningSecret({
      WORKSPACE_E2E_BETTER_AUTH_SECRETS: `2:${currentSecret},1:${retiredSecret}`,
    });

    const value = await signWorkspaceE2ESessionToken(token, secret);
    const session = await readSession(
      auth,
      `${workspaceE2ESessionCookieName}=${value}`
    );

    expect(session?.user.id).toBe("seeded-user");
  });

  test("a local development server reads the unprefixed session cookie", async () => {
    const origin = "http://localhost:3110";
    const { auth, store } = makeDeployedShapeAuth({
      host: "localhost:3110",
      protocol: "http",
    });
    const token = "c".repeat(16) + "d".repeat(16);
    seedStoredSession(store, token);
    const cookie = workspaceE2ESessionCookieFor(origin);

    const value = await signWorkspaceE2ESessionToken(token, {
      value: currentSecret,
    });
    const session = await readSession(auth, `${cookie.name}=${value}`, origin);

    expect(cookie.secure).toBe(false);
    expect(session?.user.id).toBe("seeded-user");
    expect(workspaceE2ESessionCookieFor(`https://${host}`)).toEqual({
      name: workspaceE2ESessionCookieName,
      secure: true,
    });
    expect(() => workspaceE2ESessionCookieFor(`http://${host}`)).toThrow(
      WorkspaceE2EError
    );
  });

  test("fails closed with provisioning guidance and never echoes the value", () => {
    for (const value of [undefined, "not-versioned", "1:short"]) {
      let failure: unknown;
      try {
        resolveWorkspaceE2ESessionSigningSecret({
          WORKSPACE_E2E_BETTER_AUTH_SECRETS: value,
        });
      } catch (cause) {
        failure = cause;
      }
      expect(failure).toBeInstanceOf(WorkspaceE2EError);
      const message = (failure as WorkspaceE2EError).message;
      expect(message).toContain("Preview-only BETTER_AUTH_SECRETS");
      expect(message).toContain("never the Production value");
      if (value) expect(message).not.toContain(value);
    }
  });

  test("registers every configured secret with the redactor", () => {
    resolveWorkspaceE2ESessionSigningSecret({
      WORKSPACE_E2E_BETTER_AUTH_SECRETS: `2:${currentSecret},1:${retiredSecret}`,
    });

    expect(redact(`current ${currentSecret} retired ${retiredSecret}`)).toBe(
      "current [redacted] retired [redacted]"
    );
  });

  test("keeps the seeded session token out of database query logs", async () => {
    // The real client and query logger log each statement before it needs a
    // connection, so an unreachable server still yields the logged insert.
    const pool = makeDatabasePool({
      connectionString: "postgresql://synthetic:synthetic@127.0.0.1:1/none",
      connectionTimeoutMillis: 200,
    });
    const annotations: unknown[] = [];
    const capture = Logger.make((options) => {
      annotations.push(options.fiber.getRef(References.CurrentLogAnnotations));
    });
    try {
      const db = await Effect.runPromise(makeDatabaseClient(pool));
      await Effect.runPromiseExit(
        signInWorkspaceE2ESyntheticAccount({
          accountId: "synthetic-account",
          baseUrl: `https://${host}`,
          secret: { value: currentSecret },
          // The insert fails first, so the browser is never reached.
          session: unreachableBrowserSession,
        }).pipe(
          Effect.provideService(E2EDatabase, E2EDatabase.of({ db })),
          Effect.provide(Logger.layer([capture]))
        )
      );
    } finally {
      await pool.end().catch(() => undefined);
    }

    const logged = JSON.stringify(annotations);
    expect(logged).toContain('insert into \\"auth\\".\\"session\\"');
    // Seeded tokens are 32 lowercase hex characters.
    expect(logged).not.toMatch(/[0-9a-f]{32}/);
  });
});
