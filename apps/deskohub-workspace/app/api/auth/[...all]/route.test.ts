import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { drizzleAdapter } from "@better-auth/drizzle-adapter/relations-v2";
import type {
  Account,
  RateLimit,
  Session,
  User,
  Verification,
} from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { makeNodePostgresDatabase } from "@/db/database-client";
import {
  authAccount,
  authRateLimit,
  authSession,
  authUser,
  authVerification,
} from "@/db/schema/auth";
import { makeWorkspaceAuth } from "@/features/account/backend/auth/auth-server";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";

const testDatabase = await connectWorkspacePostgresTestDatabase();

const SECRET_V1 = Buffer.alloc(48, 31).toString("base64url");
const HOST = "workspace.test";

let handlerOverride:
  | ((request: Request) => Promise<Response> | Response)
  | null = null;

mock.module("@/features/account/server/auth.server", () => ({
  auth: {
    handler: (request: Request) => {
      if (!handlerOverride) {
        throw new Error("No auth handler installed for this test");
      }
      return handlerOverride(request);
    },
  },
}));

let wrapperIpCounter = 0;
const callRoute = async (
  path: string,
  method: "GET" | "POST",
  init: RequestInit = {}
) => {
  const { GET, POST } = (await import("./route")) as {
    GET: (request: Request) => Promise<Response>;
    POST: (request: Request) => Promise<Response>;
  };
  const handler = method === "GET" ? GET : POST;
  wrapperIpCounter += 1;
  return handler(
    new Request(`https://${HOST}/api/auth${path}`, {
      ...init,
      headers: {
        origin: `https://${HOST}`,
        "x-vercel-forwarded-for": `192.0.2.${wrapperIpCounter}`,
        ...((init.headers as Record<string, string>) ?? {}),
      },
    })
  );
};

const cannedResponse = (init: {
  readonly status: number;
  readonly headers?: Record<string, string>;
  readonly body?: string;
}) =>
  new Response(init.body ?? null, {
    status: init.status,
    headers: init.headers,
  });

describe("Better Auth route wrapper", () => {
  test("exports only GET and POST and forwards method, path, and headers", async () => {
    const seen: { method: string; url: string; header: string | null }[] = [];
    handlerOverride = (request) => {
      seen.push({
        method: request.method,
        url: request.url,
        header: request.headers.get("x-vercel-forwarded-for"),
      });
      return cannedResponse({ status: 200, body: "{}" });
    };

    const routeModule = (await import("./route")) as {
      GET: (request: Request) => Promise<Response>;
      POST: (request: Request) => Promise<Response>;
    };
    expect(routeModule.GET).toBeInstanceOf(Function);
    expect(routeModule.POST).toBeInstanceOf(Function);
    expect("PUT" in routeModule).toBe(false);
    expect("DELETE" in routeModule).toBe(false);

    await callRoute("/get-session", "GET");
    await callRoute("/sign-in/magic-link", "POST", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });

    expect(seen.map(({ method }) => method)).toEqual(["GET", "POST"]);
    expect(seen[0]!.url).toBe(`https://${HOST}/api/auth/get-session`);
    expect(seen[0]!.header).toBe("192.0.2.1");
    expect(seen[1]!.header).toBe("192.0.2.2");
  });

  test("forces private, no-store on success, redirects, and errors", async () => {
    const responses = [200, 302, 403, 500].map((status) =>
      cannedResponse({
        status,
        headers:
          status === 302
            ? {
                location: `https://${HOST}/en-US/account`,
                "set-cookie": "session_token=secret; Path=/; HttpOnly",
              }
            : {},
      })
    );
    handlerOverride = () => responses.shift()!;

    for (const status of [200, 302, 403, 500]) {
      const response = await callRoute("/any-path", "GET");
      expect(response.status).toBe(status);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
    }
  });

  test("preserves redirects and Set-Cookie headers while overriding upstream caching", async () => {
    handlerOverride = () =>
      cannedResponse({
        status: 302,
        headers: {
          location: `https://${HOST}/cs-CZ/account`,
          "set-cookie": "session_token=rotated; Path=/; HttpOnly; SameSite=Lax",
          "cache-control": "public, max-age=3600",
        },
      });

    const response = await callRoute("/magic-link/verify?token=x", "GET");

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      `https://${HOST}/cs-CZ/account`
    );
    expect(response.headers.getSetCookie()).toEqual([
      "session_token=rotated; Path=/; HttpOnly; SameSite=Lax",
    ]);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});

