import "@/shared/testing/workspace-test-env";

import { describe, expect, setSystemTime, test } from "bun:test";
import { createHash } from "node:crypto";
import { Effect, Layer, Option, type Schema } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { AccountRoleGrants } from "@/features/administrators/backend/account-role-grants.service";
import { AdministratorAgentAuthorization } from "@/features/administrators/backend/administrator-agent-authorization.service";
import { AdministratorRoster } from "@/features/administrators/backend/administrator-roster.service";
import {
  type CustomerAccountId,
  customerAccountIdSchema,
} from "../../customer-account";
import {
  customerAgentAuthorizePath,
  resolveCustomerAgentConnectStep,
} from "../../customer-agent-routes";
import { customerAgentTestClientMetadata } from "../../customer-agent-test-client";
import { AuthCleanupService } from "./auth-cleanup.service";
import {
  buildDatabaseAdapter,
  type CapturedMagicLink,
  cookieJar,
  getSessionCookie,
  HOST,
  makeTestAuth,
  realCreateCustomerAccount,
  signInForMagicLink,
  type TestAuth,
  testDatabase,
  uniqueEmail,
  uniqueIp,
  userIdForEmail,
  verifyMagicLink,
} from "./auth-handler.test-utils";
import {
  type CustomerAgentAuthority,
  CustomerAgentAuthorization,
} from "./customer-agent-authorization.service";
import { customerAgentRefreshTokenReuseSeconds } from "./customer-agent-authorization-server";
import { CustomerAgentClientDirectory } from "./customer-agent-client-directory.service";
import { CustomerAgentConnections } from "./customer-agent-connections.service";
import {
  chatGptCallbackClientMetadata,
  chatGptClientMetadata,
  claudeClientMetadata,
  claudeCodeClientMetadata,
} from "./customer-agent-directory-clients.test-utils";

const RESOURCE = `https://${HOST}/api/mcp`;
const ORIGIN = `https://${HOST}`;
const AUTH_BASE = `${ORIGIN}/api/auth`;
const CONNECT_PATH = "/en-US/auth/connect";
const AGENT_SCOPE =
  "offerings:read reservations:read reservations:create offline_access";
/** Every scope a client may ask for, in the server's order. */
const ALL_SCOPES =
  "offerings:read reservations:read reservations:create administration offline_access";
const CLIENT_NAME = "Example Agent";

/** A synthetic agent that publishes its Client ID Metadata Document. */
const makeAgent = (clientName = CLIENT_NAME) => {
  const base = `https://client.example/${crypto.randomUUID()}`;
  const clientId = `${base}/oauth-client.json`;
  const redirectUri = `${base}/callback`;
  const metadataRequests: string[] = [];
  const document = {
    client_id: clientId,
    client_name: clientName,
    redirect_uris: [redirectUri],
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
  };
  const clientMetadataTransport = async (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : String(input);
    metadataRequests.push(url);
    return url === clientId
      ? Response.json(document, {
          headers: { "cache-control": "max-age=300" },
        })
      : new Response("not found", { status: 404 });
  };
  return { clientId, redirectUri, metadataRequests, clientMetadataTransport };
};

/** PKCE S256: a random verifier and its challenge. */
const makePkce = async () => {
  const verifier = Buffer.from(
    crypto.getRandomValues(new Uint8Array(32))
  ).toString("base64url");
  const challenge = Buffer.from(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))
  ).toString("base64url");
  return { verifier, challenge };
};

/** Requests a path under the auth handler as a browser on its own IP. */
const request = (
  auth: TestAuth,
  path: string,
  init: RequestInit & { readonly cookie?: string } = {}
) => {
  const { cookie, ...rest } = init;
  return auth.handler(
    new Request(`${AUTH_BASE}${path}`, {
      ...rest,
      headers: {
        origin: ORIGIN,
        "x-vercel-forwarded-for": uniqueIp(),
        ...(cookie && { cookie }),
        ...((rest.headers as Record<string, string>) ?? {}),
      },
    })
  );
};

/** The redirect target of a 302 response, resolved against the host. */
const redirectOf = (response: Response) => {
  expect(response.status).toBe(302);
  return new URL(response.headers.get("location") ?? "", ORIGIN);
};

/** A path under the auth handler for an `/api/auth/...` location. */
const handlerPath = (location: string | URL) => {
  const url = new URL(location, ORIGIN);
  expect(url.pathname.startsWith("/api/auth/")).toBe(true);
  return `${url.pathname.slice("/api/auth".length)}${url.search}`;
};

/** Signs a new synthetic customer in and returns its session cookie. */
const signIn = async (auth: TestAuth, sentLinks: CapturedMagicLink[]) => {
  const email = uniqueEmail("agent-connect");
  const before = sentLinks.length;
  await signInForMagicLink(auth, email);
  const link = sentLinks[before];
  expect(link?.email).toBe(email);
  const verified = await verifyMagicLink(auth, link!);
  const setCookie = getSessionCookie(verified);
  expect(setCookie).toBeDefined();
  const accountId = await userIdForEmail(email);
  expect(accountId).toBeDefined();
  return { cookie: cookieJar(setCookie!), accountId: accountId! };
};

type AuthorizationRequest = {
  readonly clientId: string;
  readonly redirectUri: string;
  readonly challenge: string;
  readonly state: string;
  readonly scope?: string;
  readonly prompt?: string;
  readonly resource?: string;
};

const authorizePath = (authorization: AuthorizationRequest) => {
  const query = new URLSearchParams({
    response_type: "code",
    client_id: authorization.clientId,
    redirect_uri: authorization.redirectUri,
    state: authorization.state,
    code_challenge: authorization.challenge,
    code_challenge_method: "S256",
    resource: authorization.resource ?? RESOURCE,
  });
  if (authorization.scope) query.set("scope", authorization.scope);
  if (authorization.prompt) query.set("prompt", authorization.prompt);
  return `/oauth2/authorize?${query}`;
};

/**
 * What the consent page's Allow grants a customer without the administrator
 * grant: every requested scope except administration.
 */
const customerConsentScope = (consentPage: URL) =>
  (consentPage.searchParams.get("scope") ?? "")
    .split(" ")
    .filter((scope) => scope !== "administration")
    .join(" ");

/** Posts an answer to the request the consent page was given. */
const postConsent = (
  auth: TestAuth,
  cookie: string,
  consentPage: URL,
  answer: { readonly accept: boolean; readonly scope?: string }
) =>
  request(auth, "/oauth2/consent", {
    method: "POST",
    cookie,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ...answer,
      oauth_query: consentPage.search.slice(1),
    }),
  });

/**
 * Accepts or denies the request the consent page was given. Allow names
 * `scope`, by default what the page grants a customer.
 */
const answerConsent = async (
  auth: TestAuth,
  cookie: string,
  consentPage: URL,
  accept: boolean,
  scope = customerConsentScope(consentPage)
) => {
  const response = await postConsent(
    auth,
    cookie,
    consentPage,
    accept ? { accept, scope } : { accept }
  );
  expect(response.status).toBe(200);
  const body = (await response.json()) as { redirect: boolean; url: string };
  expect(body.redirect).toBe(true);
  return new URL(body.url);
};

type TokenResponse = {
  readonly access_token: string;
  readonly refresh_token?: string;
  readonly token_type: string;
  readonly expires_in: number;
  readonly scope?: string;
};

const requestToken = (auth: TestAuth, form: Record<string, string>) =>
  request(auth, "/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form).toString(),
  });

const exchangeCode = async (
  auth: TestAuth,
  input: {
    readonly clientId: string;
    readonly redirectUri: string;
    readonly code: string;
    readonly verifier: string;
    readonly resource?: string;
  }
) =>
  requestToken(auth, {
    grant_type: "authorization_code",
    client_id: input.clientId,
    code: input.code,
    code_verifier: input.verifier,
    redirect_uri: input.redirectUri,
    resource: input.resource ?? RESOURCE,
  });

/** The adapter over the real Better Auth instance, as `Default` wires it. */
const authorityOver = (
  auth: TestAuth,
  resource = RESOURCE
): CustomerAgentAuthority => ({
  resource,
  validateAccessToken: (token) =>
    auth.api.verifyCustomerAgentAccessToken({
      body: { token },
      headers: new Headers({ host: new URL(RESOURCE).host }),
    }),
  findUser: async (accountId) =>
    (await auth.$context).internalAdapter.findUserById(accountId),
});

const authorizeToken = (authority: CustomerAgentAuthority, token: string) =>
  Effect.runPromise(
    Effect.flatMap(CustomerAgentAuthorization, (authorization) =>
      Effect.all({
        grant: authorization.authorize(token),
        session: authorization.currentUser(token),
      })
    ).pipe(
      Effect.provide(CustomerAgentAuthorization.fromAuthority(authority)),
      Effect.result
    )
  );

const failureReasonOf = async (
  authority: CustomerAgentAuthority,
  token: string
) => {
  const outcome = await authorizeToken(authority, token);
  return outcome._tag === "Failure" && "reason" in outcome.failure
    ? outcome.failure.reason
    : outcome._tag;
};

const findClient = (auth: TestAuth, clientId: string, headers: Headers) =>
  Effect.runPromise(
    Effect.flatMap(CustomerAgentClientDirectory, (directory) =>
      directory.find(clientId)
    ).pipe(
      Effect.provide(
        CustomerAgentClientDirectory.fromAuthority({
          findPublicClient: (id) =>
            auth.api.getOAuthClientPublic({
              query: { client_id: id },
              headers,
            }),
        })
      ),
      Effect.result
    )
  );

/** Reads a client the way the server does without a customer session. */
const findClientOnServer = (auth: TestAuth, clientId: string) =>
  Effect.runPromise(
    Effect.flatMap(CustomerAgentClientDirectory, (directory) =>
      directory.find(clientId)
    ).pipe(
      Effect.provide(
        CustomerAgentClientDirectory.fromAuthority({
          findPublicClient: (id) =>
            auth.api.findCustomerAgentClient({
              body: { clientId: id },
              headers: new Headers({ host: HOST }),
            }),
        })
      )
    )
  );

/** Serves each agent's metadata document from one transport. */
const serveAgents =
  (...agents: ReadonlyArray<ReturnType<typeof makeAgent>>) =>
  (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : String(input);
    const agent =
      agents.find((candidate) => candidate.clientId === url) ?? agents[0]!;
    return agent.clientMetadataTransport(input);
  };

/**
 * Starts an agent's authorization for a customer who is already signed in
 * and returns where the authorization endpoint sends them.
 */
const startAuthorization = async (
  auth: TestAuth,
  cookie: string,
  agent: ReturnType<typeof makeAgent>
) => {
  const pkce = await makePkce();
  const redirect = redirectOf(
    await request(
      auth,
      authorizePath({
        clientId: agent.clientId,
        redirectUri: agent.redirectUri,
        challenge: pkce.challenge,
        state: crypto.randomUUID(),
        scope: AGENT_SCOPE,
      }),
      { cookie }
    )
  );
  return { redirect, pkce };
};

/**
 * Starts an agent's authorization for a customer who is already signed in
 * and hasn't connected it: the request goes straight to consent.
 */
const requestConsent = async (
  auth: TestAuth,
  cookie: string,
  agent: ReturnType<typeof makeAgent>
) => {
  const { redirect: consentPage, pkce } = await startAuthorization(
    auth,
    cookie,
    agent
  );
  expect(consentPage.pathname).toBe("/auth/consent");
  return { consentPage, pkce };
};

/** The code an agent's callback carries, as the agent exchanges it. */
const receivedCode = (
  agent: ReturnType<typeof makeAgent>,
  callback: URL,
  { verifier }: Awaited<ReturnType<typeof makePkce>>
) => {
  expect(callback.href.startsWith(agent.redirectUri)).toBe(true);
  expect(callback.searchParams.get("code")).toBeTruthy();
  return {
    clientId: agent.clientId,
    redirectUri: agent.redirectUri,
    code: callback.searchParams.get("code")!,
    verifier,
  };
};

/**
 * Authorizes an agent for a customer who is already signed in and returns
 * the code it receives, without exchanging it. Without a consent on record
 * the request goes to the consent page and the customer allows it; with one
 * the agent gets its code straight away.
 */
const authorizeSignedIn = async (
  auth: TestAuth,
  cookie: string,
  agent: ReturnType<typeof makeAgent>,
  consent: "asks" | "granted"
) => {
  if (consent === "granted") {
    const { redirect, pkce } = await startAuthorization(auth, cookie, agent);
    return receivedCode(agent, redirect, pkce);
  }
  const { consentPage, pkce } = await requestConsent(auth, cookie, agent);
  return receivedCode(
    agent,
    await answerConsent(auth, cookie, consentPage, true),
    pkce
  );
};

/** The customer allows a consent page, and the agent exchanges its code. */
const allowConsent = async (
  auth: TestAuth,
  cookie: string,
  agent: ReturnType<typeof makeAgent>,
  { consentPage, pkce }: Awaited<ReturnType<typeof requestConsent>>
) => {
  const response = await exchangeCode(
    auth,
    receivedCode(
      agent,
      await answerConsent(auth, cookie, consentPage, true),
      pkce
    )
  );
  expect(response.status).toBe(200);
  return (await response.json()) as TokenResponse;
};

/**
 * Connects an agent for a customer who is already signed in: the request
 * goes straight to consent, the customer allows it, and the agent exchanges
 * its code.
 */
const connectSignedIn = async (
  auth: TestAuth,
  cookie: string,
  agent: ReturnType<typeof makeAgent>
) =>
  allowConsent(auth, cookie, agent, await requestConsent(auth, cookie, agent));

