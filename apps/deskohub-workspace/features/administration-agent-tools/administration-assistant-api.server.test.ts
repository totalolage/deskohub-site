import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import {
  type AdministrationAssistantConnectionIdType,
  type AdministrationChannel,
  CliSessionId,
  CliSessionUnauthorized,
  type CurrentAdministrationCaller,
} from "@deskohub/workspace-admin-api";
import { NodeHttpServer } from "@effect/platform-node";
import { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Effect, Layer, Logger, Option, type Schema } from "effect";
import { HttpRouter } from "effect/unstable/http";
import { StandaloneAccessCodeAdministration } from "@/features/access-codes";
import type { AgentScope } from "@/features/account/agent-scopes";
import {
  CustomerAgentAuthorization,
  CustomerAgentAuthorizationError,
  type CustomerAgentGrant,
  customerAgentClientIdSchema,
} from "@/features/account/backend/auth/customer-agent-authorization.service";
import { CustomerAgentClientDirectory } from "@/features/account/backend/auth/customer-agent-client-directory.service";
import {
  CustomerAccountAccessError,
  customerAccountIdSchema,
} from "@/features/account/customer-account";
import { InvoiceAdministrationService } from "@/features/accounting/admin/invoice-administration.service";
import { AdministrationActionLog } from "@/features/admin-cli/administration-action-log.service";
import { CliAuthentication } from "@/features/admin-cli/cli-authentication.service";
import { CliAuthenticationAdmission } from "@/features/admin-cli/cli-authentication-admission.service";
import { CliClientCompatibilityLive } from "@/features/admin-cli/cli-client-version";
import { CliMutationIdempotency } from "@/features/admin-cli/cli-mutation-idempotency.service";
import {
  CliBearerAuthenticationLive,
  CliSessionAdministrationAuthenticationLive,
  handleWorkspaceAdminApiRequest,
  makeWorkspaceAdminApiLayer,
} from "@/features/admin-cli/workspace-admin-api.server";
import { AdministrationService } from "@/features/administration/administration.service";
import { ReservationAccessAdministration } from "@/features/administration/reservation-access-administration.service";
import { ReservationAdministrationService } from "@/features/administration/reservation-administration.service";
import {
  AdministratorRoster,
  LegacyAdministratorBackfill,
} from "@/features/administrators";
import type { AdministratorAccountActor } from "@/features/administrators/account-role";
import { AccountRoleGrants } from "@/features/administrators/backend/account-role-grants.service";
import { AdministratorAgentAuthorization } from "@/features/administrators/backend/administrator-agent-authorization.service";
import { AdministratorAssistantConnections } from "@/features/administrators/backend/administrator-assistant-connections.service";
import type { CustomerAgentCaller } from "@/features/agent-tools/customer-agent-caller";
import { DiscountAdministration } from "@/features/discounts/admin/discount-administration.service";
import { CampaignOperations } from "@/features/email-campaigns/backend/campaign-operations.service";
import { ReservationProductDetailsBackfill } from "@/features/reservation/backend/reservation-product-details-backfill.service";
import { reservationCustomerEmailSchema } from "@/features/reservation/reservation-contact";
import {
  administrationOperationTools,
  makeAdministrationAgentTools,
} from "./administration-agent-tools";
import {
  AdministrationApiClient,
  AdministrationApiTransport,
} from "./administration-api-client";
import { makeAdministrationAssistantApiLayer } from "./administration-assistant-api.server";

const administrator: AdministratorAccountActor = {
  accountId: customerAccountIdSchema.make("assistant-administrator-account"),
  email: reservationCustomerEmailSchema.make(
    testEmailAddress("assistant-administrator")
  ),
};
const formerAdministratorId = customerAccountIdSchema.make(
  "former-administrator-account"
);
const cliAdministrator: AdministratorAccountActor = {
  accountId: customerAccountIdSchema.make("cli-administrator-account"),
  email: testEmailAddress("cli-administrator"),
};

const clientId = customerAgentClientIdSchema.make(
  "https://assistant.example/oauth/client.json"
);
const clientName = "Synthetic Assistant";
const unknownClientId = customerAgentClientIdSchema.make(
  "https://unknown.example/oauth/client.json"
);
const unreadableClientId = customerAgentClientIdSchema.make(
  "https://unreadable.example/oauth/client.json"
);
const assistantChannel: AdministrationChannel = {
  _tag: "AssistantConnection",
  connectionId:
    "01980000-0000-7000-8000-0000000000a7" as AdministrationAssistantConnectionIdType,
  oauthClientId: clientId,
};

