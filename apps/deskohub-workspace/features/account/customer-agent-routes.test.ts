import { describe, expect, test } from "bun:test";
import {
  chatGptClientMetadata,
  claudeClientMetadata,
  claudeCodeClientMetadata,
} from "./backend/auth/customer-agent-directory-clients.test-utils";
import {
  customerAgentConsentScopes,
  readCustomerAgentConsentRequest,
  resolveCustomerAgentConnectStep,
} from "./customer-agent-routes";

const connectPath = "/en-US/auth/connect";
const clientId = "https://assistant.invalid/oauth/client.json";

/** An authorization request as the OAuth server signs it for the sign-in step. */
const signedRequest = (extra: Record<string, string> = {}) => {
  const query = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: "https://assistant.invalid/callback",
    scope: "offerings:read reservations:read",
    state: "synthetic-state",
    code_challenge: "synthetic-challenge",
    code_challenge_method: "S256",
    ...extra,
    exp: "1900000000",
    ba_iat: "1899999400",
  });
  for (const name of [...query.keys(), "ba_param"].sort()) {
    query.append("ba_param", name);
  }
  query.set("sig", "synthetic-signature");
  return query;
};

const signingParams = ["sig", "exp", "ba_iat", "ba_param", "ba_pl"];

const queryOf = (path: string) =>
  new URL(path, "https://site.invalid").searchParams;

describe("resolveCustomerAgentConnectStep", () => {
  test("has nothing to continue without a client", () => {
    expect(
      resolveCustomerAgentConnectStep({
        connectPath,
        query: new URLSearchParams({ sig: "synthetic-signature" }),
        signedIn: true,
      })
    ).toEqual({ step: "unknown-request" });
  });

  test("sends a signed-out customer to sign in and back, marked and unsigned", () => {
    const step = resolveCustomerAgentConnectStep({
      connectPath,
      query: signedRequest(),
      signedIn: false,
    });

    if (step.step !== "sign-in") throw new Error(`Got ${step.step}`);
    expect(step.returnTo.startsWith(`${connectPath}?`)).toBe(true);
    const returnQuery = queryOf(step.returnTo);
    expect(returnQuery.get("signed_in")).toBe("1");
    expect(returnQuery.get("client_id")).toBe(clientId);
    expect(returnQuery.get("state")).toBe("synthetic-state");
    for (const param of signingParams) {
      expect(returnQuery.has(param)).toBe(false);
    }
  });

  test("resumes a signed-in customer's request at the authorization endpoint", () => {
    const step = resolveCustomerAgentConnectStep({
      connectPath,
      query: signedRequest(),
      signedIn: true,
    });

    if (step.step !== "authorize") throw new Error(`Got ${step.step}`);
    expect(step.location.startsWith("/api/auth/oauth2/authorize?")).toBe(true);
    const resumed = queryOf(step.location);
    expect(resumed.get("client_id")).toBe(clientId);
    expect(resumed.get("scope")).toBe("offerings:read reservations:read");
    expect(resumed.get("code_challenge")).toBe("synthetic-challenge");
    for (const param of [...signingParams, "signed_in"]) {
      expect(resumed.has(param)).toBe(false);
    }
  });

  test.each([{ prompt: "login" }, { prompt: "create" }, { max_age: "0" }])(
    "asks a signed-in customer to sign in again for %o",
    (demand) => {
      const step = resolveCustomerAgentConnectStep({
        connectPath,
        query: signedRequest(demand),
        signedIn: true,
      });

      if (step.step !== "sign-in") throw new Error(`Got ${step.step}`);
      expect(queryOf(step.returnTo).get("signed_in")).toBe("1");
    }
  );

  test("counts a fresh sign-in as the requested one and keeps other prompts", () => {
    const step = resolveCustomerAgentConnectStep({
      connectPath,
      query: new URLSearchParams({
        client_id: clientId,
        prompt: "login consent",
        max_age: "0",
        signed_in: "1",
      }),
      signedIn: true,
    });

    if (step.step !== "authorize") throw new Error(`Got ${step.step}`);
    const resumed = queryOf(step.location);
    expect(resumed.get("prompt")).toBe("consent");
    expect(resumed.has("max_age")).toBe(false);
    expect(resumed.has("signed_in")).toBe(false);
  });

  test("drops a fully satisfied prompt", () => {
    const step = resolveCustomerAgentConnectStep({
      connectPath,
      query: new URLSearchParams({
        client_id: clientId,
        prompt: "create",
        signed_in: "1",
      }),
      signedIn: true,
    });

    if (step.step !== "authorize") throw new Error(`Got ${step.step}`);
    expect(queryOf(step.location).has("prompt")).toBe(false);
  });

  test("ignores the marker while signed out", () => {
    const step = resolveCustomerAgentConnectStep({
      connectPath,
      query: new URLSearchParams({ client_id: clientId, signed_in: "1" }),
      signedIn: false,
    });

    expect(step.step).toBe("sign-in");
  });
});