/** The customer's connections, as the account page lists them. */
const listConnections = (auth: TestAuth, cookie: string) => {
  const headers = new Headers({ cookie, host: HOST });
  return Effect.runPromise(
    Effect.flatMap(
      CustomerAgentConnections,
      (connections) => connections.list
    ).pipe(
      Effect.provide(
        CustomerAgentConnections.fromAuthority({
          listConsents: () => auth.api.getOAuthConsents({ headers }),
        }).pipe(
          Layer.provide(
            CustomerAgentClientDirectory.fromAuthority({
              findPublicClient: (clientId) =>
                auth.api.getOAuthClientPublic({
                  query: { client_id: clientId },
                  headers,
                }),
            })
          )
        )
      )
    )
  );
};

const userExists = async (userId: string) => {
  const result = await testDatabase!.pool.query(
    `select 1 from auth."user" where id = $1`,
    [userId]
  );
  return result.rows.length > 0;
};

/** The provider's stored form of a token: unpadded base64url SHA-256. */
const tokenDigest = (token: string) =>
  createHash("sha256").update(token).digest("base64url");

/** Every token value and refresh replay response persisted for an account. */
const storedTokenMaterial = async (userId: string) => {
  const result = await testDatabase!.pool.query(
    `select token, null as rotation_replay_response
       from auth.oauth_access_token where user_id = $1
     union all
     select token, rotation_replay_response
       from auth.oauth_refresh_token where user_id = $1`,
    [userId]
  );
  return result.rows as ReadonlyArray<{
    readonly token: string | null;
    readonly rotation_replay_response: string | null;
  }>;
};

/** How many access and refresh tokens an account holds for one client. */
const countClientTokens = async (userId: string, clientId: string) => {
  const result = await testDatabase!.pool.query(
    `select (select count(*)::int from auth.oauth_access_token
              where user_id = $1 and client_id = $2)
          + (select count(*)::int from auth.oauth_refresh_token
              where user_id = $1 and client_id = $2) as count`,
    [userId, clientId]
  );
  return result.rows[0]!.count as number;
};

/** The encrypted refresh replay responses still stored for an account. */
const storedReplays = async (userId: string) =>
  (await storedTokenMaterial(userId)).flatMap(
    ({ rotation_replay_response }) => rotation_replay_response ?? []
  );

/** Runs the daily auth cleanup against the test database as of `now`. */
const runAuthCleanup = (now: Date) =>
  Effect.runPromise(
    Effect.flatMap(AuthCleanupService, (cleanup) =>
      cleanup.deleteExpiredRows({ now })
    ).pipe(
      Effect.provide(
        AuthCleanupService.Default.pipe(
          Layer.provide(
            Layer.succeed(
              WorkspaceDatabase,
              WorkspaceDatabase.of({ db: testDatabase!.db })
            )
          )
        )
      )
    )
  );

const countRows = async (table: string, userId: string) => {
  const result = await testDatabase!.pool.query(
    `select count(*)::int as count from auth.${table} where user_id = $1`,
    [userId]
  );
  return result.rows[0]!.count as number;
};

/**
 * Strips the consent binding from an account's one pending authorization
 * code, as codes issued before the Workspace oauth-provider patch lack it,
 * and dates the account's consent a minute before the code.
 */
const unbindPendingCode = async (userId: string) => {
  const unbound = await testDatabase!.pool.query(
    `update auth.verification
        set value = (value::jsonb - 'consentId')::text
      where case when value like '{"type":%'
                 then value::jsonb ->> 'type' = 'authorization_code'
                  and value::jsonb ->> 'userId' = $1
                  and value::jsonb ->> 'consentId' is not null
                 else false end`,
    [userId]
  );
  expect(unbound.rowCount).toBe(1);
  const dated = await testDatabase!.pool.query(
    `update auth.oauth_consent
        set created_at = created_at - interval '1 minute'
      where user_id = $1`,
    [userId]
  );
  expect(dated.rowCount).toBe(1);
};

/**
 * The test database adapter, with a hook that runs one step of a test just
 * before the plugin's next call of a given kind on a given model. It forces
 * two concurrent requests to interleave at that call.
 */
const makeInterleavingDatabase = () => {
  const base = buildDatabaseAdapter();
  type Call = "findOne" | "create" | "delete" | "deleteMany";
  let next:
    | {
        readonly call: Call;
        readonly model: string;
        readonly step: () => Promise<unknown>;
      }
    | undefined;
  const beforeCall = async (call: Call, model: string) => {
    if (next?.call !== call || next.model !== model) return;
    const { step } = next;
    next = undefined;
    await step();
  };
  return {
    database: (options: Parameters<typeof base>[0]) => {
      const adapter = base(options);
      const findOne = async (input: Parameters<typeof adapter.findOne>[0]) => {
        await beforeCall("findOne", input.model);
        return adapter.findOne(input);
      };
      const create = async (input: Parameters<typeof adapter.create>[0]) => {
        await beforeCall("create", input.model);
        return adapter.create(input);
      };
      const remove = async (input: Parameters<typeof adapter.delete>[0]) => {
        await beforeCall("delete", input.model);
        return adapter.delete(input);
      };
      const removeMany = async (
        input: Parameters<typeof adapter.deleteMany>[0]
      ) => {
        await beforeCall("deleteMany", input.model);
        return adapter.deleteMany(input);
      };
      return {
        ...adapter,
        findOne: findOne as typeof adapter.findOne,
        create: create as typeof adapter.create,
        delete: remove as typeof adapter.delete,
        deleteMany: removeMany as typeof adapter.deleteMany,
      };
    },
    /** Runs `step` before the next `call` on `model`, which then goes on. */
    before: (call: Call, model: string, step: () => Promise<unknown>) => {
      next = { call, model, step };
    },
  };
};

/**
 * Walks one agent connection from the first authorization request to the
 * consent page: the connect step signs the customer in and resumes the
 * request at the authorization endpoint.
 */
const connectToConsent = async (
  auth: TestAuth,
  sentLinks: CapturedMagicLink[],
  authorization: AuthorizationRequest
) => {
  const signInResponse = await request(auth, authorizePath(authorization));
  const signInLocation = signInResponse.headers.get("location");
  const signInPage = redirectOf(signInResponse);
  const signInStep = resolveCustomerAgentConnectStep({
    connectPath: CONNECT_PATH,
    query: signInPage.searchParams,
    signedIn: false,
  });
  if (signInStep.step !== "sign-in") throw new Error(signInStep.step);

  const customer = await signIn(auth, sentLinks);
  const returned = new URL(signInStep.returnTo, ORIGIN);
  const resumeStep = resolveCustomerAgentConnectStep({
    connectPath: CONNECT_PATH,
    query: returned.searchParams,
    signedIn: true,
  });
  if (resumeStep.step !== "authorize") throw new Error(resumeStep.step);
  const consentResponse = await request(
    auth,
    handlerPath(resumeStep.location),
    {
      cookie: customer.cookie,
    }
  );
  const consentLocation = consentResponse.headers.get("location");
  const consentPage = redirectOf(consentResponse);
  return {
    signInLocation,
    signInPage,
    signInStep,
    returned,
    resumeStep,
    consentLocation,
    consentPage,
    customer,
  };
};

