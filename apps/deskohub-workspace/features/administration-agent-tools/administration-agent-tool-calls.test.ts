import "@/shared/testing/workspace-test-env";

import { beforeEach, describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import {
  AdministrationOperationBehavior,
  AdministrationOperationVariants,
  CliMutationRejected,
  destructiveOperation,
  dryRunPreview,
  readOperation,
  readPreview,
  writeOperation,
} from "@deskohub/workspace-admin-api";
import { NodeHttpServer } from "@effect/platform-node";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/client/validators/ajv";
import { Effect, Layer, Option, Schema } from "effect";
import { FetchHttpClient, HttpRouter } from "effect/unstable/http";
import {
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
} from "effect/unstable/httpapi";
import { AdministratorAgentAuthorization } from "@/features/administrators/backend/administrator-agent-authorization.service";
import { AgentToolReply } from "@/features/agent-tools/agent-tool";
import type { CustomerAgentCaller } from "@/features/agent-tools/customer-agent-caller";
import {
  deriveAdministrationOperationTools,
  makeAdministrationAgentTools,
} from "./administration-agent-tools";
import {
  AdministrationApiClient,
  AdministrationApiTransport,
} from "./administration-api-client";

const Reservation = Schema.Struct({
  id: Schema.String,
  status: Schema.String,
});

const Mutation = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("rename"), title: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("delete"), id: Schema.String }),
]);

const TestApi = HttpApi.make("testApi").add(
  HttpApiGroup.make("administration")
    .add(
      HttpApiEndpoint.get("getReservation", "/reservations/:reservationId", {
        params: { reservationId: Schema.String },
        success: Reservation,
      }).annotate(AdministrationOperationBehavior, readOperation)
    )
    .add(
      HttpApiEndpoint.get("listReservations", "/reservations", {
        success: Schema.Array(Reservation),
      }).annotate(AdministrationOperationBehavior, readOperation)
    )
    .add(
      HttpApiEndpoint.post(
        "cancelReservation",
        "/reservations/:reservationId/cancellation",
        {
          params: { reservationId: Schema.String },
          payload: Schema.Struct({ sendEmail: Schema.Boolean }),
          success: Schema.Struct({ outcome: Schema.String }),
          error: CliMutationRejected.schema,
        }
      ).annotate(
        AdministrationOperationBehavior,
        destructiveOperation({
          idempotent: false,
          preview: readPreview("administration.getReservation"),
        })
      )
    )
    .add(
      HttpApiEndpoint.post("backfill", "/backfill", {
        payload: Schema.Struct({ dryRun: Schema.Boolean }),
        success: Schema.Struct({ changed: Schema.Number }),
      }).annotate(
        AdministrationOperationBehavior,
        destructiveOperation({ idempotent: true, preview: dryRunPreview })
      )
    )
    .add(
      HttpApiEndpoint.post("mutateThings", "/things/mutations", {
        payload: Schema.Struct({
          requestId: Schema.String,
          mutation: Mutation,
        }),
        success: Schema.Struct({ applied: Schema.String }),
      }).annotate(AdministrationOperationVariants, {
        field: "mutation",
        discriminator: "kind",
        operations: {
          rename: writeOperation({ idempotent: true }),
          delete: destructiveOperation({ idempotent: true }),
        },
      })
    )
    .add(
      HttpApiEndpoint.post("issueCode", "/codes", {
        payload: Schema.Struct({ attemptId: Schema.String }),
        success: Schema.Union([
          Schema.Struct({
            outcome: Schema.Literal("created"),
            code: Schema.String,
          }),
          Schema.Struct({ outcome: Schema.Literal("already-created") }),
        ]),
      }).annotate(
        AdministrationOperationBehavior,
        writeOperation({ idempotent: true })
      )
    )
    .add(
      HttpApiEndpoint.get("getDocument", "/documents/:documentId", {
        params: { documentId: Schema.String },
        success: Schema.Uint8Array.pipe(
          HttpApiSchema.asUint8Array({ contentType: "application/pdf" })
        ),
      }).annotate(AdministrationOperationBehavior, readOperation)
    )
);

/** The requests the test API served, by operation, in order. */
let served: Array<{
  readonly operation: string;
  readonly body: Schema.Json;
}> = [];
let authorizations: Array<string | null> = [];
let authorizedPaths: Array<{
  readonly path: string;
  readonly authorization: string | null;
}> = [];

const record = (operation: string, body: Schema.Json = null) =>
  Effect.sync(() => {
    served.push({ operation, body });
  });

