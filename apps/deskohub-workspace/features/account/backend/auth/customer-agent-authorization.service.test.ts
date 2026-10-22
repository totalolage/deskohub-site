import { describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import type { User } from "better-auth";
import { Effect, Option } from "effect";
import type { CustomerAccountId } from "../../customer-account";
import { CustomerAuthentication } from "../customer-authentication.service";
import {
  type CustomerAgentAuthority,
  CustomerAgentAuthorization,
  customerAuthenticationForAgent,
  isProviderRejection,
  readAgentAccessToken,
} from "./customer-agent-authorization.service";

const RESOURCE = "https://workspace.test/api/mcp";
const CLIENT_ID = "https://client.example/agent.json";
const ACCOUNT_ID = "account-1";
const TOKEN = "agent-access-token";
const customerEmail = testEmailAddress("agent-customer");

/** The Workspace columns on the identity row beyond Better Auth's own. */
type UserRowFields = Partial<User> & {
  readonly deletionRequestedAt?: Date | null;
  readonly locale?: string | null;
};

const userRow = (fields: UserRowFields = {}) =>
  ({
    id: ACCOUNT_ID,
    name: "",
    email: customerEmail,
    emailVerified: true,
    image: null,
    createdAt: new Date("2026-10-01T00:00:00Z"),
    updatedAt: new Date("2026-10-01T00:00:00Z"),
    ...fields,
  }) as User;

/** Introspection claims as the provider reports them. */
type AccessTokenClaims = {
  readonly active?: boolean;
  readonly sub?: string | undefined;
  readonly client_id?: string | undefined;
  readonly scope?: string | undefined;
  readonly aud?: string | ReadonlyArray<string> | undefined;
};

const activeClaims = (claims: AccessTokenClaims = {}) => ({
  active: true,
  sub: ACCOUNT_ID,
  client_id: CLIENT_ID,
  scope: "reservations:read reservations:create",
  aud: RESOURCE,
  ...claims,
});

/** An error shaped like Better Auth's rejection of a token it doesn't know. */
const providerRejection = () =>
  Object.assign(new Error("invalid access token"), { name: "APIError" });

/** An error shaped like Better Auth's API error with an HTTP status. */
const providerError = (statusCode: number) =>
  Object.assign(new Error("provider error"), { name: "APIError", statusCode });

const authorityWith = (
  overrides: Partial<CustomerAgentAuthority> = {}
): CustomerAgentAuthority => ({
  resource: RESOURCE,
  validateAccessToken: async () => activeClaims(),
  findUser: async () => userRow(),
  ...overrides,
});

const authorize = (authority: CustomerAgentAuthority, token = TOKEN) =>
  Effect.runPromise(
    Effect.flatMap(CustomerAgentAuthorization, (authorization) =>
      authorization.authorize(token)
    ).pipe(
      Effect.provide(CustomerAgentAuthorization.fromAuthority(authority)),
      Effect.result
    )
  );

const currentUser = (authority: CustomerAgentAuthority) =>
  Effect.runPromise(
    Effect.flatMap(CustomerAgentAuthorization, (authorization) =>
      authorization.currentUser(TOKEN)
    ).pipe(
      Effect.provide(CustomerAgentAuthorization.fromAuthority(authority)),
      Effect.result
    )
  );

const failureReason = async (authority: CustomerAgentAuthority) => {
  const outcome = await authorize(authority);
  return outcome._tag === "Failure" ? outcome.failure.reason : "granted";
};

describe("CustomerAgentAuthorization.authorize", () => {
  test("grants the token's account, client, and known scopes", async () => {
    const validated: string[] = [];
    const looked: string[] = [];
    const outcome = await authorize(
      authorityWith({
        validateAccessToken: async (token) => {
          validated.push(token);
          return activeClaims({
            scope:
              "offerings:read reservations:read reservations:create offline_access openid unknown:scope",
          });
        },
        findUser: async (accountId) => {
          looked.push(accountId);
          return userRow();
        },
      })
    );

    expect(outcome._tag).toBe("Success");
    if (outcome._tag !== "Success") return;
    expect(outcome.success.accountId).toBe(ACCOUNT_ID as CustomerAccountId);
    expect(outcome.success.clientId).toBe(CLIENT_ID as never);
    expect([...outcome.success.scopes].sort()).toEqual([
      "offerings:read",
      "reservations:create",
      "reservations:read",
    ]);
    expect(validated).toEqual([TOKEN]);
    expect(looked).toEqual([ACCOUNT_ID]);
  });

  test.each([
    ["keeps administration on a token that carries it", true],
    ["grants no administration to a token without it", false],
  ])("%s", async (_, administration) => {
    const outcome = await authorize(
      authorityWith({
        validateAccessToken: async () =>
          activeClaims({
            scope: administration
              ? "reservations:read administration offline_access"
              : "reservations:read offline_access",
          }),
      })
    );

    expect(outcome._tag).toBe("Success");
    if (outcome._tag === "Success") {
      expect(outcome.success.scopes.has("administration")).toBe(administration);
      expect(outcome.success.scopes.has("reservations:read")).toBe(true);
    }
  });

  test("grants no scopes when the token names none", async () => {
    const outcome = await authorize(
      authorityWith({
        validateAccessToken: async () => activeClaims({ scope: undefined }),
      })
    );

    expect(outcome._tag).toBe("Success");
    if (outcome._tag === "Success") expect(outcome.success.scopes.size).toBe(0);
  });

  test("accepts an audience list that includes this resource", async () => {
    const outcome = await authorize(
      authorityWith({
        validateAccessToken: async () =>
          activeClaims({ aud: ["https://elsewhere.example/api", RESOURCE] }),
      })
    );

    expect(outcome._tag).toBe("Success");
  });

  test.each([
    ["a token the provider rejects", { reject: providerRejection }],
    [
      "a token the provider refuses as unauthorized",
      { reject: () => providerError(401) },
    ],
    ["an inactive token", { claims: { active: false } }],
    [
      "a token for another resource",
      { claims: { aud: "https://elsewhere.example/api/mcp" } },
    ],
    ["a token without an audience", { claims: { aud: undefined } }],
    ["a token without a subject", { claims: { sub: undefined } }],
    ["a token with an empty subject", { claims: { sub: "" } }],
    ["a token without a client", { claims: { client_id: undefined } }],
    ["a token with an empty client", { claims: { client_id: "" } }],
  ] as const)("refuses %s as an invalid token", async (_name, setup) => {
    let looked = false;
    const reason = await failureReason(
      authorityWith({
        validateAccessToken: async () => {
          if ("reject" in setup) throw setup.reject();
          return activeClaims(setup.claims);
        },
        findUser: async () => {
          looked = true;
          return userRow();
        },
      })
    );

    expect(reason).toBe("invalid-token");
    expect(looked).toBe(false);
  });

  test.each([
    ["a deleted account", null],
    ["an unverified account", userRow({ emailVerified: false })],
    [
      "an account pending deletion",
      userRow({ deletionRequestedAt: new Date("2026-10-02T00:00:00Z") }),
    ],
    ["an account without a valid email", userRow({ email: "not-an-email" })],
    ["a row for another account", userRow({ id: "account-2" })],
  ] as const)("refuses %s as unavailable to the agent", async (_name, user) => {
    expect(
      await failureReason(authorityWith({ findUser: async () => user }))
    ).toBe("account-unavailable");
  });

  test.each([
    [
      "the token check fails",
      authorityWith({
        validateAccessToken: async () => {
          throw new Error("connection reset");
        },
      }),
    ],
    [
      "the provider fails the token check",
      authorityWith({
        validateAccessToken: async () => {
          throw providerError(500);
        },
      }),
    ],
    [
      "the token check answers with no claims",
      authorityWith({ validateAccessToken: async () => null }),
    ],
    [
      "the account read fails",
      authorityWith({
        findUser: async () => {
          throw new Error("connection reset");
        },
      }),
    ],
    [
      "the account read fails with a provider error",
      authorityWith({
        findUser: async () => {
          throw providerRejection();
        },
      }),
    ],
  ] as const)("reports unavailable when %s", async (_name, authority) => {
    expect(await failureReason(authority)).toBe("unavailable");
  });

  test("re-reads the account on every call", async () => {
    let deletionRequestedAt: Date | null = null;
    const authority = authorityWith({
      findUser: async () => userRow({ deletionRequestedAt }),
    });

    expect((await authorize(authority))._tag).toBe("Success");
    deletionRequestedAt = new Date("2026-10-02T00:00:00Z");
    expect(await failureReason(authority)).toBe("account-unavailable");
  });
});

describe("isProviderRejection", () => {
  test.each([
    ["an API error without a status", providerRejection(), true],
    ["a 400 API error", providerError(400), true],
    ["a 401 API error", providerError(401), true],
    ["a 404 API error", providerError(404), true],
    ["a 500 API error", providerError(500), false],
    ["a 503 API error", providerError(503), false],
    ["another error", new Error("connection reset"), false],
    ["a non-error", { name: "APIError" }, false],
  ] as const)("classifies %s", (_name, cause, rejected) => {
    expect(isProviderRejection(cause)).toBe(rejected);
  });
});

describe("CustomerAgentAuthorization.currentUser", () => {
  test("gives the customer session the token acts for", async () => {
    const outcome = await currentUser(
      authorityWith({ findUser: async () => userRow({ locale: "cs-CZ" }) })
    );

    expect(outcome._tag).toBe("Success");
    if (outcome._tag !== "Success") return;
    expect(outcome.success).toEqual({
      accountId: ACCOUNT_ID as CustomerAccountId,
      email: customerEmail as never,
      deletionRequested: false,
      localePreference: "cs-CZ",
    });
  });

  test.each([
    [
      "an invalid token",
      authorityWith({
        validateAccessToken: async () => {
          throw providerRejection();
        },
      }),
    ],
    [
      "an account unavailable to the agent",
      authorityWith({ findUser: async () => null }),
    ],
  ] as const)("reads %s as signed out", async (_name, authority) => {
    const outcome = await currentUser(authority);

    expect(outcome._tag).toBe("Failure");
    if (outcome._tag !== "Failure") return;
    expect(outcome.failure._tag).toBe("CustomerAccountAccessError");
    expect(outcome.failure.reason).toBe("unauthenticated");
  });

  test("reports an unavailable check as unavailable", async () => {
    const outcome = await currentUser(
      authorityWith({
        validateAccessToken: async () => {
          throw new Error("connection reset");
        },
      })
    );

    expect(outcome._tag).toBe("Failure");
    if (outcome._tag !== "Failure") return;
    expect(outcome.failure.reason).toBe("unavailable");
    expect(outcome.failure.cause?.code).toBe("authentication.agent-token");
  });
});

describe("customerAuthenticationForAgent", () => {
  const readCurrentUser = (authority: CustomerAgentAuthority, token: string) =>
    Effect.runPromise(
      Effect.flatMap(
        CustomerAuthentication,
        (authentication) => authentication.currentUser
      ).pipe(
        Effect.provide(customerAuthenticationForAgent(token)),
        Effect.provide(CustomerAgentAuthorization.fromAuthority(authority)),
        Effect.result
      )
    );

  test("authenticates requests as the customer the token acts for", async () => {
    const validated: string[] = [];
    const outcome = await readCurrentUser(
      authorityWith({
        validateAccessToken: async (token) => {
          validated.push(token);
          return activeClaims();
        },
      }),
      TOKEN
    );

    expect(outcome._tag).toBe("Success");
    if (outcome._tag === "Success") {
      expect(outcome.success?.accountId).toBe(ACCOUNT_ID as CustomerAccountId);
    }
    expect(validated).toEqual([TOKEN]);
  });

  test("re-verifies the token on every read", async () => {
    let reads = 0;
    const authority = authorityWith({
      validateAccessToken: async () => {
        reads += 1;
        return activeClaims();
      },
    });

    await Effect.runPromise(
      Effect.flatMap(CustomerAuthentication, (authentication) =>
        Effect.zip(authentication.currentUser, authentication.currentUser)
      ).pipe(
        Effect.provide(customerAuthenticationForAgent(TOKEN)),
        Effect.provide(CustomerAgentAuthorization.fromAuthority(authority))
      )
    );

    expect(reads).toBe(2);
  });

  test("fails a revoked token as unauthenticated", async () => {
    const outcome = await readCurrentUser(
      authorityWith({
        validateAccessToken: async () => activeClaims({ active: false }),
      }),
      TOKEN
    );

    expect(outcome._tag).toBe("Failure");
    if (outcome._tag === "Failure") {
      expect(outcome.failure.reason).toBe("unauthenticated");
    }
  });
});

describe("readAgentAccessToken", () => {
  const read = (authorization?: string) =>
    readAgentAccessToken(
      new Headers(authorization === undefined ? {} : { authorization })
    );

  test.each([
    ["Bearer abc.def-ghi_jkl", "abc.def-ghi_jkl"],
    ["bearer abc", "abc"],
    ["BEARER abc", "abc"],
    ["  Bearer abc  ", "abc"],
  ])("reads the token from %p", (header, token) => {
    expect(read(header)).toEqual(Option.some(token));
  });

  test.each([
    ["no header", undefined],
    ["an empty header", ""],
    ["another scheme", "Basic YWJjOmRlZg=="],
    ["a scheme without a token", "Bearer"],
    ["a token with spaces", "Bearer abc def"],
    ["a scheme without a separator", "Bearerabc"],
  ])("reads nothing from %s", (_name, header) => {
    expect(read(header)).toEqual(Option.none());
  });
});