describe.skipIf(!testDatabase)(
  "Customer agent OAuth flow on the migrated disposable Postgres",
  () => {
    test("connects an agent from sign-in through consent to a token the adapter accepts", async () => {
      const agent = makeAgent();
      const sentLinks: CapturedMagicLink[] = [];
      const auth = makeTestAuth({
        sentLinks,
        clientMetadataTransport: agent.clientMetadataTransport,
      });
      const pkce = await makePkce();
      const state = crypto.randomUUID();
      const authorization = {
        clientId: agent.clientId,
        redirectUri: agent.redirectUri,
        challenge: pkce.challenge,
        state,
        scope: AGENT_SCOPE,
      };

      // a. Signed out, the server sends the customer to the sign-in step
      // with the request it signed.
      const {
        signInLocation,
        signInPage,
        signInStep,
        returned,
        resumeStep,
        consentLocation,
        consentPage,
        customer,
      } = await connectToConsent(auth, sentLinks, authorization);
      // Root-relative, so the proxy places the step on the customer's locale.
      expect(signInLocation?.startsWith("/auth/connect?")).toBe(true);
      expect(signInPage.pathname).toBe("/auth/connect");
      expect(signInPage.searchParams.get("client_id")).toBe(agent.clientId);
      expect(signInPage.searchParams.get("state")).toBe(state);
      expect(signInPage.searchParams.get("scope")).toBe(AGENT_SCOPE);
      expect(signInPage.searchParams.get("resource")).toBe(RESOURCE);
      expect(signInPage.searchParams.get("sig")).toBeTruthy();
      expect(signInPage.searchParams.get("exp")).toBeTruthy();
      expect(agent.metadataRequests).toContain(agent.clientId);

      // b. The connect step signs the customer in, comes back marked as
      // signed in, and resumes the unsigned request at the authorization
      // endpoint, which now continues to consent.
      expect(returned.pathname).toBe(CONNECT_PATH);
      expect(returned.searchParams.get("signed_in")).toBe("1");
      expect(returned.searchParams.has("sig")).toBe(false);
      expect(signInStep.step).toBe("sign-in");
      const resumed = new URL(resumeStep.location, ORIGIN);
      expect(resumed.pathname).toBe(customerAgentAuthorizePath);
      expect(resumed.searchParams.has("signed_in")).toBe(false);
      expect(resumed.searchParams.get("code_challenge")).toBe(pkce.challenge);
      expect(consentLocation?.startsWith("/auth/consent?")).toBe(true);
      expect(consentPage.searchParams.get("client_id")).toBe(agent.clientId);
      expect(consentPage.searchParams.get("scope")).toBe(AGENT_SCOPE);
      expect(consentPage.searchParams.get("sig")).toBeTruthy();

      // h. The consent page names the agent from its metadata document.
      const client = await findClient(
        auth,
        agent.clientId,
        new Headers({ cookie: customer.cookie, host: HOST })
      );
      expect(client._tag === "Success" && client.success).toEqual(
        Option.some({
          clientId: agent.clientId as never,
          name: CLIENT_NAME,
          host: "client.example",
        })
      );
      // A read the server can't serve is unavailable, not an unknown agent.
      const unresolved = await findClient(
        auth,
        agent.clientId,
        new Headers({ cookie: customer.cookie })
      );
      expect(unresolved._tag === "Failure" && unresolved.failure.reason).toBe(
        "unavailable"
      );
      // The server names the same agent without a customer session, as for
      // a request that carries only the agent's access token.
      expect(await findClientOnServer(auth, agent.clientId)).toEqual(
        Option.some({
          clientId: agent.clientId as never,
          name: CLIENT_NAME,
          host: "client.example",
        })
      );
      expect(
        await findClientOnServer(auth, "https://unknown.example/client.json")
      ).toEqual(Option.none());

      // d. Accepting returns the agent to its redirect URI with a code.
      const callback = await answerConsent(
        auth,
        customer.cookie,
        consentPage,
        true
      );
      expect(`${callback.origin}${callback.pathname}`).toBe(agent.redirectUri);
      expect(callback.searchParams.get("state")).toBe(state);
      const code = callback.searchParams.get("code");
      expect(code).toBeTruthy();

      // e. The code and its verifier buy an opaque access token and, with
      // offline_access, a refresh token.
      const tokenResponse = await exchangeCode(auth, {
        clientId: agent.clientId,
        redirectUri: agent.redirectUri,
        code: code!,
        verifier: pkce.verifier,
      });
      expect(tokenResponse.status).toBe(200);
      const tokens = (await tokenResponse.json()) as TokenResponse;
      expect(tokens.token_type.toLowerCase()).toBe("bearer");
      expect(tokens.access_token.split(".")).toHaveLength(1);
      expect(tokens.refresh_token).toBeTruthy();
      expect(tokens.scope?.split(" ").sort()).toEqual(
        AGENT_SCOPE.split(" ").sort()
      );

      // f. The server-only check reports the token's subject, client, and
      // audience.
      const claims = (await auth.api.verifyCustomerAgentAccessToken({
        body: { token: tokens.access_token },
        headers: new Headers({ host: HOST }),
      })) as {
        readonly active: boolean;
        readonly aud?: string | ReadonlyArray<string>;
        readonly sub?: string;
        readonly client_id?: string;
      };
      expect(claims.active).toBe(true);
      expect([claims.aud].flat()).toContain(RESOURCE);
      expect(claims.sub).toBe(customer.accountId);
      expect(claims.client_id).toBe(agent.clientId);

      // g. The account adapter turns the token into the customer's grant
      // and session.
      const granted = await authorizeToken(
        authorityOver(auth),
        tokens.access_token
      );
      expect(granted._tag).toBe("Success");
      if (granted._tag === "Success") {
        expect(granted.success.grant.accountId).toBe(
          customer.accountId as CustomerAccountId
        );
        expect(granted.success.grant.clientId).toBe(agent.clientId as never);
        expect([...granted.success.grant.scopes].sort()).toEqual([
          "offerings:read",
          "reservations:create",
          "reservations:read",
        ]);
        expect(granted.success.session.accountId).toBe(
          customer.accountId as CustomerAccountId
        );
        expect(granted.success.session.deletionRequested).toBe(false);
      }
      expect(
        await failureReasonOf(
          authorityOver(auth, "https://elsewhere.example/api/mcp"),
          tokens.access_token
        )
      ).toBe("invalid-token");
      expect(
        await failureReasonOf(authorityOver(auth), "not-a-known-token")
      ).toBe("invalid-token");

      // e. The refresh token renews access without the customer.
      const refreshed = await requestToken(auth, {
        grant_type: "refresh_token",
        client_id: agent.clientId,
        refresh_token: tokens.refresh_token!,
        resource: RESOURCE,
      });
      expect(refreshed.status).toBe(200);
      const renewed = (await refreshed.json()) as TokenResponse;
      expect(renewed.access_token).not.toBe(tokens.access_token);
      expect(
        (await authorizeToken(authorityOver(auth), renewed.access_token))._tag
      ).toBe("Success");

      // Only token digests are persisted: each stored token is the SHA-256
      // of one issued. The rotated refresh token keeps the response that
      // replaced it for the reuse window, encrypted, never in plain text.
      const stored = await storedTokenMaterial(customer.accountId);
      expect(stored.map(({ token }) => token).sort()).toEqual(
        [
          tokens.access_token,
          tokens.refresh_token!,
          renewed.access_token,
          renewed.refresh_token!,
        ]
          .map(tokenDigest)
          .sort()
      );
      const replays = await storedReplays(customer.accountId);
      expect(replays).toHaveLength(1);
      expect(() => JSON.parse(replays[0]!)).toThrow();
      for (const token of [
        tokens.access_token,
        tokens.refresh_token!,
        renewed.access_token,
        renewed.refresh_token!,
      ]) {
        expect(replays[0]).not.toContain(token);
      }

      // Once the reuse window has passed, the daily cleanup clears the
      // encrypted copy and keeps the rotated token for reuse detection.
      await runAuthCleanup(
        new Date(
          Date.now() + (customerAgentRefreshTokenReuseSeconds + 1) * 1000
        )
      );
      expect(await storedReplays(customer.accountId)).toEqual([]);
      expect(await countRows("oauth_refresh_token", customer.accountId)).toBe(
        2
      );

      // The code is single use, and replaying it revokes the access it
      // bought.
      const replayed = await exchangeCode(auth, {
        clientId: agent.clientId,
        redirectUri: agent.redirectUri,
        code: code!,
        verifier: pkce.verifier,
      });
      expect(replayed.status).toBe(400);
      expect(
        await failureReasonOf(authorityOver(auth), tokens.access_token)
      ).toBe("invalid-token");
    });

    test("answers a repeated refresh inside the reuse window, and ends the assistant's tokens on reuse after it", async () => {
      const agent = makeAgent();
      const sentLinks: CapturedMagicLink[] = [];
      const auth = makeTestAuth({
        sentLinks,
        clientMetadataTransport: agent.clientMetadataTransport,
      });
      const customer = await signIn(auth, sentLinks);
      const tokens = await connectSignedIn(auth, customer.cookie, agent);
      const refresh = (refreshToken: string) =>
        requestToken(auth, {
          grant_type: "refresh_token",
          client_id: agent.clientId,
          refresh_token: refreshToken,
          resource: RESOURCE,
        });
      const refreshed = await refresh(tokens.refresh_token!);
      expect(refreshed.status).toBe(200);
      const renewed = (await refreshed.json()) as TokenResponse;

      const refreshedAt = Date.now();

      // Inside the window, a refresh retried after a lost response gets the
      // same tokens, with `expires_in` counted down, and the grant stays.
      setSystemTime(new Date(refreshedAt + 10_000));
      try {
        const repeated = await refresh(tokens.refresh_token!);
        expect(repeated.status).toBe(200);
        const replayed = (await repeated.json()) as TokenResponse & {
          readonly expires_at: number;
        };
        const { expires_in: renewedExpiresIn, ...renewedTokens } = renewed;
        const { expires_in: replayedExpiresIn, ...replayedTokens } = replayed;
        expect(replayedTokens).toEqual(renewedTokens);
        expect(replayedExpiresIn).toBe(
          replayed.expires_at - Math.floor((refreshedAt + 10_000) / 1000)
        );
        expect(replayedExpiresIn).toBeLessThan(renewedExpiresIn);
      } finally {
        setSystemTime();
      }
      expect(
        (await authorizeToken(authorityOver(auth), renewed.access_token))._tag
      ).toBe("Success");
      expect(await countRows("oauth_refresh_token", customer.accountId)).toBe(
        2
      );
      expect(await storedReplays(customer.accountId)).toHaveLength(1);

      // Reusing the rotated token after the window, before any cleanup has
      // cleared its copy, ends the client's tokens for this customer.
      setSystemTime(
        new Date(
          refreshedAt + (customerAgentRefreshTokenReuseSeconds + 1) * 1000
        )
      );
      try {
        const reused = await refresh(tokens.refresh_token!);
        expect(reused.status).toBe(400);
        expect(((await reused.json()) as { error: string }).error).toBe(
          "invalid_grant"
        );
        expect((await refresh(renewed.refresh_token!)).status).toBe(400);
        expect(
          await failureReasonOf(authorityOver(auth), renewed.access_token)
        ).toBe("invalid-token");
        expect(await countRows("oauth_refresh_token", customer.accountId)).toBe(
          0
        );
        expect(await countRows("oauth_access_token", customer.accountId)).toBe(
          0
        );
      } finally {
        setSystemTime();
      }
    });

    test("refuses a code exchanged for another resource", async () => {
      const agent = makeAgent();
      const sentLinks: CapturedMagicLink[] = [];
      const auth = makeTestAuth({
        sentLinks,
        clientMetadataTransport: agent.clientMetadataTransport,
      });
      const pkce = await makePkce();
      const { consentPage, customer } = await connectToConsent(
        auth,
        sentLinks,
        {
          clientId: agent.clientId,
          redirectUri: agent.redirectUri,
          challenge: pkce.challenge,
          state: crypto.randomUUID(),
          scope: AGENT_SCOPE,
        }
      );
      const callback = await answerConsent(
        auth,
        customer.cookie,
        consentPage,
        true
      );

      const foreign = await exchangeCode(auth, {
        clientId: agent.clientId,
        redirectUri: agent.redirectUri,
        code: callback.searchParams.get("code")!,
        verifier: pkce.verifier,
        resource: "https://elsewhere.example/api/mcp",
      });

      expect(foreign.status).toBe(400);
      expect(((await foreign.json()) as { error: string }).error).toBe(
        "invalid_target"
      );
    });

    test("asks a signed-in customer to sign in again for prompt=login, and resumes after it", async () => {
      const agent = makeAgent();
      const sentLinks: CapturedMagicLink[] = [];
      const auth = makeTestAuth({
        sentLinks,
        clientMetadataTransport: agent.clientMetadataTransport,
      });
      const pkce = await makePkce();
      const customer = await signIn(auth, sentLinks);

      const signInPage = redirectOf(
        await request(
          auth,
          authorizePath({
            clientId: agent.clientId,
            redirectUri: agent.redirectUri,
            challenge: pkce.challenge,
            state: crypto.randomUUID(),
            scope: AGENT_SCOPE,
            prompt: "login",
          }),
          { cookie: customer.cookie }
        )
      );
      expect(signInPage.pathname).toBe("/auth/connect");
      expect(signInPage.searchParams.get("prompt")).toBe("login");

      // Already signed in, the connect step still asks for a fresh sign-in.
      const signInStep = resolveCustomerAgentConnectStep({
        connectPath: CONNECT_PATH,
        query: signInPage.searchParams,
        signedIn: true,
      });
      expect(signInStep.step).toBe("sign-in");
      if (signInStep.step !== "sign-in") return;

      // Back from signing in, the request runs without the prompt and
      // reaches consent instead of the sign-in step again.
      const fresh = await signIn(auth, sentLinks);
      const resumeStep = resolveCustomerAgentConnectStep({
        connectPath: CONNECT_PATH,
        query: new URL(signInStep.returnTo, ORIGIN).searchParams,
        signedIn: true,
      });
      expect(resumeStep.step).toBe("authorize");
      if (resumeStep.step !== "authorize") return;
      expect(
        new URL(resumeStep.location, ORIGIN).searchParams.has("prompt")
      ).toBe(false);
      const consentPage = redirectOf(
        await request(auth, handlerPath(resumeStep.location), {
          cookie: fresh.cookie,
        })
      );
      expect(consentPage.pathname).toBe("/auth/consent");
    });

    test("returns access_denied to the agent when the customer declines", async () => {
      const agent = makeAgent();
      const sentLinks: CapturedMagicLink[] = [];
      const auth = makeTestAuth({
        sentLinks,
        clientMetadataTransport: agent.clientMetadataTransport,
      });
      const pkce = await makePkce();
      const state = crypto.randomUUID();
      const { consentPage, customer } = await connectToConsent(
        auth,
        sentLinks,
        {
          clientId: agent.clientId,
          redirectUri: agent.redirectUri,
          challenge: pkce.challenge,
          state,
          scope: AGENT_SCOPE,
        }
      );

      const callback = await answerConsent(
        auth,
        customer.cookie,
        consentPage,
        false
      );

      expect(`${callback.origin}${callback.pathname}`).toBe(agent.redirectUri);
      expect(callback.searchParams.get("error")).toBe("access_denied");
      expect(callback.searchParams.get("state")).toBe(state);
      expect(callback.searchParams.has("code")).toBe(false);
      expect(await countRows("oauth_consent", customer.accountId)).toBe(0);
    });

    test("hands the consent page the scopes it grants when the agent names none", async () => {
      const agent = makeAgent();
      const sentLinks: CapturedMagicLink[] = [];
      const auth = makeTestAuth({
        sentLinks,
        clientMetadataTransport: agent.clientMetadataTransport,
      });
      const pkce = await makePkce();
      const { signInPage, consentPage } = await connectToConsent(
        auth,
        sentLinks,
        {
          clientId: agent.clientId,
          redirectUri: agent.redirectUri,
          challenge: pkce.challenge,
          state: crypto.randomUUID(),
        }
      );

      // The server fills in the client's default scopes before it signs the
      // request, so the consent page always reads them from `scope`.
      expect(signInPage.searchParams.get("scope")).toBe(ALL_SCOPES);
      expect(consentPage.searchParams.get("scope")).toBe(ALL_SCOPES);
    });

    test("completes the flow for a pre-registered public client", async () => {
      const sentLinks: CapturedMagicLink[] = [];
      const auth = makeTestAuth({ sentLinks });
      const administrator = await signIn(auth, sentLinks);
      const redirectUri = `https://preregistered.example/${crypto.randomUUID()}/callback`;
      const registered = (await auth.api.adminCreateOAuthClient({
        headers: new Headers({ cookie: administrator.cookie, host: HOST }),
        body: {
          client_name: "Pre-registered Agent",
          redirect_uris: [redirectUri],
          token_endpoint_auth_method: "none",
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
        },
      })) as { client_id: string; client_secret?: string };
      expect(registered.client_id).toBeTruthy();
      expect(registered.client_secret).toBeUndefined();

      const pkce = await makePkce();
      const state = crypto.randomUUID();
      const { consentPage, customer } = await connectToConsent(
        auth,
        sentLinks,
        {
          clientId: registered.client_id,
          redirectUri,
          challenge: pkce.challenge,
          state,
          scope: AGENT_SCOPE,
        }
      );
      const callback = await answerConsent(
        auth,
        customer.cookie,
        consentPage,
        true
      );
      const tokenResponse = await exchangeCode(auth, {
        clientId: registered.client_id,
        redirectUri,
        code: callback.searchParams.get("code")!,
        verifier: pkce.verifier,
      });
      expect(tokenResponse.status).toBe(200);
      const tokens = (await tokenResponse.json()) as TokenResponse;

      const granted = await authorizeToken(
        authorityOver(auth),
        tokens.access_token
      );
      expect(granted._tag).toBe("Success");
      if (granted._tag === "Success") {
        expect(granted.success.grant.clientId).toBe(
          registered.client_id as never
        );
        expect(granted.success.grant.accountId).toBe(
          customer.accountId as CustomerAccountId
        );
      }
    });

    // Guards the Workspace oauth-provider patch (better-auth#11056): upstream
    // consent deletion leaves the tokens valid.
    test("disconnects one assistant: its tokens stop working and other grants keep theirs", async () => {
      const agent = makeAgent();
      const other = makeAgent("Other Agent");
      const sentLinks: CapturedMagicLink[] = [];
      const auth = makeTestAuth({
        sentLinks,
        clientMetadataTransport: serveAgents(agent, other),
      });
      const customer = await signIn(auth, sentLinks);
      const neighbour = await signIn(auth, sentLinks);
      const disconnecting = await connectSignedIn(auth, customer.cookie, agent);
      const staying = await connectSignedIn(auth, customer.cookie, other);
      const neighbours = await connectSignedIn(auth, neighbour.cookie, agent);
      const refresh = (refreshToken: string) =>
        requestToken(auth, {
          grant_type: "refresh_token",
          client_id: agent.clientId,
          refresh_token: refreshToken,
          resource: RESOURCE,
        });

      // A refresh just before disconnecting leaves a replay copy on the
      // rotated token for the reuse window.
      const rotated = await refresh(disconnecting.refresh_token!);
      expect(rotated.status).toBe(200);
      const renewed = (await rotated.json()) as TokenResponse;
      expect(await storedReplays(customer.accountId)).toHaveLength(1);

      // The account page lists both assistants, named from their metadata
      // and with the scopes the consent page explained.
      const listed = await listConnections(auth, customer.cookie);
      expect(
        listed.map(({ name, host, scopes }) => ({ name, host, scopes }))
      ).toEqual([
        {
          name: CLIENT_NAME,
          host: "client.example",
          scopes: [
            "offerings:read",
            "reservations:read",
            "reservations:create",
            "offline_access",
          ],
        },
        {
          name: "Other Agent",
          host: "client.example",
          scopes: [
            "offerings:read",
            "reservations:read",
            "reservations:create",
            "offline_access",
          ],
        },
      ]);
      const connection = listed.find(({ name }) => name === CLIENT_NAME)!;
      expect(Date.parse(connection.connectedAt)).not.toBeNaN();

      // Another customer can't disconnect it.
      const foreign = await request(auth, "/oauth2/delete-consent", {
        method: "POST",
        cookie: neighbour.cookie,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: connection.id }),
      });
      expect(foreign.status).toBe(401);

      const disconnected = await request(auth, "/oauth2/delete-consent", {
        method: "POST",
        cookie: customer.cookie,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: connection.id }),
      });
      expect(disconnected.status).toBe(200);

      // The disconnected assistant's next MCP call is refused, and it can't
      // refresh its way back in, not even by repeating the refresh inside
      // the reuse window.
      for (const accessToken of [
        disconnecting.access_token,
        renewed.access_token,
      ]) {
        expect(await failureReasonOf(authorityOver(auth), accessToken)).toBe(
          "invalid-token"
        );
      }
      expect((await refresh(disconnecting.refresh_token!)).status).toBe(400);
      expect((await refresh(renewed.refresh_token!)).status).toBe(400);
      expect(await storedReplays(customer.accountId)).toEqual([]);

      // The customer's other assistant and the neighbour's grant to the same
      // assistant keep working.
      expect(
        (await authorizeToken(authorityOver(auth), staying.access_token))._tag
      ).toBe("Success");
      expect(
        (await authorizeToken(authorityOver(auth), neighbours.access_token))
          ._tag
      ).toBe("Success");
      expect(
        (await listConnections(auth, customer.cookie)).map(({ name }) => name)
      ).toEqual(["Other Agent"]);
      expect(
        (await listConnections(auth, neighbour.cookie)).map(({ name }) => name)
      ).toEqual([CLIENT_NAME]);

      // Connecting again asks the customer for consent again.
      const pkce = await makePkce();
      const reconnect = redirectOf(
        await request(
          auth,
          authorizePath({
            clientId: agent.clientId,
            redirectUri: agent.redirectUri,
            challenge: pkce.challenge,
            state: crypto.randomUUID(),
            scope: AGENT_SCOPE,
          }),
          { cookie: customer.cookie }
        )
      );
      expect(reconnect.pathname).toBe("/auth/consent");
    });

    // Guards the Workspace oauth-provider patch (better-auth#11318): upstream
    // consent deletion leaves codes already issued under it redeemable.
    test("disconnects one assistant: its codes from before the disconnect no longer exchange, other codes do", async () => {
      const agent = makeAgent();
      const other = makeAgent("Other Agent");
      const sentLinks: CapturedMagicLink[] = [];
      const auth = makeTestAuth({
        sentLinks,
        clientMetadataTransport: serveAgents(agent, other),
      });
      const customer = await signIn(auth, sentLinks);
      const neighbour = await signIn(auth, sentLinks);

      // Codes the assistants hold but haven't exchanged yet: two from the
      // disconnecting assistant, one from the customer's other assistant,
      // and one the neighbour issued to the same assistant.
      const firstPending = await authorizeSignedIn(
        auth,
        customer.cookie,
        agent,
        "asks"
      );
      const secondPending = await authorizeSignedIn(
        auth,
        customer.cookie,
        agent,
        "granted"
      );
      const otherAssistant = await authorizeSignedIn(
        auth,
        customer.cookie,
        other,
        "asks"
      );
      const neighbours = await authorizeSignedIn(
        auth,
        neighbour.cookie,
        agent,
        "asks"
      );

      const connection = (await listConnections(auth, customer.cookie)).find(
        ({ name }) => name === CLIENT_NAME
      )!;
      const disconnected = await request(auth, "/oauth2/delete-consent", {
        method: "POST",
        cookie: customer.cookie,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: connection.id }),
      });
      expect(disconnected.status).toBe(200);

      const refused = await exchangeCode(auth, firstPending);
      expect(refused.status).toBe(400);
      expect(((await refused.json()) as { error: string }).error).toBe(
        "invalid_grant"
      );
      expect(await countClientTokens(customer.accountId, agent.clientId)).toBe(
        0
      );

      // The customer's other assistant and the neighbour's grant to the same
      // assistant still exchange their codes.
      expect((await exchangeCode(auth, otherAssistant)).status).toBe(200);
      expect((await exchangeCode(auth, neighbours)).status).toBe(200);

      // Reconnecting creates a new consent: a code issued under it
      // exchanges, and a code from before the disconnect stays refused.
      const reconnected = await authorizeSignedIn(
        auth,
        customer.cookie,
        agent,
        "asks"
      );
      const stale = await exchangeCode(auth, secondPending);
      expect(stale.status).toBe(400);
      expect(((await stale.json()) as { error: string }).error).toBe(
        "invalid_grant"
      );
      expect(await countClientTokens(customer.accountId, agent.clientId)).toBe(
        0
      );
      expect((await exchangeCode(auth, reconnected)).status).toBe(200);
    });

    // Guards the Workspace oauth-provider patch: a code issued before it
    // carries no consent id, so no consent can vouch for it, even one that
    // still stands.
    test("refuses a code without a consent binding while its consent stands", async () => {
      const agent = makeAgent();
      const sentLinks: CapturedMagicLink[] = [];
      const auth = makeTestAuth({
        sentLinks,
        clientMetadataTransport: agent.clientMetadataTransport,
      });
      const customer = await signIn(auth, sentLinks);
      const unbound = await authorizeSignedIn(
        auth,
        customer.cookie,
        agent,
        "asks"
      );
      await unbindPendingCode(customer.accountId);
      const bound = await authorizeSignedIn(
        auth,
        customer.cookie,
        agent,
        "granted"
      );

      const refused = await exchangeCode(auth, unbound);
      expect(refused.status).toBe(400);
      expect(((await refused.json()) as { error: string }).error).toBe(
        "invalid_grant"
      );
      expect(await countClientTokens(customer.accountId, agent.clientId)).toBe(
        0
      );
      expect(await countRows("oauth_consent", customer.accountId)).toBe(1);

      const tokens = await exchangeCode(auth, bound);
      expect(tokens.status).toBe(200);
      const { access_token } = (await tokens.json()) as TokenResponse;
      expect(await failureReasonOf(authorityOver(auth), access_token)).toBe(
        "Success"
      );
    });

    /**
     * Issues one pending code under a fresh consent, narrows that consent
     * with `narrow`, and expects the code's exchange to be refused while the
     * narrowed consent still stands.
     */
    const expectRefusedAfterNarrowing = async (
      narrow: (accountId: string) => Promise<{ readonly rowCount: unknown }>
    ) => {
      const agent = makeAgent();
      const sentLinks: CapturedMagicLink[] = [];
      const auth = makeTestAuth({
        sentLinks,
        clientMetadataTransport: agent.clientMetadataTransport,
      });
      const customer = await signIn(auth, sentLinks);
      const pending = await authorizeSignedIn(
        auth,
        customer.cookie,
        agent,
        "asks"
      );
      expect((await narrow(customer.accountId)).rowCount).toBe(1);

      const refused = await exchangeCode(auth, pending);
      expect(refused.status).toBe(400);
      expect(((await refused.json()) as { error: string }).error).toBe(
        "invalid_grant"
      );
      expect(await countClientTokens(customer.accountId, agent.clientId)).toBe(
        0
      );
      expect(await countRows("oauth_consent", customer.accountId)).toBe(1);
    };

    // Guards the Workspace oauth-provider patch: the consent row a code is
    // bound to can stand while it stops covering what the code was issued
    // for, so only the coverage check keeps the code from redeeming.
    test("refuses a code whose consent no longer grants one of its scopes", () =>
      expectRefusedAfterNarrowing((accountId) =>
        testDatabase!.pool.query(
          `update auth.oauth_consent
              set scopes = array_remove(scopes, $2)
            where user_id = $1 and $2 = any(scopes)`,
          [accountId, "reservations:create"]
        )
      ));

    test("refuses a code whose consent no longer covers its resource", () =>
      expectRefusedAfterNarrowing((accountId) =>
        testDatabase!.pool.query(
          `update auth.oauth_consent
              set resources = array_remove(resources, $2)
            where user_id = $1 and $2 = any(resources)`,
          [accountId, RESOURCE]
        )
      ));

    /**
     * Connects one assistant through an adapter that lets a test interleave
     * its refresh or code exchange with its disconnect.
     */
    const connectForRace = async () => {
      const agent = makeAgent();
      const sentLinks: CapturedMagicLink[] = [];
      const interleaving = makeInterleavingDatabase();
      const auth = makeTestAuth({
        sentLinks,
        clientMetadataTransport: agent.clientMetadataTransport,
        database: interleaving.database,
        createCustomerAccount: realCreateCustomerAccount,
      });
      const customer = await signIn(auth, sentLinks);
      const tokens = await connectSignedIn(auth, customer.cookie, agent);
      const [connection] = await listConnections(auth, customer.cookie);
      const refresh = (
        refreshToken: string,
        form: Record<string, string> = {}
      ) =>
        requestToken(auth, {
          grant_type: "refresh_token",
          client_id: agent.clientId,
          refresh_token: refreshToken,
          resource: RESOURCE,
          ...form,
        });
      const disconnect = (id = connection!.id) =>
        request(auth, "/oauth2/delete-consent", {
          method: "POST",
          cookie: customer.cookie,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id }),
        });
      /** Connects the assistant again. */
      const reconnect = () => connectSignedIn(auth, customer.cookie, agent);
      /**
       * None is left stored, and no issued token works any more. The rows
       * are counted first, since a refresh attempt could delete leftovers.
       */
      const expectRevoked = async (issued: readonly TokenResponse[]) => {
        for (const table of [
          "oauth_access_token",
          "oauth_refresh_token",
          "oauth_consent",
        ]) {
          expect(await countRows(table, customer.accountId)).toBe(0);
        }
        for (const { access_token, refresh_token } of issued) {
          expect(await failureReasonOf(authorityOver(auth), access_token)).toBe(
            "invalid-token"
          );
          expect((await refresh(refresh_token!)).status).toBe(400);
        }
      };
      const authorize = () =>
        authorizeSignedIn(auth, customer.cookie, agent, "granted");
      const exchange = (code: Awaited<ReturnType<typeof authorize>>) =>
        exchangeCode(auth, code);
      return {
        interleaving,
        agent,
        tokens,
        refresh,
        authorize,
        exchange,
        disconnect,
        reconnect,
        expectRevoked,
        auth,
        cookie: customer.cookie,
        accountId: customer.accountId,
      };
    };

    /**
     * Interleaves a refresh with a disconnect the way review found a token
     * that outlived its consent: the refresh writes its tokens while the
     * disconnect is about to delete the consent, and a token delete that the
     * disconnect makes after deleting the consent fails. The disconnect makes
     * no such delete now, and its answer isn't checked, so the test still
     * reaches the revived token if one comes back. Answers the refresh's
     * tokens once both requests are done.
     */
    const refreshDuringDisconnect = async (
      race: Awaited<ReturnType<typeof connectForRace>>,
      refreshToken: string,
      consentId?: string
    ) => {
      let rotated: Promise<Response> | undefined;
      let disconnected: Promise<Response> | undefined;
      race.interleaving.before(
        "create",
        "oauthRefreshToken",
        () =>
          new Promise<void>((resume) => {
            race.interleaving.before("deleteMany", "oauthConsent", async () => {
              resume();
              await rotated;
              race.interleaving.before(
                "deleteMany",
                "oauthAccessToken",
                async () => {
                  throw new Error("Injected token delete failure");
                }
              );
            });
            disconnected = race.disconnect(consentId);
          })
      );

      rotated = race.refresh(refreshToken);
      const response = await rotated;
      expect(response.status).toBe(200);
      await disconnected;
      expect(await countRows("oauth_consent", race.accountId)).toBe(0);
      return (await response.json()) as TokenResponse;
    };

    // Guards the Workspace oauth-provider patch: a refresh token references
    // its consent, so a rotation that a disconnect overtakes can't write its
    // tokens and answers invalid_grant.
    test("refuses a refresh that a disconnect overtakes mid-rotation", async () => {
      const race = await connectForRace();
      race.interleaving.before("create", "oauthRefreshToken", async () => {
        expect((await race.disconnect()).status).toBe(200);
      });

      const rotated = await race.refresh(race.tokens.refresh_token!);
      expect(rotated.status).toBe(400);
      expect(((await rotated.json()) as { error: string }).error).toBe(
        "invalid_grant"
      );
      await race.expectRevoked([race.tokens]);
    });

    // Guards the Workspace oauth-provider patch: the tokens a refresh writes
    // reference the consent, so the disconnect's consent delete takes them
    // along even when the refresh finishes first.
    test("revokes the tokens of a refresh that finishes while a disconnect is under way", async () => {
      const race = await connectForRace();
      let rotated: Promise<Response> | undefined;
      let disconnected: Promise<Response> | undefined;
      race.interleaving.before(
        "create",
        "oauthRefreshToken",
        () =>
          new Promise<void>((resume) => {
            race.interleaving.before("deleteMany", "oauthConsent", async () => {
              resume();
              await rotated;
            });
            disconnected = race.disconnect();
          })
      );

      rotated = race.refresh(race.tokens.refresh_token!);
      const response = await rotated;
      expect(response.status).toBe(200);
      expect((await disconnected!).status).toBe(200);
      await race.expectRevoked([
        race.tokens,
        (await response.json()) as TokenResponse,
      ]);
    });

    // Guards the Workspace oauth-provider patch: a disconnect that lands
    // after a code exchange checked the code's consent but before it wrote
    // the tokens leaves them no consent to reference, so none are written.
    test("refuses a code exchange that a disconnect overtakes before its tokens are written", async () => {
      const race = await connectForRace();
      const pending = await race.authorize();
      race.interleaving.before("create", "oauthRefreshToken", async () => {
        expect((await race.disconnect()).status).toBe(200);
      });

      const exchanged = await race.exchange(pending);
      expect(exchanged.status).toBe(400);
      expect(((await exchanged.json()) as { error: string }).error).toBe(
        "invalid_grant"
      );
      await race.expectRevoked([race.tokens]);
    });

    // Guards the Workspace oauth-provider patch: the consent delete is the
    // whole disconnect, so one that fails leaves the assistant connected and
    // a retry revokes its tokens.
    test("keeps the assistant connected when a disconnect fails, and a retry revokes its tokens", async () => {
      const race = await connectForRace();
      race.interleaving.before("deleteMany", "oauthConsent", async () => {
        throw new Error("Injected consent delete failure");
      });

      expect((await race.disconnect()).status).toBe(500);
      expect(await listConnections(race.auth, race.cookie)).toHaveLength(1);
      expect(
        (
          await authorizeToken(
            authorityOver(race.auth),
            race.tokens.access_token
          )
        )._tag
      ).toBe("Success");
      expect((await race.disconnect()).status).toBe(200);
      await race.expectRevoked([race.tokens]);
    });

    // Guards the Workspace oauth-provider patch: only the consent a token
    // references keeps it working, so connecting the assistant again in the
    // same second doesn't bring back a token written during the disconnect.
    test("keeps the tokens of a refresh that raced a disconnect revoked when the assistant connects again in the same second", async () => {
      setSystemTime(new Date());
      try {
        const race = await connectForRace();
        const renewed = await refreshDuringDisconnect(
          race,
          race.tokens.refresh_token!
        );
        const reconnected = await race.reconnect();

        expect(
          await failureReasonOf(authorityOver(race.auth), renewed.access_token)
        ).toBe("invalid-token");
        expect((await race.refresh(renewed.refresh_token!)).status).toBe(400);
        expect(
          (
            await authorizeToken(
              authorityOver(race.auth),
              reconnected.access_token
            )
          )._tag
        ).toBe("Success");
        expect(await countRows("oauth_access_token", race.accountId)).toBe(1);
        expect(await countRows("oauth_refresh_token", race.accountId)).toBe(1);
      } finally {
        setSystemTime();
      }
    });

    // Guards the Workspace oauth-provider patch: a consent the customer
    // approved before a disconnect can be recorded after it, dated before
    // it. Tokens reference their own consent, so that one doesn't bring back
    // the tokens the disconnect revoked.
    test("keeps revoked tokens revoked when a consent approved before the disconnect is recorded after it", async () => {
      setSystemTime(new Date());
      try {
        const race = await connectForRace();
        expect((await race.disconnect()).status).toBe(200);
        const first = await requestConsent(race.auth, race.cookie, race.agent);
        const second = await requestConsent(race.auth, race.cookie, race.agent);
        let revoked: TokenResponse[] = [];
        // The second approval finds no consent and stalls before recording
        // its own, while the first one connects the assistant, refreshes,
        // and is disconnected.
        race.interleaving.before("create", "oauthConsent", async () => {
          const connected = await allowConsent(
            race.auth,
            race.cookie,
            race.agent,
            first
          );
          const [connection] = await listConnections(race.auth, race.cookie);
          const renewed = await refreshDuringDisconnect(
            race,
            connected.refresh_token!,
            connection!.id
          );
          revoked = [connected, renewed];
        });

        const reconnected = await allowConsent(
          race.auth,
          race.cookie,
          race.agent,
          second
        );

        expect(revoked).toHaveLength(2);
        for (const { access_token, refresh_token } of revoked) {
          expect(
            await failureReasonOf(authorityOver(race.auth), access_token)
          ).toBe("invalid-token");
          expect((await race.refresh(refresh_token!)).status).toBe(400);
        }
        expect(
          (
            await authorizeToken(
              authorityOver(race.auth),
              reconnected.access_token
            )
          )._tag
        ).toBe("Success");
        expect(await countRows("oauth_access_token", race.accountId)).toBe(1);
        expect(await countRows("oauth_refresh_token", race.accountId)).toBe(1);
      } finally {
        setSystemTime();
      }
    });

    // Guards the Workspace oauth-provider patch: a rotation carries its
    // refresh token's consent, so one that a disconnect and a new connection
    // overtake fails instead of joining the new connection.
    test("refuses a refresh that a disconnect and a new connection overtake mid-rotation", async () => {
      const race = await connectForRace();
      let reconnected: TokenResponse | undefined;
      race.interleaving.before("create", "oauthRefreshToken", async () => {
        expect((await race.disconnect()).status).toBe(200);
        reconnected = await race.reconnect();
      });

      const rotated = await race.refresh(race.tokens.refresh_token!);
      expect(rotated.status).toBe(400);
      expect(((await rotated.json()) as { error: string }).error).toBe(
        "invalid_grant"
      );
      expect(
        await failureReasonOf(
          authorityOver(race.auth),
          race.tokens.access_token
        )
      ).toBe("invalid-token");
      expect(
        (
          await authorizeToken(
            authorityOver(race.auth),
            reconnected!.access_token
          )
        )._tag
      ).toBe("Success");
      expect(await countRows("oauth_access_token", race.accountId)).toBe(1);
      expect(await countRows("oauth_refresh_token", race.accountId)).toBe(1);
    });

    // Guards the Workspace oauth-provider patch: every token a refresh
    // writes carries the consent, also when it issues no new refresh token
    // because it no longer asks for offline access.
    test("refuses a refresh without offline access that a disconnect and a new connection overtake", async () => {
      const race = await connectForRace();
      const narrowedResponse = await race.refresh(race.tokens.refresh_token!, {
        scope: "offerings:read reservations:read reservations:create",
      });
      expect(narrowedResponse.status).toBe(200);
      const narrowed = (await narrowedResponse.json()) as TokenResponse;
      let reconnected: TokenResponse | undefined;
      race.interleaving.before("findOne", "user", async () => {
        expect((await race.disconnect()).status).toBe(200);
        reconnected = await race.reconnect();
      });

      const refreshed = await race.refresh(narrowed.refresh_token!);
      expect(refreshed.status).toBe(400);
      expect(((await refreshed.json()) as { error: string }).error).toBe(
        "invalid_grant"
      );
      expect(
        (
          await authorizeToken(
            authorityOver(race.auth),
            reconnected!.access_token
          )
        )._tag
      ).toBe("Success");
      expect(await countRows("oauth_access_token", race.accountId)).toBe(1);
      expect(await countRows("oauth_refresh_token", race.accountId)).toBe(1);
    });

    // Guards the Workspace oauth-provider patch: tokens are bought with the
    // consent of their code, so a code redeemed after its assistant was
    // disconnected buys none.
    test("refuses a code redeemed after the assistant was disconnected", async () => {
      const race = await connectForRace();
      const pending = await race.authorize();
      expect((await race.disconnect()).status).toBe(200);

      const exchanged = await race.exchange(pending);
      expect(exchanged.status).toBe(400);
      expect(((await exchanged.json()) as { error: string }).error).toBe(
        "invalid_grant"
      );
      await race.expectRevoked([race.tokens]);
    });

    // Guards the Workspace oauth-provider patch: a token that references no
    // consent predates the binding, so it no longer works, not even inside
    // the refresh reuse window, and presenting it deletes it.
    test("refuses and deletes tokens that reference no consent", async () => {
      const race = await connectForRace();
      const rotated = await race.refresh(race.tokens.refresh_token!);
      expect(rotated.status).toBe(200);
      const renewed = (await rotated.json()) as TokenResponse;
      for (const table of ["oauth_access_token", "oauth_refresh_token"]) {
        await testDatabase!.pool.query(
          `update auth.${table} set consent_id = null where user_id = $1`,
          [race.accountId]
        );
      }

      expect(
        await failureReasonOf(authorityOver(race.auth), renewed.access_token)
      ).toBe("invalid-token");
      expect(await countRows("oauth_access_token", race.accountId)).toBe(1);
      const replayed = await race.refresh(race.tokens.refresh_token!);
      expect(replayed.status).toBe(400);
      expect(((await replayed.json()) as { error: string }).error).toBe(
        "invalid_grant"
      );
      expect(await countRows("oauth_access_token", race.accountId)).toBe(0);
      expect(await countRows("oauth_refresh_token", race.accountId)).toBe(1);
      expect((await race.refresh(renewed.refresh_token!)).status).toBe(400);
      expect(await countRows("oauth_refresh_token", race.accountId)).toBe(0);
      expect(await listConnections(race.auth, race.cookie)).toHaveLength(1);
    });

    // Guards the Workspace oauth-provider patch: a disconnect deletes every
    // consent of the assistant, so a duplicate written by a concurrent consent
    // doesn't keep it connected.
    test("disconnects an assistant whose consent was recorded twice", async () => {
      const race = await connectForRace();
      await testDatabase!.pool.query(
        `insert into auth.oauth_consent
           (id, client_id, user_id, reference_id, resources,
            requested_user_info_claims, scopes, created_at, updated_at)
         select $2, client_id, user_id, reference_id, resources,
           requested_user_info_claims, scopes, created_at, updated_at
         from auth.oauth_consent where user_id = $1`,
        [race.accountId, crypto.randomUUID()]
      );
      expect(await countRows("oauth_consent", race.accountId)).toBe(2);

      expect((await race.disconnect()).status).toBe(200);
      await race.expectRevoked([race.tokens]);
    });

    test("deletes a connected account with its grants, and its tokens stop authorizing", async () => {
      const agent = makeAgent();
      const sentLinks: CapturedMagicLink[] = [];
      const auth = makeTestAuth({
        sentLinks,
        clientMetadataTransport: agent.clientMetadataTransport,
      });
      const pkce = await makePkce();
      const { consentPage, customer } = await connectToConsent(
        auth,
        sentLinks,
        {
          clientId: agent.clientId,
          redirectUri: agent.redirectUri,
          challenge: pkce.challenge,
          state: crypto.randomUUID(),
          scope: AGENT_SCOPE,
        }
      );
      const callback = await answerConsent(
        auth,
        customer.cookie,
        consentPage,
        true
      );
      const tokens = (await (
        await exchangeCode(auth, {
          clientId: agent.clientId,
          redirectUri: agent.redirectUri,
          code: callback.searchParams.get("code")!,
          verifier: pkce.verifier,
        })
      ).json()) as TokenResponse;
      // A refresh leaves an encrypted replay response on the rotated token.
      const refreshed = await requestToken(auth, {
        grant_type: "refresh_token",
        client_id: agent.clientId,
        refresh_token: tokens.refresh_token!,
        resource: RESOURCE,
      });
      expect(refreshed.status).toBe(200);
      const renewed = (await refreshed.json()) as TokenResponse;
      expect(
        (await authorizeToken(authorityOver(auth), renewed.access_token))._tag
      ).toBe("Success");
      expect(await storedReplays(customer.accountId)).toHaveLength(1);
      expect(await countRows("oauth_consent", customer.accountId)).toBe(1);
      expect(
        await countRows("oauth_access_token", customer.accountId)
      ).toBeGreaterThan(0);
      expect(
        await countRows("oauth_refresh_token", customer.accountId)
      ).toBeGreaterThan(0);

      const deleted = await request(auth, "/delete-user", {
        method: "POST",
        cookie: customer.cookie,
        headers: { "content-type": "application/json" },
        body: "{}",
      });

      expect(deleted.status).toBe(200);
      expect(await userExists(customer.accountId)).toBe(false);
      expect(await countRows("oauth_consent", customer.accountId)).toBe(0);
      expect(await countRows("oauth_access_token", customer.accountId)).toBe(0);
      expect(await countRows("oauth_refresh_token", customer.accountId)).toBe(
        0
      );
      expect(await storedReplays(customer.accountId)).toEqual([]);
      expect(
        await failureReasonOf(authorityOver(auth), renewed.access_token)
      ).toBe("invalid-token");
    });

    test("registers the preview E2E's test agent from its published metadata document", async () => {
      const {
        client_id: testAgentId,
        redirect_uris: [testAgentRedirectUri],
      } = customerAgentTestClientMetadata;
      const metadataRequests: string[] = [];
      const sentLinks: CapturedMagicLink[] = [];
      // Answered as the site's route serves the document, so it meets the
      // same content-type, size, and registration checks as in a deployment.
      const auth = makeTestAuth({
        sentLinks,
        clientMetadataTransport: async (input: RequestInfo | URL) => {
          const url = input instanceof Request ? input.url : String(input);
          metadataRequests.push(url);
          return url === testAgentId
            ? Response.json(customerAgentTestClientMetadata, {
                headers: { "cache-control": "public, max-age=60" },
              })
            : new Response("not found", { status: 404 });
        },
      });
      const pkce = await makePkce();

      const { consentPage, customer } = await connectToConsent(
        auth,
        sentLinks,
        {
          clientId: testAgentId,
          redirectUri: testAgentRedirectUri,
          challenge: pkce.challenge,
          state: crypto.randomUUID(),
          scope: "reservations:read reservations:create offline_access",
        }
      );

      expect(metadataRequests).toContain(testAgentId);
      expect(consentPage.pathname).toBe("/auth/consent");
      const client = await findClient(
        auth,
        testAgentId,
        new Headers({ cookie: customer.cookie, host: HOST })
      );
      expect(client._tag === "Success" && client.success).toEqual(
        Option.some({
          clientId: testAgentId as never,
          name: customerAgentTestClientMetadata.client_name,
          host: "workspace.deskohub.cz",
        })
      );
    });
  }
);