// Synthetic credentials. A CLI bearer is 43 base64url characters; OAuth
// access tokens are opaque strings or JWTs.
const assistantToken = "assistant-administrator-access-token";
const cliBearer = "c".repeat(43);
const cliSession = {
  id: CliSessionId.make("01980000-0000-7000-8000-0000000000c1"),
  approvedBy: null,
  approvedByEmail: null,
  clientName: "test client",
  cliVersion: "1.0.0",
  buildTarget: "development",
  createdAt: "2026-08-10T10:00:00.000Z",
  lastUsedAt: "2026-08-10T10:00:00.000Z",
  expiresAt: null,
} as const;

const grantOf = ({
  account = administrator.accountId,
  scopes = ["reservations:read", "administration"],
  client = clientId,
}: {
  readonly account?: CustomerAgentGrant["accountId"];
  readonly scopes?: ReadonlyArray<AgentScope>;
  readonly client?: CustomerAgentGrant["clientId"];
}): CustomerAgentGrant => ({
  accountId: account,
  clientId: client,
  scopes: new Set(scopes),
});

type TokenState =
  | { readonly kind: "valid"; readonly grant: CustomerAgentGrant }
  | {
      readonly kind: "refused";
      readonly reason: CustomerAgentAuthorizationError["reason"];
    };

/** What verifying each access token yields; any other token is invalid. */
const tokens = new Map<string, TokenState>([
  [assistantToken, { kind: "valid", grant: grantOf({}) }],
  [
    "customer-assistant-access-token",
    { kind: "valid", grant: grantOf({ scopes: ["reservations:read"] }) },
  ],
  [
    "former-administrator-access-token",
    { kind: "valid", grant: grantOf({ account: formerAdministratorId }) },
  ],
  [
    "deleted-account-access-token",
    { kind: "refused", reason: "account-unavailable" },
  ],
  [
    "unknown-client-access-token",
    { kind: "valid", grant: grantOf({ client: unknownClientId }) },
  ],
  [
    "authorization-outage-access-token",
    { kind: "refused", reason: "unavailable" },
  ],
  [
    "directory-outage-access-token",
    { kind: "valid", grant: grantOf({ client: unreadableClientId }) },
  ],
]);

const databaseFailure = (query: string) =>
  new EffectDrizzleQueryError({
    query,
    params: [],
    cause: new Error("synthetic outage"),
  });

/**
 * The services the assistant authentication reads, over fake token, grant,
 * client and connection authorities. The administrator authorization is
 * the real one, so scope and grant checks run as in production.
 */