const uniqueEmail = (label: string) =>
  `${label}-${crypto.randomUUID()}@deskohub.test`;

const makeDisposableAuth = (
  sentLinks: { email: string; url: string; token: string }[]
) =>
  makeWorkspaceAuth({
    database: drizzleAdapter(makeNodePostgresDatabase(testDatabase!.pool), {
      provider: "pg",
      schema: {
        user: authUser,
        session: authSession,
        account: authAccount,
        verification: authVerification,
        rateLimit: authRateLimit,
      },
      schemaName: "auth",
    }),
    secrets: [{ version: 1, value: SECRET_V1 }],
    allowedHosts: [HOST],
    httpsOnly: true,
    areAccountsEnabled: async () => true,
    sendMagicLink: (data) => {
      sentLinks.push(data);
    },
    beforeDeleteUser: () => Promise.resolve(),
  });

type CapturedMagicLink = {
  readonly email: string;
  readonly url: string;
  readonly token: string;
};

type MemoryAuthStore = {
  readonly user: User[];
  readonly session: Session[];
  readonly account: Account[];
  readonly verification: Verification[];
  readonly rateLimit: RateLimit[];
};

const makeMemoryAuth = (
  sentLinks: CapturedMagicLink[],
  areAccountsEnabled: () => Promise<boolean>
) => {
  const store: MemoryAuthStore = {
    user: [],
    session: [],
    account: [],
    verification: [],
    rateLimit: [],
  };
  const auth = makeWorkspaceAuth({
    database: memoryAdapter(store),
    secrets: [{ version: 1, value: SECRET_V1 }],
    allowedHosts: [HOST],
    httpsOnly: true,
    areAccountsEnabled,
    sendMagicLink: (data) => {
      sentLinks.push(data);
    },
    beforeDeleteUser: () => Promise.resolve(),
  });
  return { auth, store };
};

const expectPrivateNoStore = (response: Response) => {
  expect(response.headers.get("cache-control")).toBe("private, no-store");
};

test("runs the account gate through the exported route methods with memory auth", async () => {
  const sentLinks: CapturedMagicLink[] = [];
  let enabled = true;
  const { auth, store } = makeMemoryAuth(sentLinks, async () => enabled);
  handlerOverride = auth.handler as (request: Request) => Promise<Response>;

  const email = uniqueEmail("route-gate");
  const issued = await callRoute("/sign-in/magic-link", "POST", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email }),
  });
  expect(issued.status).toBe(200);
  expectPrivateNoStore(issued);
  expect(issued.headers.getSetCookie()).toHaveLength(0);
  expect(sentLinks).toHaveLength(1);
  expect(store.verification).toHaveLength(1);
  expect(store.session).toHaveLength(0);

  const link = sentLinks[0]!;
  const verifyPath = link.url.slice(`https://${HOST}/api/auth`.length);
  enabled = false;

  const offIssuance = await callRoute("/sign-in/magic-link", "POST", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: uniqueEmail("route-gate-off") }),
  });
  expect(offIssuance.status).toBe(503);
  expectPrivateNoStore(offIssuance);
  expect(offIssuance.headers.getSetCookie()).toHaveLength(0);
  expect(sentLinks).toHaveLength(1);
  expect(store.verification).toHaveLength(1);
  expect(store.session).toHaveLength(0);

  const offVerification = await callRoute(verifyPath, "GET");
  expect(offVerification.status).toBe(503);
  expectPrivateNoStore(offVerification);
  expect(offVerification.headers.getSetCookie()).toHaveLength(0);
  expect(sentLinks).toHaveLength(1);
  expect(store.verification).toHaveLength(1);
  expect(store.session).toHaveLength(0);

  enabled = true;
  const verified = await callRoute(verifyPath, "GET");
  expect(verified.status).toBe(302);
  expectPrivateNoStore(verified);
  expect(
    verified.headers
      .getSetCookie()
      .some((cookie) => cookie.includes("session_token="))
  ).toBe(true);
  expect(store.verification).toHaveLength(0);
  expect(store.session).toHaveLength(1);
});