/** Serves published documents by URL, in place of their hosts. */
const serveDocuments = (documents: Readonly<Record<string, Schema.Json>>) => {
  const requests: string[] = [];
  const transport = async (input: RequestInfo | URL) => {
    const url = input instanceof Request ? input.url : String(input);
    requests.push(url);
    const document = documents[url];
    return document
      ? Response.json(document, { headers: { "cache-control": "max-age=300" } })
      : new Response("not found", { status: 404 });
  };
  return { requests, transport };
};

const base64UrlJson = (value: Schema.JsonObject) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");

/**
 * An RS256 key pair standing in for ChatGPT's: its public JWKS, as the
 * client's `jwks_uri` serves it, and `private_key_jwt` client assertions
 * signed with it for the token endpoint.
 */
const makeClientSigningKey = async () => {
  const kid = crypto.randomUUID();
  const { publicKey, privateKey } = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"]
  );
  const { kty, n, e } = await crypto.subtle.exportKey("jwk", publicKey);
  const assertion = async (clientId: string) => {
    const now = Math.floor(Date.now() / 1000);
    const signingInput = `${base64UrlJson({ alg: "RS256", typ: "JWT", kid })}.${base64UrlJson(
      {
        iss: clientId,
        sub: clientId,
        aud: `${AUTH_BASE}/oauth2/token`,
        iat: now,
        exp: now + 60,
        jti: crypto.randomUUID(),
      }
    )}`;
    const signature = await crypto.subtle.sign(
      "RSASSA-PKCS1-v1_5",
      privateKey,
      new TextEncoder().encode(signingInput)
    );
    return `${signingInput}.${Buffer.from(signature).toString("base64url")}`;
  };
  return {
    jwks: { keys: [{ kty, n, e, kid, use: "sig", alg: "RS256" }] },
    assertion,
  };
};

