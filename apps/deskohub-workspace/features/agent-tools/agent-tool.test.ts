import "@/shared/testing/workspace-test-env";
import { describe, expect, mock, test } from "bun:test";
import { supportedLocales } from "@deskohub/i18n/locale-registry";
import { Effect, Layer, Option, Schema } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import type {
  CustomerAgentCaller,
  CustomerAgentClientId,
  CustomerAgentScope,
} from "@/features/account";
import type { CustomerAccountId } from "@/features/account/customer-account";

// The token-backed account services open the database when built; the
// signed-in tool below reads only the customer's authentication.
mock.module("@/db/database-provider.server", () => ({
  workspaceDatabaseLayer: Layer.succeed(
    WorkspaceDatabase,
    WorkspaceDatabase.make({} as never)
  ),
  workspaceDatabasePool: { options: { max: 4 } },
}));

const { CustomerAgentAuthorization } = await import("@/features/account");
const { CustomerAuthentication } = await import(
  "@/features/account/backend/customer-authentication.service"
);
const {
  agentToolLocaleField,
  defineAgentTool,
  defineSignedInAgentTool,
  getRequestedAgentToolLocale,
} = await import("./agent-tool");
const { inMemoryCustomerAgentCallServices } = await import(
  "./agent-tools.test-utils"
);
const { CurrentCustomerAgentGrant } = await import("./customer-agent-caller");

describe("defineAgentTool", () => {
  const tool = defineAgentTool({
    name: "public_read",
    title: "public_read",
    description: "public_read",
    access: "public",
    readOnly: true,
    unavailableCode: "quote_unavailable",
    input: Schema.Struct({
      seats: Schema.Int,
      locale: agentToolLocaleField,
    }),
    output: Schema.Struct({ seats: Schema.Int }),
    run: ({ seats }) =>
      seats < 0
        ? Effect.die(new Error("negative seats"))
        : Effect.succeed({ seats }),
  });

  test("runs the tool with decoded arguments", async () => {
    await expect(Effect.runPromise(tool!.call({ seats: 2 }))).resolves.toEqual({
      seats: 2,
    });
  });

  test("names the first invalid argument", async () => {
    const error = await Effect.runPromise(
      Effect.flip(tool!.call({ seats: "two" }))
    );

    expect(error.details).toEqual({ code: "invalid_input", field: "seats" });
  });

  test("reports an unexpected defect as the tool's unavailable code", async () => {
    const error = await Effect.runPromise(
      Effect.flip(tool!.call({ seats: -1 }))
    );

    expect(error.details).toEqual({ code: "quote_unavailable" });
  });

  test("describes its input and output as JSON Schema", () => {
    expect(
      tool!.input["~standard"].jsonSchema.input({ target: "draft-2020-12" })
    ).toMatchObject({
      type: "object",
      properties: { seats: { type: "integer" } },
      required: ["seats"],
    });
    expect(tool!.output["~standard"].validate({ seats: 1 })).toEqual({
      value: { seats: 1 },
    });
  });

  test("publishes the error result in its output schema", () => {
    const errorResult = {
      error: { code: "rate_limited", message: "Too many requests." },
    };

    expect(tool!.output["~standard"].validate(errorResult)).toEqual({
      value: errorResult,
    });
    expect(
      tool!.output["~standard"].validate({ error: { code: "rate_limited" } })
    ).toMatchObject({ issues: expect.any(Array) });
    expect(
      tool!.output["~standard"].jsonSchema.output({ target: "draft-2020-12" })
    ).toMatchObject({ anyOf: [{ type: "object" }, { type: "object" }] });
  });
});

describe("getRequestedAgentToolLocale", () => {
  test("reads each supported locale from raw arguments", () => {
    for (const locale of supportedLocales) {
      expect(getRequestedAgentToolLocale({ locale, seats: "x" })).toBe(locale);
    }
  });

  test("falls back to English for missing or unsupported locales", () => {
    expect(getRequestedAgentToolLocale(undefined)).toBe("en-US");
    expect(getRequestedAgentToolLocale({ locale: "fr-FR" })).toBe("en-US");
  });
});

describe("defineSignedInAgentTool", () => {
  /** Answers with the grant it runs for and the customer it reads. */
  const tool = defineSignedInAgentTool({
    name: "whoami",
    title: "whoami",
    description: "whoami",
    scope: "reservations:read",
    readOnly: true,
    unavailableCode: "reservations_unavailable",
    input: Schema.Struct({ locale: agentToolLocaleField }),
    output: Schema.Struct({
      grant_account_id: Schema.String,
      customer_account_id: Schema.NullOr(Schema.String),
    }),
    run: () =>
      Effect.all({
        grant: CurrentCustomerAgentGrant,
        customer: CustomerAuthentication.pipe(
          Effect.flatMap(({ currentUser }) => currentUser),
          Effect.orDie
        ),
      }).pipe(
        Effect.map(({ grant, customer }) => ({
          grant_account_id: grant.accountId,
          customer_account_id: customer?.accountId ?? null,
        }))
      ),
  });

  const caller: CustomerAgentCaller = {
    grant: {
      accountId: "grant-account" as CustomerAccountId,
      clientId:
        "https://assistant.example/client.json" as CustomerAgentClientId,
      scopes: new Set<CustomerAgentScope>(["reservations:read"]),
    },
    accessToken: "agent-token",
  };

  /** The tokens the account services verified, in order. */
  const verifiedTokens: string[] = [];
  const authorization = Layer.mock(CustomerAgentAuthorization, {
    currentUser: (accessToken) =>
      Effect.sync(() => {
        verifiedTokens.push(accessToken);
        return {
          accountId: "token-account" as CustomerAccountId,
          deletionRequested: false,
        } as never;
      }),
  });

  const whoami = tool.call({}, Option.some(caller));

  test("reads the customer through the caller's access token by default", async () => {
    verifiedTokens.length = 0;

    await expect(
      whoami.pipe(Effect.provide(authorization), Effect.runPromise)
    ).resolves.toEqual({
      grant_account_id: "grant-account",
      customer_account_id: "token-account",
    });
    expect(verifiedTokens).toEqual(["agent-token"]);
  });

  test("reads the services a call is given only for that call", async () => {
    verifiedTokens.length = 0;
    const inMemory = inMemoryCustomerAgentCallServices(() => ({
      authentication: {
        currentUser: Effect.succeed({
          accountId: "in-memory-account",
          deletionRequested: false,
        } as never),
      },
    }));

    await expect(
      whoami.pipe(
        Effect.provide(Layer.merge(authorization, inMemory)),
        Effect.runPromise
      )
    ).resolves.toEqual({
      grant_account_id: "grant-account",
      customer_account_id: "in-memory-account",
    });
    expect(verifiedTokens).toEqual([]);

    await expect(
      whoami.pipe(Effect.provide(authorization), Effect.runPromise)
    ).resolves.toMatchObject({ customer_account_id: "token-account" });
    expect(verifiedTokens).toEqual(["agent-token"]);
  });

  test("fails a read of an account service the test did not fake", async () => {
    verifiedTokens.length = 0;
    const error = await whoami.pipe(
      Effect.provide(
        Layer.merge(authorization, inMemoryCustomerAgentCallServices())
      ),
      Effect.flip,
      Effect.runPromise
    );

    expect(error.details).toEqual({ code: "reservations_unavailable" });
    expect(verifiedTokens).toEqual([]);
  });
});
