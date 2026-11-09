import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect, Layer } from "effect";
import type { CustomerAccountId } from "../customer-account";

const agentAccountId = "agent-account" as CustomerAccountId;
const lockedAccounts: string[] = [];

// The account services read links and activity through the repository; the
// fake keeps the agent's account linked and active.
const linksModule = await import("./customer-account-link.repository");
class TestCustomerAccountLinkRepository extends linksModule.CustomerAccountLinkRepository {
  static override Live = Layer.mock(linksModule.CustomerAccountLinkRepository, {
    find: (accountId) =>
      Effect.succeed(accountId === agentAccountId ? ("60111" as never) : null),
    findActivityState: () =>
      Effect.succeed({ kind: "active", deletionRequestedAt: null }),
    withAccountLock: (accountId, effect) =>
      Effect.sync(() => lockedAccounts.push(accountId)).pipe(
        Effect.andThen(effect)
      ),
  });
}
mock.module("./customer-account-link.repository", () => ({
  ...linksModule,
  CustomerAccountLinkRepository: TestCustomerAccountLinkRepository,
}));

const { CustomerAgentAuthorization } = await import(
  "./auth/customer-agent-authorization.service"
);
const { OptionalAccountActivityGuard } = await import(
  "./customer-account-activity"
);
const { CustomerAccountContactService } = await import(
  "./customer-account-contact.service"
);
const { CustomerAccountReservationOwnership } = await import(
  "./customer-account-reservation-ownership"
);
const { CustomerAuthentication } = await import(
  "./customer-authentication.service"
);
const { customerAgentAccountServices } = await import(
  "./customer-agent-account-services"
);

const resource = "https://workspace.deskohub.test/api/mcp";
let tokenValid = true;

const authority = CustomerAgentAuthorization.fromAuthority({
  resource,
  validateAccessToken: async () => {
    if (!tokenValid) {
      throw Object.assign(new Error("Revoked"), { name: "APIError" });
    }
    return {
      active: true,
      sub: agentAccountId,
      client_id: "https://assistant.example/oauth-client.json",
      scope: "reservations:read",
      aud: resource,
    };
  },
  findUser: async (id) => ({
    id,
    email: testEmailAddress("agent-account-services"),
    emailVerified: true,
    name: "Agent Customer",
    createdAt: new Date(),
    updatedAt: new Date(),
  }),
});

const runAsAgent = <A, E>(
  effect: Effect.Effect<
    A,
    E,
    Layer.Success<ReturnType<typeof customerAgentAccountServices>>
  >
) =>
  effect.pipe(
    Effect.provide(
      customerAgentAccountServices("agent-token").pipe(Layer.provide(authority))
    ),
    Effect.result,
    Effect.runPromise
  );

describe("customerAgentAccountServices", () => {
  test("reads the customer the agent's token acts for", async () => {
    tokenValid = true;
    lockedAccounts.length = 0;

    const result = await runAsAgent(
      Effect.all({
        session: CustomerAuthentication.pipe(
          Effect.flatMap((authentication) => authentication.currentUser)
        ),
        guarded: OptionalAccountActivityGuard.pipe(
          Effect.flatMap((guard) =>
            guard.guardStateCreation((accountId) => Effect.succeed(accountId))
          )
        ),
        linked: CustomerAccountContactService.pipe(
          Effect.flatMap((contacts) => contacts.currentLinkedAccount)
        ),
        author: CustomerAccountReservationOwnership.pipe(
          Effect.flatMap((ownership) => ownership.activeAccountId)
        ),
      })
    );

    expect(result).toMatchObject({
      _tag: "Success",
      success: {
        session: { accountId: agentAccountId, deletionRequested: false },
        guarded: agentAccountId,
        linked: { accountId: agentAccountId, dotyposCustomerId: "60111" },
        author: agentAccountId,
      },
    });
    expect(lockedAccounts).toEqual([agentAccountId]);
  });

  test("fails closed once the token grants nothing", async () => {
    tokenValid = false;
    lockedAccounts.length = 0;

    const guarded = await runAsAgent(
      OptionalAccountActivityGuard.pipe(
        Effect.flatMap((guard) =>
          guard.guardStateCreation((accountId) => Effect.succeed(accountId))
        )
      )
    );
    const author = await runAsAgent(
      CustomerAccountReservationOwnership.pipe(
        Effect.flatMap((ownership) => ownership.activeAccountId)
      )
    );

    expect(guarded).toMatchObject({
      _tag: "Failure",
      failure: { reason: "unauthenticated" },
    });
    expect(author._tag).toBe("Failure");
    expect(lockedAccounts).toEqual([]);
  });
});