/** An app-directory client as it signs a customer in. */
type DirectoryClient = {
  readonly clientId: string;
  readonly clientName: string;
  /** The host the consent page names the client by. */
  readonly host: string;
  /** The redirect URI the client sends with this authorization. */
  readonly redirectUri: string;
  /** Adds the client's token-endpoint authentication to a token request. */
  readonly authenticate: (
    form: Record<string, string>
  ) => Promise<Record<string, string>>;
};

/**
 * ChatGPT (its stable client and a per-connector one), Claude's apps, and
 * Claude Code on a loopback port of each host it names, with their
 * documents served as their hosts publish them.
 */
const makeDirectoryClients = async () => {
  const signingKey = await makeClientSigningKey();
  const chatGptCallbackClient = chatGptCallbackClientMetadata(
    crypto.randomUUID()
  );
  const loopbackPort = 49_152 + Math.floor(Math.random() * 16_000);
  const signed =
    (clientId: string): DirectoryClient["authenticate"] =>
    async (form) => ({
      ...form,
      client_assertion_type:
        "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
      client_assertion: await signingKey.assertion(clientId),
    });
  const unauthenticated: DirectoryClient["authenticate"] = async (form) => form;
  const clients = {
    ChatGPT: {
      clientId: chatGptClientMetadata.client_id,
      clientName: chatGptClientMetadata.client_name,
      host: "chatgpt.com",
      redirectUri: chatGptClientMetadata.redirect_uris[0],
      authenticate: signed(chatGptClientMetadata.client_id),
    },
    "ChatGPT's per-connector client": {
      clientId: chatGptCallbackClient.client_id,
      clientName: chatGptCallbackClient.client_name,
      host: "chatgpt.com",
      redirectUri: chatGptCallbackClient.redirect_uris[0],
      authenticate: signed(chatGptCallbackClient.client_id),
    },
    Claude: {
      clientId: claudeClientMetadata.client_id,
      clientName: claudeClientMetadata.client_name,
      host: "claude.ai",
      redirectUri: claudeClientMetadata.redirect_uris[0],
      authenticate: unauthenticated,
    },
    "Claude Code on localhost": {
      clientId: claudeCodeClientMetadata.client_id,
      clientName: claudeCodeClientMetadata.client_name,
      host: "claude.ai",
      redirectUri: `http://localhost:${loopbackPort}/callback`,
      authenticate: unauthenticated,
    },
    "Claude Code on 127.0.0.1": {
      clientId: claudeCodeClientMetadata.client_id,
      clientName: claudeCodeClientMetadata.client_name,
      host: "claude.ai",
      redirectUri: `http://127.0.0.1:${loopbackPort}/callback`,
      authenticate: unauthenticated,
    },
  } satisfies Record<string, DirectoryClient>;
  const documents = serveDocuments({
    [chatGptClientMetadata.client_id]: chatGptClientMetadata,
    [chatGptCallbackClient.client_id]: chatGptCallbackClient,
    [chatGptClientMetadata.jwks_uri]: signingKey.jwks,
    [claudeClientMetadata.client_id]: claudeClientMetadata,
    [claudeCodeClientMetadata.client_id]: claudeCodeClientMetadata,
  });
  return { clients, documents };
};

