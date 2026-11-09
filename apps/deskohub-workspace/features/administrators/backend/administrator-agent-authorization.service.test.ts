import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Cause, Effect, Layer } from "effect";
import * as SqlError from "effect/unstable/sql/SqlError";
import type { AgentScope } from "@/features/account/agent-scopes";
import {
  CustomerAgentAuthorization,
  CustomerAgentAuthorizationError,
  type CustomerAgentCaller,
  type CustomerAgentGrant,
  customerAgentClientIdSchema,
} from "@/features/account/backend/auth/customer-agent-authorization.service";
import type { CustomerAccountSession } from "@/features/account/backend/customer-authentication.service";
import {
  CustomerAccountAccessError,
  customerAccountIdSchema,
} from "@/features/account/customer-account";
import { reservationCustomerEmailSchema } from "@/features/reservation/reservation-contact";
import { AccountRoleGrants } from "./account-role-grants.service";
import { AdministratorAgentAuthorization } from "./administrator-agent-authorization.service";

const accountId = customerAccountIdSchema.make(crypto.randomUUID());
const otherAccountId = customerAccountIdSchema.make(crypto.randomUUID());
const email = reservationCustomerEmailSchema.make(
  testEmailAddress("administrator-agent")
);
const clientId = customerAgentClientIdSchema.make(
  "https://client.example/oauth/client.json"
);
const session: CustomerAccountSession = {
  accountId,
  email,
  deletionRequested: false,
};

const grantOf = (
  scopes: ReadonlyArray<AgentScope>,
  account = accountId
): CustomerAgentGrant => ({
  accountId: account,
  clientId,
  scopes: new Set(scopes),
});

const administrationGrant = grantOf(["reservations:read", "administration"]);
const customerGrant = grantOf(["reservations:read"]);

type TokenState =
  | { readonly kind: "valid"; readonly grant: CustomerAgentGrant }
  | { readonly kind: "refused" }
  | { readonly kind: "unavailable" };

const grantReadFailure = () =>
  new EffectDrizzleQueryError({
    query: 'select from "account_role_grants"',
    params: [],
    cause: Cause.fail(
      new SqlError.SqlError({
        reason: new SqlError.ConnectionError({
          cause: new Error("synthetic outage"),
          message: "synthetic outage",
        }),
      })
    ),
  });

/**
 * The authorization over fake token and grant authorities: `tokens` maps an
 * access token to what verifying it yields now, `granted` the live grant.
 */
const makeAuthorization = ({
  tokens,
  granted,
}: {
  readonly tokens: () => ReadonlyMap<string, TokenState>;
  readonly granted: () => boolean | "unavailable";
}) => {
  const grantChecks: unknown[] = [];
  const verify = (token: string) => {
    const state = tokens().get(token) ?? { kind: "refused" };
    return state.kind === "valid"
      ? Effect.succeed(state.grant)
      : Effect.fail(
          new CustomerAgentAuthorizationError({
            reason: state.kind === "refused" ? "invalid-token" : "unavailable",
          })
        );
  };
  const layer = AdministratorAgentAuthorization.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(CustomerAgentAuthorization, {
          authorize: verify,
          currentUser: (token) =>
            verify(token).pipe(
              Effect.map(
                (grant): CustomerAccountSession => ({
                  ...session,
                  accountId: grant.accountId,
                })
              ),
              Effect.mapError(
                (error) =>
                  new CustomerAccountAccessError({
                    reason:
                      error.reason === "unavailable"
                        ? "unavailable"
                        : "unauthenticated",
                  })
              )
            ),
        }),
        Layer.succeed(AccountRoleGrants, {
          grant: () => Effect.die("unused"),
          revoke: () => Effect.die("unused"),
          list: () => Effect.die("unused"),
          has: (key) =>
            Effect.suspend(() => {
              grantChecks.push(key);
              const state = granted();
              return state === "unavailable"
                ? Effect.fail(grantReadFailure())
                : Effect.succeed(state);
            }),
        })
      )
    )
  );
  /** The administrator the caller acts as, or why it may not. */
  const authorize = (caller: CustomerAgentCaller) =>
    Effect.runPromise(
      Effect.flatMap(AdministratorAgentAuthorization, (authorization) =>
        authorization.authorize(caller)
      ).pipe(
        Effect.catchTag("AdministratorAgentAuthorizationError", (error) =>
          Effect.succeed(error.reason)
        ),
        Effect.provide(layer)
      )
    );
  return { authorize, grantChecks };
};