const makeAssistantServices = ({
  connectFailure,
}: {
  readonly connectFailure?: "fails" | "dies";
} = {}) => {
  const connects: Array<
    Parameters<AdministratorAssistantConnections["Service"]["connect"]>[0]
  > = [];
  const verify = (
    token: string
  ): Effect.Effect<CustomerAgentGrant, CustomerAgentAuthorizationError> => {
    const state = tokens.get(token) ?? {
      kind: "refused",
      reason: "invalid-token",
    };
    return state.kind === "valid"
      ? Effect.succeed(state.grant)
      : Effect.fail(
          new CustomerAgentAuthorizationError({ reason: state.reason })
        );
  };
  const agents = Layer.succeed(CustomerAgentAuthorization, {
    authorize: verify,
    currentUser: (token) =>
      verify(token).pipe(
        Effect.map((grant) => ({
          accountId: grant.accountId,
          email: administrator.email,
          deletionRequested: false,
        })),
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
  });
  const layer = Layer.mergeAll(
    agents,
    AdministratorAgentAuthorization.Default.pipe(
      Layer.provide(
        Layer.mergeAll(
          agents,
          Layer.mock(AccountRoleGrants, {
            has: ({ accountId }) =>
              Effect.succeed(accountId === administrator.accountId),
          })
        )
      )
    ),
    Layer.succeed(CustomerAgentClientDirectory, {
      find: (id) =>
        id === unreadableClientId
          ? Effect.fail(
              new CustomerAgentAuthorizationError({ reason: "unavailable" })
            )
          : Effect.succeed(
              id === clientId
                ? Option.some({
                    clientId,
                    name: clientName,
                    host: "assistant.example",
                  })
                : Option.none()
            ),
    }),
    Layer.succeed(AdministratorAssistantConnections, {
      connect: (input) => {
        if (connectFailure === "fails") {
          return Effect.fail(
            databaseFailure("insert into administrator assistant connections")
          );
        }
        if (connectFailure === "dies") {
          return Effect.die(new Error("The assistant connection disappeared."));
        }
        return Effect.sync(() => {
          connects.push(input);
          return {
            _tag: "AssistantConnection" as const,
            connectionId: assistantChannel.connectionId,
            oauthClientId: input.oauthClientId,
          };
        });
      },
    })
  );
  return { connects, layer };
};

/**
 * The domain services behind every instance. The CLI authentication accepts
 * only `cliBearer`, so an instance that consults it would admit the CLI.
 */
const makeInstanceServices = () => {
  const callers: Array<CurrentAdministrationCaller["Service"]> = [];
  const backfills: Array<
    Parameters<ReservationProductDetailsBackfill["Service"]["runBatch"]>[0]
  > = [];
  const sessionOwners: Array<string> = [];
  const sessionAuthentications: Array<string> = [];
  const layer = Layer.mergeAll(
    Layer.succeed(CliAuthentication, {
      ...({} as CliAuthentication["Service"]),
      authenticateSession: (authorization) =>
        Effect.suspend(() => {
          sessionAuthentications.push(authorization);
          return authorization === `Bearer ${cliBearer}`
            ? Effect.succeed(cliSession)
            : Effect.fail(
                new CliSessionUnauthorized({
                  message: "The CLI session is not valid.",
                })
              );
        }),
      sessionAdministrator: () => Effect.succeed(cliAdministrator),
      listSessions: (owner) =>
        Effect.sync(() => {
          sessionOwners.push(owner);
          return [];
        }),
    }),
    Layer.succeed(CliMutationIdempotency, {
      applyOnce: () => Effect.die("Unused CLI mutation ledger"),
      claim: () => Effect.succeed({ kind: "in-progress" as const }),
      complete: () => Effect.void,
      reclaimStale: () => Effect.succeed(false),
      release: () => Effect.void,
    }),
    Layer.succeed(AdministrationActionLog, {
      start: ({ caller }) =>
        Effect.sync(() => {
          callers.push(caller);
          return "01980000-0000-7000-8000-0000000000e1";
        }),
      finish: () => Effect.void,
    }),
    Layer.succeed(CliAuthenticationAdmission, {} as never),
    Layer.succeed(AdministrationService, {} as never),
    Layer.succeed(AdministratorRoster, {} as never),
    Layer.succeed(LegacyAdministratorBackfill, {} as never),
    Layer.succeed(CampaignOperations, {} as never),
    Layer.succeed(ReservationAdministrationService, {} as never),
    Layer.succeed(ReservationProductDetailsBackfill, {
      runBatch: (input) =>
        Effect.sync(() => {
          backfills.push(input);
          return {
            updated: 1,
            alreadyComplete: 0,
            unresolved: [],
            nextCursor: null,
          };
        }),
    }),
    Layer.succeed(ReservationAccessAdministration, {} as never),
    Layer.succeed(DiscountAdministration, {} as never),
    Layer.succeed(InvoiceAdministrationService, {} as never),
    Layer.succeed(StandaloneAccessCodeAdministration, {} as never),
    NodeHttpServer.layerHttpServices
  );
  return {
    backfills,
    callers,
    layer,
    sessionAuthentications,
    sessionOwners,
  };
};

const makeCliApiLayer = () =>
  makeWorkspaceAdminApiLayer({
    authentication: CliSessionAdministrationAuthenticationLive,
    sessionAuthentication: CliBearerAuthenticationLive,
    clientCompatibility: CliClientCompatibilityLive,
  });

const serveAssistant = (
  options: {
    readonly connectFailure?: "fails" | "dies";
    readonly logs?: string[];
  } = {}
) => {
  const assistant = makeAssistantServices(options);
  const instance = makeInstanceServices();
  const logs = options.logs;
  const web = HttpRouter.toWebHandler(
    makeAdministrationAssistantApiLayer().pipe(
      Layer.provide(Layer.mergeAll(assistant.layer, instance.layer)),
      Layer.provideMerge(
        logs
          ? Logger.layer([
              Logger.make<unknown, void>(({ message }) => {
                logs.push(JSON.stringify(message));
              }),
            ])
          : Layer.empty
      )
    ),
    { disableLogger: true }
  );
  return { ...assistant, ...instance, handler: web.handler, web };
};

type Handler = (request: Request) => Promise<Response>;

const send = (
  handler: Handler,
  bearer: string,
  init: RequestInit & { readonly path: string } = listSessions
) =>
  handler(
    new Request(`https://workspace.deskohub.test/api/v1/cli${init.path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${bearer}`,
        "content-type": "application/json",
        ...init.headers,
      },
    })
  );