type DirectoryClientName = keyof Awaited<
  ReturnType<typeof makeDirectoryClients>
>["clients"];

const directoryClientNames: ReadonlyArray<DirectoryClientName> = [
  "ChatGPT",
  "ChatGPT's per-connector client",
  "Claude",
  "Claude Code on localhost",
  "Claude Code on 127.0.0.1",
];

/** The issuer the authorization-server metadata advertises. */
const discoveredIssuer = async (auth: TestAuth) => {
  const response = await auth.handler(
    new Request(`${ORIGIN}/.well-known/oauth-authorization-server/api/auth`)
  );
  expect(response.status).toBe(200);
  const metadata = (await response.json()) as {
    readonly issuer: string;
    readonly authorization_response_iss_parameter_supported?: boolean;
  };
  expect(metadata.authorization_response_iss_parameter_supported).toBe(true);
  return metadata.issuer;
};

/** The authorization response at a client's redirect URI. */
const expectAuthorizationResponse = (
  response: URL,
  client: DirectoryClient,
  { state, issuer }: { readonly state: string; readonly issuer: string }
) => {
  expect(`${response.origin}${response.pathname}`).toBe(client.redirectUri);
  expect(response.searchParams.get("state")).toBe(state);
  // RFC 9207: every response names the issuer, so the client can tell it
  // came from the server it started the request with.
  expect(response.searchParams.get("iss")).toBe(issuer);
};

describe.skipIf(!testDatabase)(
  "App-directory clients on the migrated disposable Postgres",
  () => {
    test.each(directoryClientNames)(
      "signs a customer in through %s from its published metadata document",
      async (name) => {
        const { clients, documents } = await makeDirectoryClients();
        const client: DirectoryClient = clients[name];
        const sentLinks: CapturedMagicLink[] = [];
        const auth = makeTestAuth({
          sentLinks,
          clientMetadataTransport: documents.transport,
        });
        const issuer = await discoveredIssuer(auth);
        const pkce = await makePkce();
        const state = crypto.randomUUID();

        const { consentPage, customer } = await connectToConsent(
          auth,
          sentLinks,
          {
            clientId: client.clientId,
            redirectUri: client.redirectUri,
            challenge: pkce.challenge,
            state,
            scope: AGENT_SCOPE,
          }
        );
        expect(documents.requests).toContain(client.clientId);
        expect(consentPage.pathname).toBe("/auth/consent");

        // The consent page names the client and the host it publishes from.
        const listed = await findClient(
          auth,
          client.clientId,
          new Headers({ cookie: customer.cookie, host: HOST })
        );
        expect(listed._tag === "Success" && listed.success).toEqual(
          Option.some({
            clientId: client.clientId as never,
            name: client.clientName,
            host: client.host,
          })
        );

        const callback = await answerConsent(
          auth,
          customer.cookie,
          consentPage,
          true
        );
        expectAuthorizationResponse(callback, client, { state, issuer });
        const code = callback.searchParams.get("code");
        expect(code).toBeTruthy();

        const tokenResponse = await requestToken(
          auth,
          await client.authenticate({
            grant_type: "authorization_code",
            client_id: client.clientId,
            code: code!,
            code_verifier: pkce.verifier,
            redirect_uri: client.redirectUri,
            resource: RESOURCE,
          })
        );
        expect(tokenResponse.status).toBe(200);
        const tokens = (await tokenResponse.json()) as TokenResponse;
        expect(tokens.refresh_token).toBeTruthy();

        // The requested resource, the MCP server, is the token's audience.
        const claims = (await auth.api.verifyCustomerAgentAccessToken({
          body: { token: tokens.access_token },
          headers: new Headers({ host: HOST }),
        })) as {
          readonly active: boolean;
          readonly aud?: string | ReadonlyArray<string>;
          readonly sub?: string;
          readonly client_id?: string;
        };
        expect(claims.active).toBe(true);
        expect([claims.aud].flat()).toContain(RESOURCE);
        expect(claims.sub).toBe(customer.accountId);
        expect(claims.client_id).toBe(client.clientId);
        expect(
          (await authorizeToken(authorityOver(auth), tokens.access_token))._tag
        ).toBe("Success");

        const refreshed = await requestToken(
          auth,
          await client.authenticate({
            grant_type: "refresh_token",
            client_id: client.clientId,
            refresh_token: tokens.refresh_token!,
            resource: RESOURCE,
          })
        );
        expect(refreshed.status).toBe(200);
        const renewed = (await refreshed.json()) as TokenResponse;
        expect(
          (await authorizeToken(authorityOver(auth), renewed.access_token))._tag
        ).toBe("Success");

        // An expired access token grants nothing, which the MCP route
        // answers with an invalid_token challenge.
        setSystemTime(new Date(Date.now() + (renewed.expires_in + 60) * 1000));
        try {
          expect(
            await failureReasonOf(authorityOver(auth), renewed.access_token)
          ).toBe("invalid-token");
        } finally {
          setSystemTime();
        }
      }
    );

    test.each(directoryClientNames)(
      "sends %s its authorization errors with the issuer",
      async (name) => {
        const { clients, documents } = await makeDirectoryClients();
        const client: DirectoryClient = clients[name];
        const sentLinks: CapturedMagicLink[] = [];
        const auth = makeTestAuth({
          sentLinks,
          clientMetadataTransport: documents.transport,
        });
        const issuer = await discoveredIssuer(auth);
        const { cookie } = await signIn(auth, sentLinks);
        const pkce = await makePkce();
        const authorization = {
          clientId: client.clientId,
          redirectUri: client.redirectUri,
          challenge: pkce.challenge,
        };

        const unknownScopeState = crypto.randomUUID();
        const unknownScope = redirectOf(
          await request(
            auth,
            authorizePath({
              ...authorization,
              state: unknownScopeState,
              scope: "offerings:read payments:write",
            }),
            { cookie }
          )
        );
        expectAuthorizationResponse(unknownScope, client, {
          state: unknownScopeState,
          issuer,
        });
        expect(unknownScope.searchParams.get("error")).toBe("invalid_scope");

        // A resource other than the MCP server gets no code, so a token's
        // audience is always the resource the server serves.
        const otherResourceState = crypto.randomUUID();
        const otherResource = redirectOf(
          await request(
            auth,
            authorizePath({
              ...authorization,
              state: otherResourceState,
              scope: AGENT_SCOPE,
              resource: "https://elsewhere.example/api/mcp",
            }),
            { cookie }
          )
        );
        expectAuthorizationResponse(otherResource, client, {
          state: otherResourceState,
          issuer,
        });
        expect(otherResource.searchParams.get("error")).toBe("invalid_target");

        const declinedState = crypto.randomUUID();
        const consentPage = redirectOf(
          await request(
            auth,
            authorizePath({
              ...authorization,
              state: declinedState,
              scope: AGENT_SCOPE,
            }),
            { cookie }
          )
        );
        expect(consentPage.pathname).toBe("/auth/consent");
        const declined = await answerConsent(auth, cookie, consentPage, false);
        expectAuthorizationResponse(declined, client, {
          state: declinedState,
          issuer,
        });
        expect(declined.searchParams.get("error")).toBe("access_denied");
        expect(declined.searchParams.has("code")).toBe(false);
      }
    );

    test("refuses ChatGPT's code exchange without an assertion signed with its published key", async () => {
      const {
        clients: { ChatGPT: client },
        documents,
      } = await makeDirectoryClients();
      const sentLinks: CapturedMagicLink[] = [];
      const auth = makeTestAuth({
        sentLinks,
        clientMetadataTransport: documents.transport,
      });
      const { cookie } = await signIn(auth, sentLinks);
      /**
       * A new code for ChatGPT, as its token request carries it. The first
       * authorization asks for consent; later ones get a code straight away.
       */
      const authorizeCode = async () => {
        const pkce = await makePkce();
        const redirect = redirectOf(
          await request(
            auth,
            authorizePath({
              clientId: client.clientId,
              redirectUri: client.redirectUri,
              challenge: pkce.challenge,
              state: crypto.randomUUID(),
              scope: AGENT_SCOPE,
            }),
            { cookie }
          )
        );
        const callback =
          redirect.pathname === "/auth/consent"
            ? await answerConsent(auth, cookie, redirect, true)
            : redirect;
        return {
          grant_type: "authorization_code",
          client_id: client.clientId,
          code: callback.searchParams.get("code") ?? "",
          code_verifier: pkce.verifier,
          redirect_uri: client.redirectUri,
          resource: RESOURCE,
        };
      };
      const errorOf = async (response: Response) =>
        ((await response.json()) as { readonly error: string }).error;

      const unsigned = await requestToken(auth, await authorizeCode());
      expect(unsigned.status).toBe(400);
      expect(await errorOf(unsigned)).toBe("invalid_client");

      const otherKey = await makeClientSigningKey();
      const wronglySigned = await requestToken(auth, {
        ...(await authorizeCode()),
        client_assertion_type:
          "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
        client_assertion: await otherKey.assertion(client.clientId),
      });
      expect(wronglySigned.status).toBe(401);
      expect(await errorOf(wronglySigned)).toBe("invalid_client");
      expect(documents.requests).toContain(chatGptClientMetadata.jwks_uri);
    });

    // Only the port of a loopback redirect URI may differ from the one
    // Claude Code registered.
    const unregisteredLoopbackRedirectUris = [
      ["another path", (port: string) => `http://localhost:${port}/other`],
      ["HTTPS", (port: string) => `https://localhost:${port}/callback`],
      [
        "another host",
        (port: string) => `http://localhost.evil.example:${port}/callback`,
      ],
      ["the IPv6 loopback", (port: string) => `http://[::1]:${port}/callback`],
      [
        "a query",
        (port: string) => `http://127.0.0.1:${port}/callback?next=evil`,
      ],
      [
        "credentials",
        (port: string) => `http://user:pass@localhost:${port}/callback`,
      ],
      [
        "loopback IP credentials",
        (port: string) => `http://user:pass@127.0.0.1:${port}/callback`,
      ],
      [
        "an empty query",
        (port: string) => `http://localhost:${port}/callback?`,
      ],
      ["a fragment", (port: string) => `http://localhost:${port}/callback#x`],
      [
        "an empty fragment",
        (port: string) => `http://localhost:${port}/callback#`,
      ],
    ] as const;

    test.each(unregisteredLoopbackRedirectUris)(
      "never redirects Claude Code to a loopback URI with %s",
      async (_, redirectUriOn) => {
        const {
          clients: { "Claude Code on localhost": client },
          documents,
        } = await makeDirectoryClients();
        const sentLinks: CapturedMagicLink[] = [];
        const auth = makeTestAuth({
          sentLinks,
          clientMetadataTransport: documents.transport,
        });
        const { cookie } = await signIn(auth, sentLinks);
        const redirectUri = redirectUriOn(new URL(client.redirectUri).port);
        const pkce = await makePkce();

        const refused = redirectOf(
          await request(
            auth,
            authorizePath({
              clientId: client.clientId,
              redirectUri,
              challenge: pkce.challenge,
              state: crypto.randomUUID(),
              scope: AGENT_SCOPE,
            }),
            { cookie }
          )
        );

        expect(`${refused.origin}${refused.pathname}`).toBe(
          `${AUTH_BASE}/error`
        );
      }
    );

    // A request object is refused before the request is validated, so the
    // error goes to the requested redirect URI only if Claude Code
    // registered it.
    test.each(unregisteredLoopbackRedirectUris)(
      "never sends Claude Code an authorization error at a loopback URI with %s",
      async (_, redirectUriOn) => {
        const {
          clients: { "Claude Code on localhost": client },
          documents,
        } = await makeDirectoryClients();
        const sentLinks: CapturedMagicLink[] = [];
        const auth = makeTestAuth({
          sentLinks,
          clientMetadataTransport: documents.transport,
        });
        const { cookie } = await signIn(auth, sentLinks);
        const redirectUri = redirectUriOn(new URL(client.redirectUri).port);
        const pkce = await makePkce();
        const authorization = {
          clientId: client.clientId,
          challenge: pkce.challenge,
          state: crypto.randomUUID(),
          scope: AGENT_SCOPE,
        };

        const registered = redirectOf(
          await request(
            auth,
            `${authorizePath({ ...authorization, redirectUri: client.redirectUri })}&request=unsupported`,
            { cookie }
          )
        );
        const registeredUri = new URL(client.redirectUri);
        expect(`${registered.origin}${registered.pathname}`).toBe(
          `${registeredUri.origin}${registeredUri.pathname}`
        );
        expect(registered.searchParams.get("error")).toBe(
          "request_not_supported"
        );

        const refused = redirectOf(
          await request(
            auth,
            `${authorizePath({ ...authorization, redirectUri })}&request=unsupported`,
            { cookie }
          )
        );
        expect(`${refused.origin}${refused.pathname}`).toBe(
          `${AUTH_BASE}/error`
        );
        expect(refused.searchParams.get("error")).toBe("request_not_supported");
      }
    );
  }
);