const handleTestRequest = HttpRouter.toWebHandler(
  HttpApiBuilder.layer(TestApi).pipe(
    Layer.provide(
      HttpApiBuilder.group(TestApi, "administration", (handlers) =>
        handlers
          .handle("getReservation", ({ params }) =>
            record("getReservation").pipe(
              Effect.as({ id: params.reservationId, status: "confirmed" })
            )
          )
          .handle("listReservations", () =>
            record("listReservations").pipe(
              Effect.as([{ id: "r-1", status: "confirmed" }])
            )
          )
          .handle("cancelReservation", ({ params, payload }) =>
            record("cancelReservation", payload).pipe(
              Effect.andThen(
                params.reservationId === "locked"
                  ? Effect.fail(
                      new CliMutationRejected({
                        message: "The reservation is locked.",
                        code: "reservation-locked",
                      })
                    )
                  : Effect.succeed({ outcome: "cancelled" })
              )
            )
          )
          .handle("backfill", ({ payload }) =>
            record("backfill", payload).pipe(
              Effect.as({ changed: payload.dryRun ? 0 : 3 })
            )
          )
          .handle("mutateThings", ({ payload }) =>
            record("mutateThings", payload).pipe(
              Effect.as({ applied: payload.mutation.kind })
            )
          )
          .handle("issueCode", () =>
            record("issueCode").pipe(
              Effect.as({ outcome: "created" as const, code: "synthetic" })
            )
          )
          .handle("getDocument", () =>
            record("getDocument").pipe(
              Effect.as(new TextEncoder().encode("%PDF-1.7 synthetic"))
            )
          )
      )
    ),
    Layer.provide(NodeHttpServer.layerHttpServices)
  ),
  { disableLogger: true }
).handler;

const transport = (request: Request) => {
  authorizations.push(request.headers.get("authorization"));
  authorizedPaths.push({
    path: new URL(request.url).pathname,
    authorization: request.headers.get("authorization"),
  });
  return handleTestRequest(request);
};

const tools = makeAdministrationAgentTools(
  deriveAdministrationOperationTools(TestApi)
);

const caller: CustomerAgentCaller = {
  accessToken: "synthetic-agent-token",
  grant: {
    accountId: "synthetic-account" as CustomerAgentCaller["grant"]["accountId"],
    clientId: "https://agent.example/client.json",
    scopes: new Set(["administration"]),
  },
};

/**
 * The administrator grant each call checks first: held, ended since the
 * tools were listed, or impossible to check.
 */
let grant: "live" | "ended" | "unavailable" = "live";
let grantChecks: Array<string> = [];

const administratorAuthorization = Layer.succeed(
  AdministratorAgentAuthorization,
  {
    authorize: ({ accessToken }) =>
      Effect.suspend(() => {
        grantChecks.push(accessToken);
        return grant === "live"
          ? Effect.succeed({
              accountId: caller.grant.accountId,
              email: testEmailAddress("administration-tool-caller"),
            } as never)
          : Effect.fail({
              _tag: "AdministratorAgentAuthorizationError",
              reason: grant === "ended" ? "not-administrator" : "unavailable",
            } as never);
      }),
  }
);

/** The services a tool call runs with: the grant check and the test API. */
const toolServices = Layer.mergeAll(
  administratorAuthorization,
  AdministrationApiClient.forApi(TestApi).pipe(
    Layer.provide(Layer.succeed(AdministrationApiTransport, transport))
  )
);

const callTool = (name: string, args: Schema.Json) => {
  const tool = tools.find((candidate) => candidate.name === name);
  if (tool === undefined) {
    throw new Error(`No tool ${name}.`);
  }
  return tool
    .call(args, Option.some(caller))
    .pipe(Effect.provide(toolServices), Effect.result, Effect.runPromise);
};

const resultOf = (reply: AgentToolReply | Schema.JsonObject | false) =>
  reply instanceof AgentToolReply ? reply.result : reply;

beforeEach(() => {
  grant = "live";
  grantChecks = [];
  served = [];
  authorizations = [];
  authorizedPaths = [];
});