describe("readCustomerAgentConsentRequest", () => {
  const now = 1_899_999_500_000;

  test("reads the client and the requested scopes in listing order", () => {
    expect(
      readCustomerAgentConsentRequest(
        signedRequest({
          scope: "offline_access reservations:create offerings:read",
        }),
        now
      )
    ).toEqual({
      status: "pending",
      clientId,
      scopes: ["offerings:read", "reservations:create", "offline_access"],
      redirect: { host: "assistant.invalid", local: false },
      administration: false,
    });
  });

  test.each([
    {
      client: chatGptClientMetadata,
      redirectUri: chatGptClientMetadata.redirect_uris[0],
      redirect: { host: "chatgpt.com", local: false },
    },
    {
      client: claudeClientMetadata,
      redirectUri: claudeClientMetadata.redirect_uris[0],
      redirect: { host: "claude.ai", local: false },
    },
    {
      client: claudeCodeClientMetadata,
      redirectUri: "http://localhost:53122/callback",
      redirect: { host: "localhost", local: true },
    },
    {
      client: claudeCodeClientMetadata,
      redirectUri: "http://127.0.0.1:53122/callback",
      redirect: { host: "127.0.0.1", local: true },
    },
  ] as const)(
    "names $redirect.host as where $client.client_name sends the answer",
    ({ client, redirectUri, redirect }) => {
      expect(
        readCustomerAgentConsentRequest(
          signedRequest({
            client_id: client.client_id,
            redirect_uri: redirectUri,
          }),
          now
        )
      ).toMatchObject({ status: "pending", redirect });
    }
  );

  test.each([
    ["http://[::1]:8080/callback", "[::1]"],
    ["https://app.localhost/callback", "app.localhost"],
    ["com.example.assistant:/oauth/callback", "com.example.assistant"],
  ])("marks %s as staying on the device", (redirectUri, host) => {
    expect(
      readCustomerAgentConsentRequest(
        signedRequest({ redirect_uri: redirectUri }),
        now
      )
    ).toMatchObject({ redirect: { host, local: true } });
  });

  test("shows a look-alike of localhost as the remote host it is", () => {
    expect(
      readCustomerAgentConsentRequest(
        signedRequest({
          redirect_uri: "https://localhost.attacker.example/callback",
        }),
        now
      )
    ).toMatchObject({
      redirect: { host: "localhost.attacker.example", local: false },
    });
  });

  test("reads a request for the administration scope apart from the rest", () => {
    expect(
      readCustomerAgentConsentRequest(
        signedRequest({ scope: "administration reservations:read" }),
        now
      )
    ).toMatchObject({ scopes: ["reservations:read"], administration: true });
  });

  test("leaves out scopes it can't explain", () => {
    const request = readCustomerAgentConsentRequest(
      signedRequest({ scope: "openid reservations:read profile" }),
      now
    );

    expect(request).toMatchObject({ scopes: ["reservations:read"] });
  });

  test("lists every scope when the request names none", () => {
    const query = signedRequest();
    query.delete("scope");

    expect(readCustomerAgentConsentRequest(query, now)).toMatchObject({
      scopes: customerAgentConsentScopes,
      administration: true,
    });
    expect(customerAgentConsentScopes).toEqual([
      "offerings:read",
      "reservations:read",
      "reservations:create",
      "offline_access",
    ]);
  });

  test.each(["client_id", "sig", "exp", "redirect_uri"])(
    "is unknown without %s",
    (param) => {
      const query = signedRequest();
      query.delete(param);

      expect(readCustomerAgentConsentRequest(query, now)).toEqual({
        status: "unknown-request",
      });
    }
  );

  test("is unknown with an unreadable redirect URI", () => {
    const query = signedRequest();
    query.set("redirect_uri", "/callback");

    expect(readCustomerAgentConsentRequest(query, now)).toEqual({
      status: "unknown-request",
    });
  });

  test("is unknown with an unreadable expiry", () => {
    const query = signedRequest();
    query.set("exp", "soon");

    expect(readCustomerAgentConsentRequest(query, now)).toEqual({
      status: "unknown-request",
    });
  });

  test("has expired once its expiry passes", () => {
    expect(
      readCustomerAgentConsentRequest(signedRequest(), 1_900_000_000_000)
    ).toEqual({ status: "expired" });
  });
});