/** Whether the validated grant behind a token carries administration. */
const grantCarriesAdministration = async (auth: TestAuth, token: string) => {
  const outcome = await authorizeToken(authorityOver(auth), token);
  expect(outcome._tag).toBe("Success");
  return (
    outcome._tag === "Success" &&
    outcome.success.grant.scopes.has("administration")
  );
};

/** Grants the administrator role to a signed-in test account. */
const grantAdministrator = (accountId: string) =>
  testDatabase!.pool.query(
    `insert into account_role_grants (account_id, role) values ($1, 'administrator')`,
    [accountId]
  );

/** Revokes the role as another administrator does from the roster. */
const revokeAdministrator = (accountId: string) =>
  Effect.runPromise(
    Effect.flatMap(AdministratorRoster, (roster) =>
      roster.revoke({
        accountId: customerAccountIdSchema.make(accountId),
        actor: {
          accountId: customerAccountIdSchema.make(crypto.randomUUID()),
          email: uniqueEmail("revoking-administrator"),
        },
      })
    ).pipe(
      Effect.provide(
        AdministratorRoster.Default.pipe(
          Layer.provideMerge(AccountRoleGrants.Default),
          Layer.provide(testDatabase!.layer)
        )
      )
    )
  );

/**
 * Whether an agent's access token may act in the administration now:
 * `administrator`, or why not, as an administration call would decide.
 */
const administrationAccessOf = (auth: TestAuth, accessToken: string) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const grant = yield* (yield* CustomerAgentAuthorization).authorize(
        accessToken
      );
      yield* (yield* AdministratorAgentAuthorization).authorize({
        grant,
        accessToken,
      });
      return "administrator" as const;
    }).pipe(
      Effect.catch((error) => Effect.succeed(error.reason)),
      Effect.provide(
        AdministratorAgentAuthorization.Default.pipe(
          Layer.provideMerge(
            Layer.mergeAll(
              CustomerAgentAuthorization.fromAuthority(authorityOver(auth)),
              AccountRoleGrants.Default.pipe(Layer.provide(testDatabase!.layer))
            )
          )
        )
      )
    )
  );

/** Starts an authorization for `scope`, optionally with `prompt`. */
const authorizeRequest = async (
  auth: TestAuth,
  cookie: string,
  agent: { readonly clientId: string; readonly redirectUri: string },
  { scope, prompt }: { readonly scope?: string; readonly prompt?: string }
) => {
  const pkce = await makePkce();
  const response = await request(
    auth,
    authorizePath({
      clientId: agent.clientId,
      redirectUri: agent.redirectUri,
      challenge: pkce.challenge,
      state: crypto.randomUUID(),
      scope,
      prompt,
    }),
    { cookie }
  );
  return { response, pkce };
};

/**
 * Connects an agent that asks for every scope; the account allows `grant`,
 * by default what the consent page offers a customer.
 */
const connectAskingEverything = async (
  auth: TestAuth,
  cookie: string,
  agent: ReturnType<typeof makeAgent>,
  grant?: string
) => {
  const { response, pkce } = await authorizeRequest(auth, cookie, agent, {
    scope: ALL_SCOPES,
    prompt: "consent",
  });
  const consentPage = redirectOf(response);
  expect(consentPage.pathname).toBe("/auth/consent");
  const exchanged = await exchangeCode(
    auth,
    receivedCode(
      agent,
      await answerConsent(auth, cookie, consentPage, true, grant),
      pkce
    )
  );
  expect(exchanged.status).toBe(200);
  return (await exchanged.json()) as TokenResponse;
};

const refreshWith = (
  auth: TestAuth,
  agent: { readonly clientId: string },
  refreshToken: string
) =>
  requestToken(auth, {
    grant_type: "refresh_token",
    client_id: agent.clientId,
    refresh_token: refreshToken,
    resource: RESOURCE,
  });