const listSessions = { path: "/sessions" };
const currentSession = { path: "/session" };
const deleteCode = {
  path: "/discounts/mutations",
  method: "POST",
  body: JSON.stringify({
    requestId: "01980000-0000-7000-8000-0000000000b1",
    mutation: {
      kind: "delete-code",
      id: "01980000-0000-7000-8000-0000000000d1",
    },
  }),
};

const errorTagOf = async (response: Response) =>
  ((await response.json()) as { readonly _tag?: string })._tag;

describe("AdministratorAssistantAuthenticationLive", () => {
  test("acts as the token's administrator on its assistant connection", async () => {
    const { callers, connects, handler, sessionOwners, web } = serveAssistant();

    const sessions = await send(handler, assistantToken, {
      // Nothing in the request names the actor or the client.
      path: `${listSessions.path}?oauthClientId=https://other.example/client.json&accountId=${cliAdministrator.accountId}`,
      headers: {
        "x-oauth-client-id": "https://other.example/client.json",
        "x-client-name": "Spoofed Assistant",
      },
    });
    const mutation = await send(handler, assistantToken, deleteCode);
    await web.dispose();

    expect(sessions.status).toBe(200);
    expect(sessionOwners).toEqual([administrator.accountId]);
    expect(mutation.status).toBe(409);
    expect(callers).toEqual([
      { actor: administrator, channel: assistantChannel },
    ]);
    expect(connects).toEqual([
      { actor: administrator, oauthClientId: clientId, clientName },
      { actor: administrator, oauthClientId: clientId, clientName },
    ]);
  });

  test.each([
    ["an unknown or expired token", "unknown-access-token", "invalid-token"],
    [
      "a deleted account",
      "deleted-account-access-token",
      "account-unavailable",
    ],
    [
      "a grant without the administration scope",
      "customer-assistant-access-token",
      "missing-scope",
    ],
    [
      "a revoked administrator grant",
      "former-administrator-access-token",
      "not-administrator",
    ],
    ["an unknown client", "unknown-client-access-token", "unknown-client"],
  ])("refuses %s", async (_case, token, reason) => {
    const logs: string[] = [];
    const { callers, connects, handler, sessionOwners, web } = serveAssistant({
      logs,
    });

    const sessions = await send(handler, token);
    const mutation = await send(handler, token, deleteCode);
    await web.dispose();

    expect([sessions.status, await errorTagOf(sessions)]).toEqual([
      401,
      "CliSessionUnauthorized",
    ]);
    expect([mutation.status, await errorTagOf(mutation)]).toEqual([
      401,
      "CliSessionUnauthorized",
    ]);
    expect(sessionOwners).toEqual([]);
    expect(callers).toEqual([]);
    expect(connects).toEqual([]);
    expect(logs.some((text) => text.includes(reason))).toBe(true);
    expect(logs.some((text) => text.includes(token))).toBe(false);
  });

  test.each([
    ["the token can't be verified", "authorization-outage-access-token", {}],
    ["the client can't be read", "directory-outage-access-token", {}],
    [
      "the connection can't be recorded",
      assistantToken,
      { connectFailure: "fails" as const },
    ],
    [
      "recording the connection dies",
      assistantToken,
      { connectFailure: "dies" as const },
    ],
  ])(
    "reports the service unavailable when %s",
    async (_case, token, options) => {
      const logs: string[] = [];
      const { callers, handler, sessionOwners, web } = serveAssistant({
        ...options,
        logs,
      });

      const response = await send(handler, token);
      await web.dispose();

      expect([response.status, await errorTagOf(response)]).toEqual([
        503,
        "CliServiceUnavailable",
      ]);
      expect(sessionOwners).toEqual([]);
      expect(callers).toEqual([]);
      expect(logs.some((text) => text.includes(token))).toBe(false);
    }
  );
});