describe("AdministratorAgentAuthorization", () => {
  test("acts as the administrator whose token carries the scope", async () => {
    const { authorize, grantChecks } = makeAuthorization({
      tokens: () =>
        new Map([["token", { kind: "valid", grant: administrationGrant }]]),
      granted: () => true,
    });

    expect(
      await authorize({ grant: administrationGrant, accessToken: "token" })
    ).toEqual({ accountId, email });
    expect(grantChecks).toEqual([{ accountId, role: "administrator" }]);
  });

  test("reads the grant on every call, so a revocation stops the next one", async () => {
    let granted = true;
    const { authorize, grantChecks } = makeAuthorization({
      tokens: () =>
        new Map([["token", { kind: "valid", grant: administrationGrant }]]),
      granted: () => granted,
    });
    const caller = { grant: administrationGrant, accessToken: "token" };

    expect(await authorize(caller)).toEqual({ accountId, email });
    granted = false;

    expect(await authorize(caller)).toBe("not-administrator");
    expect(grantChecks).toHaveLength(2);
  });

  test("refuses a token without the administration scope, whatever its grant", async () => {
    const { authorize, grantChecks } = makeAuthorization({
      tokens: () =>
        new Map([["customer-token", { kind: "valid", grant: customerGrant }]]),
      granted: () => true,
    });

    expect(
      await authorize({ grant: customerGrant, accessToken: "customer-token" })
    ).toBe("missing-scope");
    // A caller pairing a grant with the administration scope with a token
    // that lacks it gets nothing either.
    expect(
      await authorize({
        grant: administrationGrant,
        accessToken: "customer-token",
      })
    ).toBe("missing-scope");
    expect(grantChecks).toEqual([]);
  });

  test("refuses a token issued for another account than the caller's", async () => {
    const { authorize } = makeAuthorization({
      tokens: () =>
        new Map([
          [
            "token",
            {
              kind: "valid",
              grant: grantOf(["administration"], otherAccountId),
            },
          ],
        ]),
      granted: () => true,
    });

    expect(
      await authorize({ grant: administrationGrant, accessToken: "token" })
    ).toBe("account-unavailable");
  });

  test("refuses a token that no longer grants anything", async () => {
    let tokens = new Map<string, TokenState>([
      ["token", { kind: "valid", grant: administrationGrant }],
    ]);
    const { authorize } = makeAuthorization({
      tokens: () => tokens,
      granted: () => true,
    });
    const caller = { grant: administrationGrant, accessToken: "token" };

    expect(await authorize(caller)).toEqual({ accountId, email });
    // A disconnect deletes the token; a deleted, deletion-pending, or
    // unverified account fails verification the same way.
    tokens = new Map([["token", { kind: "refused" }]]);

    expect(await authorize(caller)).toBe("account-unavailable");
  });

  test.each([
    ["the token check", { kind: "unavailable" } as const, () => true],
    [
      "the grant read",
      { kind: "valid", grant: administrationGrant } as const,
      () => "unavailable" as const,
    ],
  ])("fails closed when %s is unavailable", async (_, token, granted) => {
    const { authorize } = makeAuthorization({
      tokens: () => new Map([["token", token]]),
      granted,
    });

    expect(
      await authorize({ grant: administrationGrant, accessToken: "token" })
    ).toBe("unavailable");
  });
});
