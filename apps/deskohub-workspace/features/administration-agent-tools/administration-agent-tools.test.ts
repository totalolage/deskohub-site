import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import {
  AdministrationAuthentication,
  AdministrationOperationBehavior,
  AdministrationOperationVariants,
  administrationOperations,
  CliOnly,
  destructiveOperation,
  readOperation,
  readPreview,
  WorkspaceAdminApi,
} from "@deskohub/workspace-admin-api";
import { AjvJsonSchemaValidator } from "@modelcontextprotocol/client/validators/ajv";
import { Schema, SchemaAST } from "effect";
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
} from "effect/unstable/httpapi";
import { publishedCustomerAgentTools } from "@/features/agent-tools/customer-agent-tools";
import {
  administrationOperationTools,
  deriveAdministrationOperationTools,
  makeAdministrationAgentTools,
} from "./administration-agent-tools";

const agentTools = makeAdministrationAgentTools(administrationOperationTools);

const inputJsonSchema = (name: string) => {
  const tool = agentTools.find((candidate) => candidate.name === name);
  if (tool === undefined) {
    throw new Error(`No tool ${name}.`);
  }
  return tool.input["~standard"].jsonSchema.input({
    target: "draft-2020-12",
  });
};

/** The top-level payload fields of every endpoint, by `<group>.<endpoint>`. */
const payloadFields = new Map<string, ReadonlySet<string>>();
HttpApi.reflect(WorkspaceAdminApi, {
  onGroup: () => undefined,
  onEndpoint: ({ group, endpoint }) => {
    const fields = [...endpoint.payload.values()]
      .flatMap(({ schemas }) => schemas)
      .flatMap(({ ast }) =>
        SchemaAST.isObjects(ast)
          ? ast.propertySignatures.map(({ name }) => String(name))
          : []
      );
    payloadFields.set(`${group.identifier}.${endpoint.name}`, new Set(fields));
  },
});

const ledgerKeys = ["requestId", "attemptId", "invoiceId"];

describe("administration agent tools", () => {
  test("serve every contract operation and variant except CLI-only ones, and nothing else", () => {
    const operations = administrationOperations(WorkspaceAdminApi);
    const served = operations
      .filter((entry) => entry.access._tag === "Operation")
      .map((entry) => entry.reference)
      .sort();

    expect(
      administrationOperationTools.map((tool) => tool.reference).sort()
    ).toEqual(served);
    expect(served.length).toBeGreaterThan(0);
    for (const entry of operations.filter(
      (candidate) => candidate.access._tag === "CliOnly"
    )) {
      expect(
        administrationOperationTools.some(
          (tool) => tool.operation === entry.reference
        )
      ).toBe(false);
    }
  });

  test("have unique, valid names that no customer tool uses", () => {
    const names = agentTools.map((tool) => tool.name);
    const customerNames = new Set(
      publishedCustomerAgentTools.map((tool) => tool.name)
    );

    expect(new Set(names).size).toBe(names.length);
    for (const name of names) {
      expect(name).toMatch(/^admin_[a-z0-9_]{1,58}$/);
      expect(customerNames.has(name)).toBe(false);
    }
  });

  test("take one strict object of arguments", () => {
    for (const tool of administrationOperationTools) {
      const schema = inputJsonSchema(tool.name);

      expect(schema).toMatchObject({
        type: "object",
        additionalProperties: false,
      });
      expect(Object.keys(schema.properties ?? {}).sort()).toEqual(
        [...tool.argumentNames].sort()
      );
    }
  });

  test("publish input and output schemas MCP clients can compile", () => {
    const validator = new AjvJsonSchemaValidator();
    for (const tool of agentTools) {
      for (const schema of [
        tool.input["~standard"].jsonSchema.input({ target: "draft-2020-12" }),
        tool.output["~standard"].jsonSchema.input({ target: "draft-2020-12" }),
      ]) {
        expect(() => validator.getValidator(schema)).not.toThrow();
      }
    }
  });

  test("ask for confirmation exactly on destructive operations", () => {
    for (const tool of administrationOperationTools) {
      expect(tool.argumentNames.has("confirm")).toBe(
        tool.behavior.kind === "destructive"
      );
      expect(tool.requiredArgumentNames.has("confirm")).toBe(false);
    }
  });

  test("require the change key of every operation on a mutation ledger", () => {
    for (const tool of administrationOperationTools) {
      const keys = ledgerKeys.filter((key) =>
        payloadFields.get(tool.operation)?.has(key)
      );
      for (const key of keys) {
        expect(tool.requiredArgumentNames.has(key)).toBe(true);
      }
    }
  });

  test("publish the contract's behavior as annotations", () => {
    for (const tool of agentTools) {
      const operation = administrationOperationTools.find(
        (candidate) => candidate.name === tool.name
      );

      expect(tool.access).toBe("administration");
      expect(tool.readOnly).toBe(operation?.behavior.kind === "read");
      expect(tool.destructive).toBe(operation?.behavior.kind === "destructive");
      expect(tool.idempotent).toBe(operation?.behavior.idempotent);
    }
  });
});