describe("administration agent tool calls", () => {
  test("call the operation with the agent's token and answer its result", async () => {
    const result = await callTool("admin_get_reservation", {
      reservationId: "r-1",
    });

    expect(result._tag).toBe("Success");
    expect(resultOf(result._tag === "Success" && result.success)).toEqual({
      id: "r-1",
      status: "confirmed",
    });
    expect(authorizations).toEqual(["Bearer synthetic-agent-token"]);
  });

  test("answer a union of objects as it is, as its published schema describes", async () => {
    const result = await callTool("admin_issue_code", {
      attemptId: "0190a5c4-0000-7000-8000-000000000002",
    });
    const reply = resultOf(result._tag === "Success" && result.success);
    const tool = tools.find(({ name }) => name === "admin_issue_code");

    expect(reply).toEqual({ outcome: "created", code: "synthetic" });
    expect(
      new AjvJsonSchemaValidator().getValidator(
        tool!.output["~standard"].jsonSchema.input({ target: "draft-2020-12" })
      )(reply)
    ).toMatchObject({ valid: true });
  });

  test("send concurrent calls through one client, each with its own caller's token", async () => {
    const tool = tools.find(({ name }) => name === "admin_get_reservation");
    const tokens = ["token-a", "token-b", "token-c", "token-d"];

    await Effect.all(
      tokens.map((token) =>
        tool!.call(
          { reservationId: token },
          Option.some({ ...caller, accessToken: token })
        )
      ),
      { concurrency: "unbounded" }
    ).pipe(Effect.provide(toolServices), Effect.runPromise);

    expect(
      [...authorizedPaths].sort((left, right) =>
        left.path.localeCompare(right.path)
      )
    ).toEqual(
      tokens.map((token) => ({
        path: `/reservations/${token}`,
        authorization: `Bearer ${token}`,
      }))
    );
  });

  test("keep every request in process when the fetch client was built elsewhere first", async () => {
    const tool = tools.find(({ name }) => name === "admin_cancel_reservation");

    const result = await Effect.scoped(
      Effect.gen(function* () {
        // The Workspace memo map shares the fetch client layer: another
        // feature may have built it before, with the global fetch.
        const memoMap = yield* Layer.makeMemoMap;
        const scope = yield* Effect.scope;
        yield* Layer.buildWithMemoMap(FetchHttpClient.layer, memoMap, scope);
        const built = yield* Layer.buildWithMemoMap(
          AdministrationApiClient.forApi(TestApi).pipe(
            Layer.provide(Layer.succeed(AdministrationApiTransport, transport))
          ),
          memoMap,
          scope
        );
        return yield* tool!
          .call({ reservationId: "r-1", sendEmail: true }, Option.some(caller))
          .pipe(
            Effect.provideContext(built),
            Effect.provide(administratorAuthorization),
            Effect.result
          );
      })
    ).pipe(Effect.runPromise);

    expect(resultOf(result._tag === "Success" && result.success)).toMatchObject(
      { outcome: "confirmation-required" }
    );
    expect(authorizations).toEqual(["Bearer synthetic-agent-token"]);
  });

  test("answer a list as items", async () => {
    const result = await callTool("admin_list_reservations", {});

    expect(resultOf(result._tag === "Success" && result.success)).toEqual({
      items: [{ id: "r-1", status: "confirmed" }],
    });
  });

  test("preview a destructive operation without confirm and change nothing", async () => {
    const result = await callTool("admin_cancel_reservation", {
      reservationId: "r-1",
      sendEmail: true,
    });

    expect(resultOf(result._tag === "Success" && result.success)).toEqual({
      outcome: "confirmation-required",
      operation: "admin_cancel_reservation",
      input: { reservationId: "r-1", sendEmail: true },
      current: {
        "administration.getReservation": { id: "r-1", status: "confirmed" },
      },
    });
    expect(served.map(({ operation }) => operation)).toEqual([
      "getReservation",
    ]);
  });

  test("treat confirm: false like no confirmation", async () => {
    await callTool("admin_cancel_reservation", {
      reservationId: "r-1",
      sendEmail: true,
      confirm: false,
    });

    expect(served.map(({ operation }) => operation)).toEqual([
      "getReservation",
    ]);
  });

  test("apply a destructive operation with confirm: true", async () => {
    const result = await callTool("admin_cancel_reservation", {
      reservationId: "r-1",
      sendEmail: false,
      confirm: true,
    });

    expect(resultOf(result._tag === "Success" && result.success)).toEqual({
      outcome: "applied",
      result: { outcome: "cancelled" },
    });
    expect(served).toEqual([
      { operation: "cancelReservation", body: { sendEmail: false } },
    ]);
  });

  test("preview a dry-run operation with a dry run", async () => {
    const result = await callTool("admin_backfill", { dryRun: false });

    expect(resultOf(result._tag === "Success" && result.success)).toEqual({
      outcome: "confirmation-required",
      operation: "admin_backfill",
      input: { dryRun: false },
      dryRun: { changed: 0 },
    });
    expect(served).toEqual([{ operation: "backfill", body: { dryRun: true } }]);
  });

  test("run an explicit dry run without confirmation", async () => {
    const result = await callTool("admin_backfill", { dryRun: true });

    expect(resultOf(result._tag === "Success" && result.success)).toEqual({
      outcome: "dry-run",
      result: { changed: 0 },
    });
  });

  test("rebuild a generic mutation from a variant's arguments", async () => {
    const result = await callTool("admin_things_rename", {
      requestId: "0190a5c4-0000-7000-8000-000000000001",
      title: "Renamed",
    });

    expect(resultOf(result._tag === "Success" && result.success)).toEqual({
      applied: "rename",
    });
    expect(served).toEqual([
      {
        operation: "mutateThings",
        body: {
          requestId: "0190a5c4-0000-7000-8000-000000000001",
          mutation: { kind: "rename", title: "Renamed" },
        },
      },
    ]);
  });

  test("refuse a variant's discriminator as an argument", async () => {
    const result = await callTool("admin_things_rename", {
      requestId: "0190a5c4-0000-7000-8000-000000000001",
      title: "Renamed",
      kind: "delete",
    });

    expect(result._tag === "Failure" && result.failure.details).toEqual({
      code: "invalid_input",
      field: "kind",
    });
    expect(served).toEqual([]);
  });

  test("refuse unknown and invalid arguments before anything runs", async () => {
    const unknown = await callTool("admin_cancel_reservation", {
      reservationId: "r-1",
      sendEmail: true,
      confirm: true,
      actor: testEmailAddress("administration-tool-actor"),
    });
    const invalid = await callTool("admin_cancel_reservation", {
      reservationId: "r-1",
      sendEmail: "yes",
    });

    expect(unknown._tag === "Failure" && unknown.failure.details).toEqual({
      code: "invalid_input",
      field: "actor",
    });
    expect(invalid._tag === "Failure" && invalid.failure.details).toEqual({
      code: "invalid_input",
      field: "sendEmail",
    });
    expect(served).toEqual([]);
  });

  test("answer a typed operation error as an administration error", async () => {
    const result = await callTool("admin_cancel_reservation", {
      reservationId: "locked",
      sendEmail: false,
      confirm: true,
    });

    expect(result._tag === "Failure" && result.failure.details).toEqual({
      code: "administration_failed",
      error: {
        _tag: "CliMutationRejected",
        message: "The reservation is locked.",
        code: "reservation-locked",
      },
    });
  });

  test("attach a binary result as an embedded document", async () => {
    const result = await callTool("admin_get_document", { documentId: "d-1" });
    const reply = result._tag === "Success" ? result.success : undefined;

    expect(reply).toBeInstanceOf(AgentToolReply);
    expect(reply instanceof AgentToolReply && reply.result).toMatchObject({
      mimeType: "application/pdf",
      byteLength: 18,
    });
    expect(
      reply instanceof AgentToolReply &&
        reply.attachments.map(({ mimeType, blob }) => ({
          mimeType,
          text: Buffer.from(blob, "base64").toString(),
        }))
    ).toEqual([{ mimeType: "application/pdf", text: "%PDF-1.7 synthetic" }]);
  });

  test("refuse a call without a verified caller", async () => {
    const tool = tools.find(
      (candidate) => candidate.name === "admin_get_reservation"
    );
    const result = await tool!
      .call({ reservationId: "r-1" })
      .pipe(Effect.provide(toolServices), Effect.result, Effect.runPromise);

    expect(result._tag).toBe("Failure");
    expect(authorizations).toEqual([]);
  });

  test.each([
    [
      "a preview that reads nothing",
      "admin_things_delete",
      { requestId: "q-1", id: "t-1" },
    ],
    ["a dry-run preview", "admin_backfill", { dryRun: false }],
    ["a read", "admin_get_reservation", { reservationId: "r-1" }],
    [
      "invalid arguments",
      "admin_cancel_reservation",
      { reservationId: "r-1", sendEmail: "yes" },
    ],
  ] as const)(
    "refuse %s once the administrator grant ended, before anything runs",
    async (_, name, args) => {
      grant = "ended";

      const result = await callTool(name, args);

      expect(result._tag === "Failure" && result.failure.details).toEqual({
        code: "administration_failed",
        error: {
          _tag: "CliSessionUnauthorized",
          message: expect.any(String),
        },
      });
      expect(grantChecks).toEqual(["synthetic-agent-token"]);
      expect(served).toEqual([]);
      expect(authorizations).toEqual([]);
    }
  );

  test("answer a grant that can't be checked as unavailable, running nothing", async () => {
    grant = "unavailable";

    const result = await callTool("admin_things_delete", {
      requestId: "q-1",
      id: "t-1",
    });

    expect(result._tag === "Failure" && result.failure.details).toEqual({
      code: "administration_unavailable",
    });
    expect(served).toEqual([]);
  });
});