describe.skipIf(!testDatabase)(
  "Administration scope on the migrated disposable Postgres",
  () => {
    test("refuses an accepted consent that names no scopes, or administration for a customer", async () => {
      const agent = makeAgent();
      const sentLinks: CapturedMagicLink[] = [];
      const auth = makeTestAuth({
        sentLinks,
        clientMetadataTransport: agent.clientMetadataTransport,
      });
      const customer = await signIn(auth, sentLinks);
      const { response } = await authorizeRequest(
        auth,
        customer.cookie,
        agent,
        { scope: ALL_SCOPES }
      );
      const consentPage = redirectOf(response);

      // Without a scope the provider would grant everything requested.
      expect(
        (
          await postConsent(auth, customer.cookie, consentPage, {
            accept: true,
          })
        ).status
      ).toBe(400);
      for (const scope of [ALL_SCOPES, "administration"]) {
        expect(
          (
            await postConsent(auth, customer.cookie, consentPage, {
              accept: true,
              scope,
            })
          ).status
        ).toBe(403);
      }
      expect(await countRows("oauth_consent", customer.accountId)).toBe(0);
    });

    test("refuses administration to a review account, even one with an administrator grant", async () => {
      const agent = makeAgent();
      const login = {
        email: uniqueEmail("review-administration"),
        password: `review-${crypto.randomUUID()}`,
      };
      const auth = makeTestAuth({
        reviewAccountCredentials: [login],
        clientMetadataTransport: agent.clientMetadataTransport,
      });
      const signedIn = await request(auth, "/sign-in/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...login, callbackURL: "/en-US/auth/callback" }),
      });
      expect(signedIn.status).toBe(200);
      const cookie = cookieJar(getSessionCookie(signedIn)!);
      const accountId = (await userIdForEmail(login.email))!;
      await grantAdministrator(accountId);
      const { response } = await authorizeRequest(auth, cookie, agent, {
        scope: ALL_SCOPES,
      });

      expect(
        (
          await postConsent(auth, cookie, redirectOf(response), {
            accept: true,
            scope: ALL_SCOPES,
          })
        ).status
      ).toBe(403);
      expect(await countRows("oauth_consent", accountId)).toBe(0);
      const tokens = await connectAskingEverything(auth, cookie, agent);
      expect(tokens.scope?.split(" ")).not.toContain("administration");
      expect(await administrationAccessOf(auth, tokens.access_token)).toBe(
        "missing-scope"
      );
    });

    test("connects a customer whose agent asks for every scope with the scopes the customer can grant", async () => {
      const agent = makeAgent();
      const sentLinks: CapturedMagicLink[] = [];
      const auth = makeTestAuth({
        sentLinks,
        clientMetadataTransport: agent.clientMetadataTransport,
      });
      const customer = await signIn(auth, sentLinks);

      const tokens = await connectAskingEverything(
        auth,
        customer.cookie,
        agent
      );

      expect(tokens.scope?.split(" ").toSorted()).toEqual(
        AGENT_SCOPE.split(" ").toSorted()
      );
      expect(await grantCarriesAdministration(auth, tokens.access_token)).toBe(
        false
      );
      expect(await administrationAccessOf(auth, tokens.access_token)).toBe(
        "missing-scope"
      );
      expect(
        (await listConnections(auth, customer.cookie)).map(
          ({ administration }) => administration
        )
      ).toEqual([false]);
    });

    test("grants an administrator the administration scope, and the agent acts as them", async () => {
      const agent = makeAgent();
      const sentLinks: CapturedMagicLink[] = [];
      const auth = makeTestAuth({
        sentLinks,
        clientMetadataTransport: agent.clientMetadataTransport,
      });
      const administrator = await signIn(auth, sentLinks);
      await grantAdministrator(administrator.accountId);

      const tokens = await connectAskingEverything(
        auth,
        administrator.cookie,
        agent,
        ALL_SCOPES
      );

      expect(tokens.scope?.split(" ")).toContain("administration");
      expect(await grantCarriesAdministration(auth, tokens.access_token)).toBe(
        true
      );
      expect(await administrationAccessOf(auth, tokens.access_token)).toBe(
        "administrator"
      );
      expect(
        (await listConnections(auth, administrator.cookie)).map(
          ({ administration }) => administration
        )
      ).toEqual([true]);
    });

    test("revoking the grant ends the administration of earlier consents, tokens, and refreshes", async () => {
      const agent = makeAgent();
      const sentLinks: CapturedMagicLink[] = [];
      const auth = makeTestAuth({
        sentLinks,
        clientMetadataTransport: agent.clientMetadataTransport,
      });
      const administrator = await signIn(auth, sentLinks);
      await grantAdministrator(administrator.accountId);
      const tokens = await connectAskingEverything(
        auth,
        administrator.cookie,
        agent,
        ALL_SCOPES
      );

      await revokeAdministrator(administrator.accountId);

      expect(await countRows("oauth_consent", administrator.accountId)).toBe(0);
      expect(await administrationAccessOf(auth, tokens.access_token)).toBe(
        "invalid-token"
      );
      expect(
        (await refreshWith(auth, agent, tokens.refresh_token!)).status
      ).toBe(400);

      // Without the consent on record, a silent re-authorization can't
      // succeed, and an interactive one asks again.
      const silent = redirectOf(
        (
          await authorizeRequest(auth, administrator.cookie, agent, {
            scope: ALL_SCOPES,
            prompt: "none",
          })
        ).response
      );
      expect(`${silent.origin}${silent.pathname}`).toBe(agent.redirectUri);
      expect(silent.searchParams.get("error")).toBe("consent_required");
      expect(silent.searchParams.has("code")).toBe(false);

      const { response, pkce } = await authorizeRequest(
        auth,
        administrator.cookie,
        agent,
        { scope: ALL_SCOPES }
      );
      const consentPage = redirectOf(response);
      expect(consentPage.pathname).toBe("/auth/consent");
      expect(
        (
          await postConsent(auth, administrator.cookie, consentPage, {
            accept: true,
            scope: ALL_SCOPES,
          })
        ).status
      ).toBe(403);
      const reconnected = await exchangeCode(
        auth,
        receivedCode(
          agent,
          await answerConsent(auth, administrator.cookie, consentPage, true),
          pkce
        )
      );
      expect(reconnected.status).toBe(200);
      const customerTokens = (await reconnected.json()) as TokenResponse;
      expect(customerTokens.scope?.split(" ")).not.toContain("administration");

      // A later re-authorization the customer-only consent covers gets no
      // administration either, with or without prompt=none.
      for (const prompt of ["none", undefined]) {
        const again = await authorizeRequest(
          auth,
          administrator.cookie,
          agent,
          { scope: AGENT_SCOPE, prompt }
        );
        const exchanged = await exchangeCode(
          auth,
          receivedCode(agent, redirectOf(again.response), again.pkce)
        );
        expect(exchanged.status).toBe(200);
        expect(
          ((await exchanged.json()) as TokenResponse).scope?.split(" ")
        ).not.toContain("administration");
      }
    });

    test("an administrator's consent without the administration scope ends the agent's earlier administration tokens", async () => {
      const agent = makeAgent();
      const sentLinks: CapturedMagicLink[] = [];
      const auth = makeTestAuth({
        sentLinks,
        clientMetadataTransport: agent.clientMetadataTransport,
      });
      const administrator = await signIn(auth, sentLinks);
      await grantAdministrator(administrator.accountId);
      const administering = await connectAskingEverything(
        auth,
        administrator.cookie,
        agent,
        ALL_SCOPES
      );

      // Better Auth rewrites the consent in place; the earlier tokens would
      // keep the scopes they were issued with.
      const customerOnly = await connectAskingEverything(
        auth,
        administrator.cookie,
        agent,
        AGENT_SCOPE
      );

      expect(
        (await refreshWith(auth, agent, administering.refresh_token!)).status
      ).toBe(400);
      expect(
        await administrationAccessOf(auth, administering.access_token)
      ).toBe("invalid-token");
      expect(
        (await listConnections(auth, administrator.cookie)).map(
          ({ administration }) => administration
        )
      ).toEqual([false]);
      const refreshed = await refreshWith(
        auth,
        agent,
        customerOnly.refresh_token!
      );
      expect(refreshed.status).toBe(200);
      expect(
        await administrationAccessOf(
          auth,
          ((await refreshed.json()) as TokenResponse).access_token
        )
      ).toBe("missing-scope");
    });

    test("keeps administration tokens when the consent step asks to sign in again before recording the consent", async () => {
      const agent = makeAgent();
      const sentLinks: CapturedMagicLink[] = [];
      const auth = makeTestAuth({
        sentLinks,
        clientMetadataTransport: agent.clientMetadataTransport,
      });
      const administrator = await signIn(auth, sentLinks);
      await grantAdministrator(administrator.accountId);
      const administering = await connectAskingEverything(
        auth,
        administrator.cookie,
        agent,
        ALL_SCOPES
      );
      // A request signed after the session began, asking to sign in again.
      const { response } = await authorizeRequest(
        auth,
        administrator.cookie,
        agent,
        { scope: ALL_SCOPES, prompt: "login consent" }
      );
      const signInPage = redirectOf(response);

      const answered = await postConsent(
        auth,
        administrator.cookie,
        signInPage,
        { accept: true, scope: AGENT_SCOPE }
      );

      expect(answered.status).toBe(200);
      expect(
        (await listConnections(auth, administrator.cookie)).map(
          ({ administration }) => administration
        )
      ).toEqual([true]);
      expect(
        await administrationAccessOf(auth, administering.access_token)
      ).toBe("administrator");
    });

    test("ends administration tokens of a narrowed consent even when the authorization after it fails", async () => {
      const agent = makeAgent();
      const sentLinks: CapturedMagicLink[] = [];
      const auth = makeTestAuth({
        sentLinks,
        clientMetadataTransport: agent.clientMetadataTransport,
      });
      const administrator = await signIn(auth, sentLinks);
      await grantAdministrator(administrator.accountId);
      const administering = await connectAskingEverything(
        auth,
        administrator.cookie,
        agent,
        ALL_SCOPES
      );
      const { response } = await authorizeRequest(
        auth,
        administrator.cookie,
        agent,
        { scope: ALL_SCOPES, prompt: "consent" }
      );
      const consentPage = redirectOf(response);
      // The consent is recorded; the authorization it resumes then fails.
      await testDatabase!.pool.query(
        `update auth.oauth_client set disabled = true where client_id = $1`,
        [agent.clientId]
      );

      await postConsent(auth, administrator.cookie, consentPage, {
        accept: true,
        scope: AGENT_SCOPE,
      });
      // Enabled again, so only the cleanup can refuse the earlier tokens.
      await testDatabase!.pool.query(
        `update auth.oauth_client set disabled = false where client_id = $1`,
        [agent.clientId]
      );

      expect(
        await administrationAccessOf(auth, administering.access_token)
      ).toBe("invalid-token");
      expect(
        (await refreshWith(auth, agent, administering.refresh_token!)).status
      ).toBe(400);
    });

    test("revoking the grant also ends administration tokens whose consent no longer names the scope", async () => {
      const agent = makeAgent();
      const sentLinks: CapturedMagicLink[] = [];
      const auth = makeTestAuth({
        sentLinks,
        clientMetadataTransport: agent.clientMetadataTransport,
      });
      const administrator = await signIn(auth, sentLinks);
      await grantAdministrator(administrator.accountId);
      const administering = await connectAskingEverything(
        auth,
        administrator.cookie,
        agent,
        ALL_SCOPES
      );
      // A consent narrowed without the narrowing cleanup, as before this
      // release.
      await testDatabase!.pool.query(
        `update auth.oauth_consent
            set scopes = array_remove(scopes, 'administration')
          where user_id = $1`,
        [administrator.accountId]
      );

      await revokeAdministrator(administrator.accountId);

      expect(
        (await refreshWith(auth, agent, administering.refresh_token!)).status
      ).toBe(400);
      expect(
        await administrationAccessOf(auth, administering.access_token)
      ).toBe("invalid-token");
      // The customer connection stays.
      expect(await countRows("oauth_consent", administrator.accountId)).toBe(1);
    });

    test("refuses a token refreshed with the administration scope once the grant is gone", async () => {
      const agent = makeAgent();
      const sentLinks: CapturedMagicLink[] = [];
      const auth = makeTestAuth({
        sentLinks,
        clientMetadataTransport: agent.clientMetadataTransport,
      });
      const administrator = await signIn(auth, sentLinks);
      await grantAdministrator(administrator.accountId);
      const tokens = await connectAskingEverything(
        auth,
        administrator.cookie,
        agent,
        ALL_SCOPES
      );

      // The grant goes without the cleanup, as when a consent check that
      // passed just before the revocation records its consent after it.
      await testDatabase!.pool.query(
        `delete from account_role_grants where account_id = $1`,
        [administrator.accountId]
      );
      const refreshed = await refreshWith(auth, agent, tokens.refresh_token!);
      expect(refreshed.status).toBe(200);
      const renewed = (await refreshed.json()) as TokenResponse;

      expect(renewed.scope?.split(" ")).toContain("administration");
      expect(await administrationAccessOf(auth, renewed.access_token)).toBe(
        "not-administrator"
      );
    });

    test.each([
      [
        "awaiting deletion",
        `update auth."user" set deletion_requested_at = now() where id = $1`,
      ],
      [
        "unverified",
        `update auth."user" set email_verified = false where id = $1`,
      ],
    ])(
      "refuses an administrator's agent once the account is %s",
      async (_, update) => {
        const agent = makeAgent();
        const sentLinks: CapturedMagicLink[] = [];
        const auth = makeTestAuth({
          sentLinks,
          clientMetadataTransport: agent.clientMetadataTransport,
        });
        const administrator = await signIn(auth, sentLinks);
        await grantAdministrator(administrator.accountId);
        const tokens = await connectAskingEverything(
          auth,
          administrator.cookie,
          agent,
          ALL_SCOPES
        );

        await testDatabase!.pool.query(update, [administrator.accountId]);

        expect(await administrationAccessOf(auth, tokens.access_token)).toBe(
          "account-unavailable"
        );
      }
    );

    test("refuses a disconnected administrator's agent", async () => {
      const agent = makeAgent();
      const sentLinks: CapturedMagicLink[] = [];
      const auth = makeTestAuth({
        sentLinks,
        clientMetadataTransport: agent.clientMetadataTransport,
      });
      const administrator = await signIn(auth, sentLinks);
      await grantAdministrator(administrator.accountId);
      const tokens = await connectAskingEverything(
        auth,
        administrator.cookie,
        agent,
        ALL_SCOPES
      );
      const [connection] = await listConnections(auth, administrator.cookie);

      const disconnected = await request(auth, "/oauth2/delete-consent", {
        method: "POST",
        cookie: administrator.cookie,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: connection!.id }),
      });
      expect(disconnected.status).toBe(200);

      // An invalid token is what /api/mcp answers with a 401 challenge.
      expect(await administrationAccessOf(auth, tokens.access_token)).toBe(
        "invalid-token"
      );
    });

    test("keeps the consent scopes out of reach of the customer's own requests", async () => {
      const agent = makeAgent();
      const sentLinks: CapturedMagicLink[] = [];
      const auth = makeTestAuth({
        sentLinks,
        clientMetadataTransport: agent.clientMetadataTransport,
      });
      const customer = await signIn(auth, sentLinks);
      await connectAskingEverything(auth, customer.cookie, agent);
      const [connection] = await listConnections(auth, customer.cookie);

      const updated = await request(auth, "/oauth2/update-consent", {
        method: "POST",
        cookie: customer.cookie,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: connection!.id,
          update: { scopes: ALL_SCOPES.split(" ") },
        }),
      });

      expect(updated.status).toBe(404);
      expect(
        (await listConnections(auth, customer.cookie)).map(
          ({ administration }) => administration
        )
      ).toEqual([false]);
    });

    test("never lets a client that skips consent ask for administration", async () => {
      const sentLinks: CapturedMagicLink[] = [];
      const auth = makeTestAuth({ sentLinks });
      const administrator = await signIn(auth, sentLinks);
      await grantAdministrator(administrator.accountId);
      const redirectUri = `https://preregistered.example/${crypto.randomUUID()}/callback`;
      const registered = (await auth.api.adminCreateOAuthClient({
        headers: new Headers({ cookie: administrator.cookie, host: HOST }),
        body: {
          client_name: "First-party Agent",
          redirect_uris: [redirectUri],
          token_endpoint_auth_method: "none",
          grant_types: ["authorization_code", "refresh_token"],
          response_types: ["code"],
          skip_consent: true,
        },
      })) as { client_id: string };
      const client = { clientId: registered.client_id, redirectUri };

      // By name, or through an omitted scope that defaults to every scope.
      for (const scope of [ALL_SCOPES, undefined]) {
        const { response } = await authorizeRequest(
          auth,
          administrator.cookie,
          client,
          { scope }
        );
        expect(response.status).toBe(400);
      }
      // A form-encoded POST authorization too.
      const posted = await request(auth, "/oauth2/authorize", {
        method: "POST",
        cookie: administrator.cookie,
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URL(
          authorizePath({
            clientId: client.clientId,
            redirectUri,
            challenge: (await makePkce()).challenge,
            state: crypto.randomUUID(),
            scope: ALL_SCOPES,
          }),
          ORIGIN
        ).searchParams.toString(),
      });
      expect(posted.status).toBe(400);

      const { response, pkce } = await authorizeRequest(
        auth,
        administrator.cookie,
        client,
        { scope: AGENT_SCOPE }
      );
      const callback = redirectOf(response);
      expect(callback.searchParams.get("code")).toBeTruthy();
      const exchanged = await exchangeCode(auth, {
        ...client,
        code: callback.searchParams.get("code")!,
        verifier: pkce.verifier,
      });
      expect(exchanged.status).toBe(200);
      expect(
        ((await exchanged.json()) as TokenResponse).scope?.split(" ")
      ).not.toContain("administration");
    });

    test("refuses administration when a client starts skipping consent while its consent page is open", async () => {
      const agent = makeAgent();
      const sentLinks: CapturedMagicLink[] = [];
      const auth = makeTestAuth({
        sentLinks,
        clientMetadataTransport: agent.clientMetadataTransport,
      });
      const administrator = await signIn(auth, sentLinks);
      await grantAdministrator(administrator.accountId);
      const { response } = await authorizeRequest(
        auth,
        administrator.cookie,
        agent,
        { scope: ALL_SCOPES }
      );
      const consentPage = redirectOf(response);
      expect(consentPage.pathname).toBe("/auth/consent");
      await testDatabase!.pool.query(
        `update auth.oauth_client set skip_consent = true where client_id = $1`,
        [agent.clientId]
      );

      // The consent step resumes the authorization through the same hooks.
      expect(
        (
          await postConsent(auth, administrator.cookie, consentPage, {
            accept: true,
            scope: ALL_SCOPES,
          })
        ).status
      ).toBe(400);
    });
  }
);