describe("administration agent tool derivation", () => {
  const Secret = Schema.String.annotate({ credential: true });
  const apiWith = (group: HttpApiGroup.Any) =>
    HttpApi.make("testApi").add(group);
  const authenticated = <Group extends HttpApiGroup.Any>(group: Group) =>
    group.middleware(AdministrationAuthentication);

  test("refuses an operation that returns a credential", () => {
    const api = apiWith(
      authenticated(
        HttpApiGroup.make("administration").add(
          HttpApiEndpoint.get("getSecret", "/secret", {
            success: Schema.Struct({ token: Secret }),
          }).annotate(AdministrationOperationBehavior, readOperation)
        )
      )
    );

    expect(() => deriveAdministrationOperationTools(api)).toThrow(
      /credentials/
    );
  });

  test("refuses a credential nested in an error", () => {
    const api = apiWith(
      authenticated(
        HttpApiGroup.make("administration").add(
          HttpApiEndpoint.get("getThing", "/thing", {
            success: Schema.Struct({ id: Schema.String }),
            error: Schema.Struct({ token: Secret }),
          }).annotate(AdministrationOperationBehavior, readOperation)
        )
      )
    );

    expect(() => deriveAdministrationOperationTools(api)).toThrow(
      /credentials/
    );
  });

  test("lets the contract's one disclosed credential through", () => {
    const api = apiWith(
      authenticated(
        HttpApiGroup.make("administration").add(
          HttpApiEndpoint.post("createStandaloneAccessCode", "/access-codes", {
            payload: Schema.Struct({ attemptId: Schema.String }),
            success: Schema.Struct({ pin: Secret }),
          }).annotate(
            AdministrationOperationBehavior,
            destructiveOperation({ idempotent: true })
          )
        )
      )
    );

    expect(
      deriveAdministrationOperationTools(api).map((tool) => tool.name)
    ).toEqual(["admin_create_standalone_access_code"]);
  });

  test("refuses an endpoint without an operation declaration", () => {
    const api = apiWith(
      HttpApiGroup.make("administration").add(
        HttpApiEndpoint.get("getThing", "/thing", {
          success: Schema.Struct({ id: Schema.String }),
        })
      )
    );

    expect(() => deriveAdministrationOperationTools(api)).toThrow(
      /declares no administration operation/
    );
  });

  test("skips CLI-only endpoints", () => {
    const api = apiWith(
      HttpApiGroup.make("cli").add(
        HttpApiEndpoint.get("getInfo", "/info", {
          success: Schema.Struct({ token: Secret }),
        }).annotate(CliOnly, { reason: "test" })
      )
    );

    expect(deriveAdministrationOperationTools(api)).toEqual([]);
  });

  test("refuses arguments that collide across the path, query and payload", () => {
    const api = apiWith(
      HttpApiGroup.make("administration").add(
        HttpApiEndpoint.post("updateThing", "/things/:id", {
          params: { id: Schema.String },
          payload: Schema.Struct({ id: Schema.String }),
          success: Schema.Struct({ id: Schema.String }),
        }).annotate(AdministrationOperationBehavior, readOperation)
      )
    );

    expect(() => deriveAdministrationOperationTools(api)).toThrow(
      /colliding arguments/
    );
  });

  test("refuses a preview the operation's arguments can't call", () => {
    const api = apiWith(
      HttpApiGroup.make("administration")
        .add(
          HttpApiEndpoint.get("getThing", "/things/:thingId", {
            params: { thingId: Schema.String },
            success: Schema.Struct({ id: Schema.String }),
          }).annotate(AdministrationOperationBehavior, readOperation)
        )
        .add(
          HttpApiEndpoint.post("deleteThing", "/things/:id/delete", {
            params: { id: Schema.String },
            success: Schema.Struct({ id: Schema.String }),
          }).annotate(
            AdministrationOperationBehavior,
            destructiveOperation({
              idempotent: true,
              preview: readPreview("administration.getThing"),
            })
          )
        )
    );

    expect(() => deriveAdministrationOperationTools(api)).toThrow(
      /can't preview/
    );
  });

  test("flattens each generic mutation variant into its own tool", () => {
    const Mutation = Schema.Union([
      Schema.Struct({ kind: Schema.Literal("create"), title: Schema.String }),
      Schema.Struct({ kind: Schema.Literal("delete"), id: Schema.String }),
    ]);
    const api = apiWith(
      HttpApiGroup.make("administration").add(
        HttpApiEndpoint.post("mutateThings", "/things/mutations", {
          payload: Schema.Struct({
            requestId: Schema.String,
            mutation: Mutation,
          }),
          success: Schema.Struct({ ok: Schema.Boolean }),
        }).annotate(AdministrationOperationVariants, {
          field: "mutation",
          discriminator: "kind",
          operations: {
            create: { kind: "write", idempotent: true },
            delete: { kind: "destructive", idempotent: true },
          },
        })
      )
    );

    const tools = deriveAdministrationOperationTools(api);

    expect(
      tools.map((tool) => ({
        name: tool.name,
        arguments: [...tool.argumentNames],
      }))
    ).toEqual([
      { name: "admin_things_create", arguments: ["requestId", "title"] },
      {
        name: "admin_things_delete",
        arguments: ["requestId", "id", "confirm"],
      },
    ]);
  });
});
