import "@/shared/testing/workspace-test-env";
import { describe, expect, test } from "bun:test";
import { Effect, Schema } from "effect";
import {
  agentToolLocaleField,
  defineAgentTool,
  defineSignedInAgentTool,
  getRequestedAgentToolLocale,
  selectAgentTools,
} from "./agent-tool";

const makeTool = (
  name: string,
  {
    access,
    readOnly,
  }: {
    readonly access: "public" | "signed-in";
    readonly readOnly: boolean;
  }
) => {
  const definition = {
    name,
    title: name,
    description: name,
    readOnly,
    unavailableCode: "quote_unavailable",
    input: Schema.Struct({
      seats: Schema.Int,
      locale: agentToolLocaleField,
    }),
    output: Schema.Struct({ seats: Schema.Int }),
    run: ({ seats }: { readonly seats: number }) =>
      seats < 0
        ? Effect.die(new Error("negative seats"))
        : Effect.succeed({ seats }),
  } as const;

  return access === "public"
    ? defineAgentTool({ ...definition, access })
    : defineSignedInAgentTool({ ...definition, scope: "reservations:read" });
};

const tools = [
  makeTool("public_read", { access: "public", readOnly: true }),
  makeTool("public_hold", { access: "public", readOnly: false }),
  makeTool("account_read", { access: "signed-in", readOnly: true }),
  makeTool("account_hold", { access: "signed-in", readOnly: false }),
];

describe("selectAgentTools", () => {
  test("publishes only the public read-only tools for an anonymous read surface", () => {
    expect(
      selectAgentTools(tools, { access: ["public"], transactional: false }).map(
        ({ name }) => name
      )
    ).toEqual(["public_read"]);
  });

  test("publishes signed-in reads without transactional tools", () => {
    expect(
      selectAgentTools(tools, {
        access: ["public", "signed-in"],
        transactional: false,
      }).map(({ name }) => name)
    ).toEqual(["public_read", "account_read"]);
  });

  test("publishes every tool of the allowed access when transactions are on", () => {
    expect(
      selectAgentTools(tools, {
        access: ["public", "signed-in"],
        transactional: true,
      }).map(({ name }) => name)
    ).toEqual(["public_read", "public_hold", "account_read", "account_hold"]);
  });
});

describe("defineAgentTool", () => {
  const [tool] = tools;

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
  test("reads a supported locale from raw arguments", () => {
    expect(getRequestedAgentToolLocale({ locale: "cs-CZ", seats: "x" })).toBe(
      "cs-CZ"
    );
  });

  test("falls back to English for missing or unsupported locales", () => {
    expect(getRequestedAgentToolLocale(undefined)).toBe("en-US");
    expect(getRequestedAgentToolLocale({ locale: "de-DE" })).toBe("en-US");
  });
});