describe("administration API instances", () => {
  test("the assistant instance refuses a CLI bearer", async () => {
    const { handler, sessionAuthentications, sessionOwners, web } =
      serveAssistant();

    const sessions = await send(handler, cliBearer);
    const session = await send(handler, cliBearer, currentSession);
    const assistantSession = await send(
      handler,
      assistantToken,
      currentSession
    );
    await web.dispose();

    expect([sessions.status, await errorTagOf(sessions)]).toEqual([
      401,
      "CliSessionUnauthorized",
    ]);
    expect([session.status, await errorTagOf(session)]).toEqual([
      401,
      "CliSessionUnauthorized",
    ]);
    expect([
      assistantSession.status,
      await errorTagOf(assistantSession),
    ]).toEqual([401, "CliSessionUnauthorized"]);
    expect(sessionAuthentications).toEqual([]);
    expect(sessionOwners).toEqual([]);
  });

  test.each([
    ["an opaque", "Opaque0AccessToken1Synthetic2Value"],
    [
      "a JWT",
      "eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJzeW50aGV0aWMifQ.c3ludGhldGljLXNpZ25hdHVyZQ",
    ],
  ])("the CLI route refuses %s OAuth access token", async (_case, token) => {
    for (const init of [listSessions, currentSession]) {
      const response = await send(handleWorkspaceAdminApiRequest, token, init);

      expect([response.status, await errorTagOf(response)]).toEqual([
        401,
        "CliSessionUnauthorized",
      ]);
    }
  });

  test("each instance keeps its own authentication in either build order", async () => {
    const requests = [
      [cliBearer, listSessions],
      [cliBearer, currentSession],
      [assistantToken, listSessions],
      [assistantToken, currentSession],
    ] as const;

    for (const order of [
      ["cli", "assistant"],
      ["assistant", "cli"],
    ] as const) {
      const assistant = makeAssistantServices();
      const instance = makeInstanceServices();
      const services = Layer.mergeAll(assistant.layer, instance.layer);
      const memoMap = Layer.makeMemoMapUnsafe();
      const build = {
        cli: () => makeCliApiLayer(),
        assistant: () => makeAdministrationAssistantApiLayer(),
      };
      const webs = Object.fromEntries(
        order.map((name) => [
          name,
          HttpRouter.toWebHandler(build[name]().pipe(Layer.provide(services)), {
            disableLogger: true,
            memoMap,
          }),
        ])
      ) as Record<
        (typeof order)[number],
        ReturnType<typeof HttpRouter.toWebHandler<never, never, never, never>>
      >;

      const statuses: Array<string> = [];
      for (const name of order) {
        for (const [bearer, init] of requests) {
          const response = await send(webs[name].handler, bearer, init);
          statuses.push(
            `${name} ${bearer === cliBearer ? "CLI bearer" : "OAuth token"} ${init.path} ${response.status}`
          );
        }
      }
      await Promise.all(Object.values(webs).map((web) => web.dispose()));

      const expected = {
        cli: [
          "cli CLI bearer /sessions 200",
          "cli CLI bearer /session 200",
          "cli OAuth token /sessions 401",
          "cli OAuth token /session 401",
        ],
        assistant: [
          "assistant CLI bearer /sessions 401",
          "assistant CLI bearer /session 401",
          "assistant OAuth token /sessions 200",
          "assistant OAuth token /session 401",
        ],
      };
      expect(statuses).toEqual(order.flatMap((name) => expected[name]));
      expect(instance.sessionOwners).toEqual(
        order.map((name) =>
          name === "cli" ? cliAdministrator.accountId : administrator.accountId
        )
      );
      // Only the CLI instance consults CLI sessions.
      expect(instance.sessionAuthentications).toEqual(
        requests.map(([bearer]) => `Bearer ${bearer}`)
      );
    }
  });
});

describe("administration tools through the assistant API", () => {
  const caller: CustomerAgentCaller = {
    accessToken: assistantToken,
    grant: grantOf({}),
  };
  const backfillTool = makeAdministrationAgentTools(
    administrationOperationTools
  ).find(({ name }) => name === "admin_backfill_reservation_product_details");

  const callBackfill = (handler: Handler, args: Schema.Json) =>
    backfillTool!
      .call(args, Option.some(caller))
      .pipe(
        Effect.provide(
          Layer.mergeAll(
            makeAssistantServices().layer,
            AdministrationApiClient.Default.pipe(
              Layer.provide(Layer.succeed(AdministrationApiTransport, handler))
            )
          )
        ),
        Effect.runPromise
      );

  test("records a dry run, the preview's included, as no action, and the confirmed run as one", async () => {
    const { backfills, callers, handler } = serveAssistant();

    const preview = await callBackfill(handler, {
      dryRun: false,
      after: null,
    });
    const dryRun = await callBackfill(handler, { dryRun: true, after: null });

    expect(preview).toMatchObject({
      result: { outcome: "confirmation-required" },
    });
    expect(dryRun).toMatchObject({ result: { outcome: "dry-run" } });
    expect(backfills).toEqual([
      { dryRun: true, after: null },
      { dryRun: true, after: null },
    ]);
    expect(callers).toEqual([]);

    const applied = await callBackfill(handler, {
      dryRun: false,
      after: null,
      confirm: true,
    });

    expect(applied).toMatchObject({ result: { outcome: "applied" } });
    expect(backfills.at(-1)).toEqual({ dryRun: false, after: null });
    expect(callers.map(({ channel }) => channel)).toEqual([assistantChannel]);
  });
});
