import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { Effect, Layer, Option } from "effect";
import type { CustomerAccountId } from "../../customer-account";
import {
  customerAgentAuthorizePath,
  resolveCustomerAgentConnectStep,
} from "../../customer-agent-routes";
import {
  type CapturedMagicLink,
  cookieJar,
  getSessionCookie,
  HOST,
  makeTestAuth,
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
import { CustomerAgentClientDirectory } from "./customer-agent-client-directory.service";
import { CustomerAgentConnections } from "./customer-agent-connections.service";

const RESOURCE = `https://${HOST}/api/mcp`;
const ORIGIN = `https://${HOST}`;
const AUTH_BASE = `${ORIGIN}/api/auth`;
const CONNECT_PATH = "/en-US/auth/connect";
const AGENT_SCOPE =
  "offerings:read reservations:read reservations:create offline_access";
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
};

const authorizePath = (authorization: AuthorizationRequest) => {
  const query = new URLSearchParams({
    response_type: "code",
    client_id: authorization.clientId,
    redirect_uri: authorization.redirectUri,
    state: authorization.state,
    code_challenge: authorization.challenge,
    code_challenge_method: "S256",
    resource: RESOURCE,
  });
  if (authorization.scope) query.set("scope", authorization.scope);
  if (authorization.prompt) query.set("prompt", authorization.prompt);
  return `/oauth2/authorize?${query}`;
};

/** Accepts or denies the request the consent page was given. */
const answerConsent = async (
  auth: TestAuth,
  cookie: string,
  consentPage: URL,
  accept: boolean
) => {
  const response = await request(auth, "/oauth2/consent", {
    method: "POST",
    cookie,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      accept,
      oauth_query: consentPage.search.slice(1),
    }),
  });
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
 * Connects an agent for a customer who is already signed in: the request
 * goes straight to consent, the customer allows it, and the agent exchanges
 * its code.
 */
const connectSignedIn = async (
  auth: TestAuth,
  cookie: string,
  agent: ReturnType<typeof makeAgent>
) => {
  const pkce = await makePkce();
  const consentPage = redirectOf(
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
  expect(consentPage.pathname).toBe("/auth/consent");
  const callback = await answerConsent(auth, cookie, consentPage, true);
  const response = await exchangeCode(auth, {
    clientId: agent.clientId,
    redirectUri: agent.redirectUri,
    code: callback.searchParams.get("code")!,
    verifier: pkce.verifier,
  });
  expect(response.status).toBe(200);
  return (await response.json()) as TokenResponse;
};

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

const countRows = async (table: string, userId: string) => {
  const result = await testDatabase!.pool.query(
    `select count(*)::int as count from auth.${table} where user_id = $1`,
    [userId]
  );
  return result.rows[0]!.count as number;
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
      expect(signInPage.searchParams.get("scope")).toBe(AGENT_SCOPE);
      expect(consentPage.searchParams.get("scope")).toBe(AGENT_SCOPE);
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
      // refresh its way back in.
      expect(
        await failureReasonOf(authorityOver(auth), disconnecting.access_token)
      ).toBe("invalid-token");
      const refreshed = await requestToken(auth, {
        grant_type: "refresh_token",
        client_id: agent.clientId,
        refresh_token: disconnecting.refresh_token!,
        resource: RESOURCE,
      });
      expect(refreshed.status).toBe(400);

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
      expect(
        (await authorizeToken(authorityOver(auth), tokens.access_token))._tag
      ).toBe("Success");
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
      expect(
        await failureReasonOf(authorityOver(auth), tokens.access_token)
      ).toBe("invalid-token");
    });
  }
);
