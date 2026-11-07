import { createHash, randomUUID } from "node:crypto";

/**
 * An in-memory Workspace auth server for the native sign-in tests. It
 * implements the four endpoints the app calls as the #990/#1005 contract
 * describes them: magic-link verify without a callback URL, the native
 * handoff exchange, get-session and sign-out. `issueMagicLink` and
 * `mintHandoff` stand in for the email and the web sign-in page.
 */

export interface FakeUser {
  readonly id: string;
  readonly email: string;
}

interface HandoffCode {
  readonly user: FakeUser;
  readonly codeChallenge: string;
  readonly returnUri: string;
  used: boolean;
}

export interface FakeAuthCall {
  readonly method: string;
  readonly path: string;
  readonly query: ReadonlyArray<string>;
}

const cookieName = "__Secure-better-auth.session_token";
const sessionMaxAgeSeconds = 7 * 24 * 60 * 60;

const json = (
  status: number,
  body: unknown,
  headers: Record<string, string> = {}
) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

const challengeOf = (verifier: string) =>
  createHash("sha256").update(verifier, "ascii").digest("base64url");

const sessionTokenFrom = (cookie: string | null): string | undefined =>
  cookie
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${cookieName}=`))
    ?.slice(cookieName.length + 1);

export const makeFakeAuthServer = (origin: string) => {
  const magicLinks = new Map<string, FakeUser>();
  const handoffCodes = new Map<string, HandoffCode>();
  const sessions = new Map<string, FakeUser>();
  const calls: Array<FakeAuthCall> = [];
  const faults: {
    exchangeGate: Promise<void> | undefined;
    getSessionFailuresAfterExchange: number;
    getSessionFailures: number;
    exchanged: boolean;
  } = {
    exchangeGate: undefined,
    getSessionFailuresAfterExchange: 0,
    getSessionFailures: 0,
    exchanged: false,
  };

  const openSession = (user: FakeUser) => {
    const token = `session-${randomUUID()}`;
    sessions.set(token, user);
    return {
      token,
      setCookie: `${cookieName}=${token}; Max-Age=${sessionMaxAgeSeconds}; Path=/; HttpOnly; Secure; SameSite=Lax`,
    };
  };

  const sessionBody = (token: string, user: FakeUser) => ({
    session: {
      id: `id-${token}`,
      token,
      userId: user.id,
      expiresAt: new Date(Date.now() + sessionMaxAgeSeconds * 1000),
    },
    user: { ...user, name: "", emailVerified: true },
  });

  const handle = async (
    url: URL,
    method: string,
    headers: Headers,
    body: string
  ) => {
    const path = url.pathname.replace(/^\/api\/auth/, "");
    calls.push({ method, path, query: [...url.searchParams.keys()] });

    if (method === "GET" && path === "/magic-link/verify") {
      const token = url.searchParams.get("token") ?? "";
      const user = magicLinks.get(token);
      if (user === undefined || [...url.searchParams.keys()].length !== 1) {
        return json(400, { code: "INVALID_TOKEN", message: "Invalid token" });
      }
      magicLinks.delete(token);
      const session = openSession(user);
      return json(200, sessionBody(session.token, user), {
        "set-cookie": session.setCookie,
      });
    }

    if (method === "POST" && path === "/native-handoff/exchange") {
      if (faults.exchangeGate !== undefined) await faults.exchangeGate;
      const refused = json(
        400,
        { code: "INVALID_HANDOFF_CODE", message: "Invalid handoff code" },
        { "cache-control": "no-store" }
      );
      if (headers.get("expo-origin") !== "deskohub://") return refused;
      const input = JSON.parse(body) as Record<string, unknown>;
      const handoff = handoffCodes.get(String(input.code));
      if (
        handoff === undefined ||
        handoff.used ||
        input.return_uri !== handoff.returnUri ||
        typeof input.code_verifier !== "string" ||
        challengeOf(input.code_verifier) !== handoff.codeChallenge
      ) {
        return refused;
      }
      handoff.used = true;
      faults.exchanged = true;
      const session = openSession(handoff.user);
      return json(
        200,
        { status: true },
        { "set-cookie": session.setCookie, "cache-control": "no-store" }
      );
    }

    if (method === "GET" && path === "/get-session") {
      if (faults.getSessionFailures > 0) {
        faults.getSessionFailures -= 1;
        return json(500, { code: "INTERNAL_SERVER_ERROR" });
      }
      if (faults.exchanged && faults.getSessionFailuresAfterExchange > 0) {
        faults.getSessionFailuresAfterExchange -= 1;
        return json(500, { code: "INTERNAL_SERVER_ERROR" });
      }
      const token = sessionTokenFrom(headers.get("cookie"));
      const user = token === undefined ? undefined : sessions.get(token);
      return json(
        200,
        token === undefined || user === undefined
          ? null
          : sessionBody(token, user)
      );
    }

    if (method === "POST" && path === "/sign-out") {
      const token = sessionTokenFrom(headers.get("cookie"));
      if (token !== undefined) sessions.delete(token);
      return json(
        200,
        { success: true },
        { "set-cookie": `${cookieName}=; Max-Age=0; Path=/` }
      );
    }

    return json(404, { code: "NOT_FOUND" });
  };

  const fetch = async (
    input: string | URL | Request,
    init?: RequestInit
  ): Promise<Response> => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.origin !== origin) throw new TypeError("Network request failed");
    return handle(url, request.method, request.headers, await request.text());
  };

  return {
    calls,
    fetch,
    /** The token of a sign-in email sent to `user`. */
    issueMagicLink: (user: FakeUser) => {
      const token = `magic-${randomUUID()}`;
      magicLinks.set(token, user);
      return token;
    },
    /** What the web page's mint returns after `user` signs in there. */
    mintHandoff: (
      user: FakeUser,
      request: {
        readonly codeChallenge: string;
        readonly state: string;
        readonly returnUri: string;
      }
    ) => {
      const code = `handoff-${randomUUID()}`;
      handoffCodes.set(code, {
        user,
        codeChallenge: request.codeChallenge,
        returnUri: request.returnUri,
        used: false,
      });
      const search = new URLSearchParams({ code, state: request.state });
      return `${request.returnUri}?${search.toString()}`;
    },
    openSessions: () => [...sessions.values()],
    /** Holds every exchange until `gate` resolves. */
    holdExchanges: (gate: Promise<void>) => {
      faults.exchangeGate = gate;
    },
    /** Fails the next `count` session reads. */
    failSessionReads: (count: number) => {
      faults.getSessionFailures = count;
    },
    /** Fails the next `count` session reads after a code was exchanged. */
    failSessionReadsAfterExchange: (count: number) => {
      faults.getSessionFailuresAfterExchange = count;
    },
    callsTo: (path: string) => calls.filter((call) => call.path === path),
  };
};

export type FakeAuthServer = ReturnType<typeof makeFakeAuthServer>;