describe.skipIf(!testDatabase)(
  "Better Auth route on the migrated disposable Postgres",
  () => {
    test("answers the official endpoints and rejects unknown paths with private, no-store", async () => {
      handlerOverride = makeDisposableAuth([]).handler as (
        request: Request
      ) => Promise<Response>;

      const signIn = await callRoute("/sign-in/magic-link", "POST", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: uniqueEmail("route") }),
      });
      expect(signIn.status).toBe(200);
      expect(signIn.headers.get("cache-control")).toBe("private, no-store");

      const unknown = await callRoute("/does-not-exist", "GET");
      expect(unknown.status).toBe(404);
      expect(unknown.headers.get("cache-control")).toBe("private, no-store");
    });

    test("keeps the verify redirect and session cookie while forcing private, no-store", async () => {
      const sentLinks: { email: string; url: string; token: string }[] = [];
      handlerOverride = makeDisposableAuth(sentLinks).handler as (
        request: Request
      ) => Promise<Response>;

      const email = uniqueEmail("route-verify");
      await callRoute("/sign-in/magic-link", "POST", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email,
          callbackURL: `/${"en-US"}/account`,
          metadata: { locale: "en-US" },
        }),
      });
      const link = sentLinks[0]!;
      expect(link.url.startsWith(`https://${HOST}/api/auth`)).toBe(true);

      const verifyPath = link.url.slice(`https://${HOST}/api/auth`.length);
      const verify = await callRoute(verifyPath, "GET");

      expect(verify.status).toBe(302);
      expect(verify.headers.get("location")).toBe(
        `https://${HOST}/en-US/account`
      );
      expect(
        verify.headers
          .getSetCookie()
          .some((cookie) => cookie.includes("session_token="))
      ).toBe(true);
      expect(verify.headers.get("cache-control")).toBe("private, no-store");
    });

    test("rejects replayed links and foreign origins without caching the failure", async () => {
      const sentLinks: { email: string; url: string; token: string }[] = [];
      handlerOverride = makeDisposableAuth(sentLinks).handler as (
        request: Request
      ) => Promise<Response>;

      const email = uniqueEmail("route-replay");
      await callRoute("/sign-in/magic-link", "POST", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const link = sentLinks[0]!;
      const verifyPath = link.url.slice(`https://${HOST}/api/auth`.length);

      const first = await callRoute(verifyPath, "GET");
      expect(first.status).toBe(302);
      const sessionCookie = first.headers
        .getSetCookie()
        .find((cookie) => cookie.includes("session_token="))!
        .split(";")[0];

      const replay = await callRoute(verifyPath, "GET");
      expect(replay.headers.get("location") ?? "").toContain("error=");
      expect(
        replay.headers
          .getSetCookie()
          .some((cookie) => cookie.includes("session_token="))
      ).toBe(false);
      expect(replay.headers.get("cache-control")).toBe("private, no-store");

      const foreign = await callRoute("/sign-out", "POST", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://evil.example",
          cookie: sessionCookie,
        },
        body: "{}",
      });
      expect(foreign.status).toBe(403);
      expect(foreign.headers.get("cache-control")).toBe("private, no-store");
    });
  }
);
