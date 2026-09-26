import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import * as JsonSchemaGenerator from "@effect/openapi-generator/JsonSchemaGenerator";
import * as OpenApiGenerator from "@effect/openapi-generator/OpenApiGenerator";
import { Effect, Schema } from "effect";
import type { OpenAPISpec } from "effect/unstable/httpapi/OpenApi";

const recursiveSpec = {
  openapi: "3.1.0",
  info: { title: "Recursive source fields", version: "1.0.0" },
  security: [],
  tags: [],
  paths: {
    "/fields": {
      get: {
        operationId: "getFields",
        parameters: [],
        security: [],
        tags: ["fields"],
        responses: {
          "200": {
            description: "Source fields",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/SourceFieldSelectConfig",
                },
              },
            },
          },
        },
      },
    },
  },
  components: {
    securitySchemes: {},
    schemas: {
      SourceFieldSelectConfig: {
        type: "object",
        required: ["options"],
        properties: {
          options: {
            type: "array",
            items: {
              $ref: "#/components/schemas/SourceFieldSelectConfigOption",
            },
          },
        },
      },
      SourceFieldSelectConfigOption: {
        type: "object",
        required: ["value"],
        properties: {
          value: { type: "string" },
          fields: {
            type: "array",
            items: { $ref: "#/components/schemas/SourceFieldSelectConfig" },
          },
        },
      },
    },
  },
} satisfies OpenAPISpec;

const mutualRecursionSpec = {
  openapi: "3.1.0",
  info: {
    title: "Mutually recursive source field select config",
    version: "1.0.0",
  },
  security: [],
  tags: [],
  paths: {
    "/root": {
      get: {
        operationId: "getRoot",
        parameters: [],
        security: [],
        tags: ["root"],
        responses: {
          "200": {
            description: "OK",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/RootWrapper" },
              },
            },
          },
        },
      },
    },
  },
  components: {
    securitySchemes: {},
    schemas: {
      SourceFieldSelectConfig: {
        type: "object",
        properties: {
          label: { type: "string" },
          options: {
            type: "array",
            items: {
              $ref: "#/components/schemas/SourceFieldSelectConfigOption",
            },
          },
          config: { $ref: "#/components/schemas/SourceFieldSelectConfig" },
        },
        required: ["label", "options"],
      },
      SourceFieldSelectConfigOption: {
        type: "object",
        properties: {
          value: { type: "string" },
          priority: { type: "number" },
          note: { type: ["string", "null"] },
          config: { $ref: "#/components/schemas/SourceFieldSelectConfig" },
        },
        required: ["value"],
      },
      RootWrapper: {
        type: "object",
        properties: {
          root: { $ref: "#/components/schemas/SourceFieldSelectConfig" },
        },
        required: ["root"],
      },
    },
  },
} satisfies OpenAPISpec;

const reverseOrderSpec = {
  openapi: "3.1.0",
  info: {
    title: "Mutually recursive schemas, option declared first",
    version: "1.0.0",
  },
  security: [],
  tags: [],
  paths: mutualRecursionSpec.paths,
  components: {
    securitySchemes: {},
    schemas: {
      SourceFieldSelectConfigOption:
        mutualRecursionSpec.components.schemas.SourceFieldSelectConfigOption,
      SourceFieldSelectConfig:
        mutualRecursionSpec.components.schemas.SourceFieldSelectConfig,
      RootWrapper: mutualRecursionSpec.components.schemas.RootWrapper,
    },
  },
} satisfies OpenAPISpec;

const mutualSpecsByOrder = {
  configFirst: mutualRecursionSpec,
  optionFirst: reverseOrderSpec,
} as const;

const recursiveUnionSpec = {
  openapi: "3.1.0",
  info: { title: "Recursive public union", version: "1.0.0" },
  security: [],
  tags: [],
  paths: {
    "/root": {
      get: {
        operationId: "getRoot",
        parameters: [],
        security: [],
        tags: ["root"],
        responses: {
          "200": {
            description: "OK",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/FilterGroup" },
              },
            },
          },
        },
      },
    },
  },
  components: {
    securitySchemes: {},
    schemas: {
      FilterValue: {
        oneOf: [
          { type: "string" },
          { $ref: "#/components/schemas/FilterGroup" },
        ],
      },
      FilterGroup: {
        type: "object",
        properties: {
          op: { type: "string" },
          values: {
            type: "array",
            items: { $ref: "#/components/schemas/FilterValue" },
          },
        },
        required: ["op", "values"],
      },
    },
  },
} satisfies OpenAPISpec;

const selfRecursiveSpec = {
  openapi: "3.1.0",
  info: { title: "Directly self-recursive tree node", version: "1.0.0" },
  security: [],
  tags: [],
  paths: {
    "/node": {
      get: {
        operationId: "getNode",
        parameters: [],
        security: [],
        tags: ["node"],
        responses: {
          "200": {
            description: "OK",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/TreeNode" },
              },
            },
          },
        },
      },
    },
  },
  components: {
    securitySchemes: {},
    schemas: {
      TreeNode: {
        type: "object",
        properties: {
          TreeNode: { type: "string" },
          value: { type: "string" },
          next: { $ref: "#/components/schemas/TreeNode" },
        },
        required: ["value"],
      },
    },
  },
} satisfies OpenAPISpec;

const collidingNamesSpec = {
  openapi: "3.1.0",
  info: {
    title: "Colliding sanitized component names with quoted recursive keys",
    version: "1.0.0",
  },
  security: [],
  tags: [],
  paths: {
    "/root": {
      get: {
        operationId: "getRoot",
        parameters: [],
        security: [],
        tags: ["root"],
        responses: {
          "200": {
            description: "OK",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Source_config" },
              },
            },
          },
        },
      },
    },
  },
  components: {
    securitySchemes: {},
    schemas: {
      Source_config: {
        type: "object",
        properties: {
          Source_config: { type: "string" },
          peer: { $ref: "#/components/schemas/source_config" },
        },
        required: ["peer"],
      },
      source_config: {
        type: "object",
        properties: {
          source_config: { type: ["string", "null"] },
          next: { $ref: "#/components/schemas/source_config" },
        },
        required: [],
      },
    },
  },
} satisfies OpenAPISpec;

const generateClient = (
  spec: OpenAPISpec,
  format: "httpclient" | "httpapi",
  name: string
): Promise<string> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const generator = yield* OpenApiGenerator.OpenApiGenerator;
      return yield* generator.generate(spec, {
        format,
        name,
      });
    }).pipe(Effect.provide(OpenApiGenerator.layerTransformerSchema))
  );

const tempRoot = mkdtempSync(join(import.meta.dir, ".tmp-generate-test-"));

afterAll(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

const writeAndImport = async (fileName: string, source: string) => {
  const filePath = join(tempRoot, fileName);
  await Bun.write(filePath, source);
  return import(pathToFileURL(filePath).href);
};

const expectDecodeEncodeRoundTrip = (
  schema: Schema.Codec<unknown>,
  value: unknown
): void => {
  const decode = Schema.decodeUnknownSync(schema);
  const decoded = decode(value);
  expect(decoded).toEqual(value);
  const encoded = Schema.encodeSync(schema)(decoded);
  expect(encoded).toEqual(value);
  expect(JSON.parse(JSON.stringify(encoded))).toEqual(value);
};

const mutualValidRoot = {
  root: {
    label: "Region",
    options: [
      {
        value: "eu",
        priority: 2.5,
        note: null,
        config: { label: "Sub region", options: [] },
      },
    ],
  },
};

const unionValidGroup = {
  op: "and",
  values: ["eu", { op: "or", values: ["us"] }],
};

const selfValidNode = {
  TreeNode: "tag",
  value: "head",
  next: { value: "tail" },
};

test.each(["httpclient", "httpapi"] as const)(
  "generated %s mutually recursive schemas initialize and validate nested fields",
  async (format) => {
    const source = await generateClient(
      recursiveSpec,
      format,
      `RecursiveClient_${format}`
    );
    const generated = await writeAndImport(`recursive-${format}.ts`, source);
    const decode = Schema.decodeUnknownSync(generated.SourceFieldSelectConfig);
    const value = {
      options: [
        { value: "outer", fields: [{ options: [{ value: "inner" }] }] },
      ],
    };
    expect(decode(value)).toEqual(value);
    expect(() =>
      decode({
        options: [{ value: "outer", fields: [{ options: [{ value: 1 }] }] }],
      })
    ).toThrow();
    const decodeOption = Schema.decodeUnknownSync(
      generated.SourceFieldSelectConfigOption
    );
    expect(decodeOption(value.options[0])).toEqual(value.options[0]);
    expect(() =>
      decodeOption({ value: "outer", fields: [{ options: "invalid" }] })
    ).toThrow();
  }
);

test.each(["httpclient", "httpapi"] as const)(
  "%s mutual recursion exposes literal public struct fields",
  async (format) => {
    const source = await generateClient(
      mutualRecursionSpec,
      format,
      `MutualFieldsClient_${format}`
    );
    const generated = await writeAndImport(
      `mutual-fields-${format}.ts`,
      source
    );

    expect(Object.keys(generated.SourceFieldSelectConfig.fields)).toEqual([
      "label",
      "options",
      "config",
    ]);
    expect(Object.keys(generated.SourceFieldSelectConfigOption.fields)).toEqual(
      ["value", "priority", "note", "config"]
    );
    expect(Object.keys(generated.RootWrapper.fields)).toEqual(["root"]);
  }
);

test.each(["httpclient", "httpapi"] as const)(
  "%s config-first mutual recursion round-trips nested values",
  async (format) => {
    const source = await generateClient(
      mutualSpecsByOrder.configFirst,
      format,
      `MutualConfigFirstClient_${format}`
    );
    const generated = await writeAndImport(
      `mutual-config-first-${format}.ts`,
      source
    );

    const decodeRoot = Schema.decodeUnknownSync(generated.RootWrapper);
    const decoded = decodeRoot(mutualValidRoot);
    expect(decoded).toEqual(mutualValidRoot);
    expect(Schema.encodeSync(generated.RootWrapper)(decoded)).toEqual(
      mutualValidRoot
    );

    const decodeConfig = Schema.decodeUnknownSync(
      generated.SourceFieldSelectConfig
    );
    const absentNullable = {
      label: "Region",
      options: [
        {
          value: "eu",
          config: { label: "Sub", options: [] },
        },
      ],
    };
    expectDecodeEncodeRoundTrip(
      generated.SourceFieldSelectConfig,
      absentNullable
    );

    expect(() =>
      decodeRoot({
        root: { label: "Region", options: [{ value: 42 }] },
      })
    ).toThrow();
    expect(() =>
      decodeConfig({
        label: "Region",
        options: [{ value: "eu", config: { label: 7, options: [] } }],
      })
    ).toThrow();
    expect(() =>
      decodeRoot({
        root: {
          label: "Region",
          options: [{ value: "eu", note: 0 }],
        },
      })
    ).toThrow();
  }
);

test.each(["httpclient", "httpapi"] as const)(
  "%s option-first mutual recursion round-trips nested values",
  async (format) => {
    const source = await generateClient(
      mutualSpecsByOrder.optionFirst,
      format,
      `MutualOptionFirstClient_${format}`
    );
    const generated = await writeAndImport(
      `mutual-option-first-${format}.ts`,
      source
    );

    const decodeRoot = Schema.decodeUnknownSync(generated.RootWrapper);
    const decoded = decodeRoot(mutualValidRoot);
    expect(decoded).toEqual(mutualValidRoot);
    expect(Schema.encodeSync(generated.RootWrapper)(decoded)).toEqual(
      mutualValidRoot
    );

    const decodeOption = Schema.decodeUnknownSync(
      generated.SourceFieldSelectConfigOption
    );
    const nullableOption = { value: "eu", note: null };
    expectDecodeEncodeRoundTrip(
      generated.SourceFieldSelectConfigOption,
      nullableOption
    );
    expect(() => decodeOption({ value: "eu", note: 0 })).toThrow();
    expect(() => decodeRoot({ root: { label: 42, options: [] } })).toThrow();
  }
);

test.each(["httpclient", "httpapi"] as const)(
  "generated %s recursive public union keeps .members and decodes and encodes nested values",
  async (format) => {
    const source = await generateClient(
      recursiveUnionSpec,
      format,
      `UnionClient_${format}`
    );
    const generated = await writeAndImport(`union-${format}.ts`, source);

    expect(generated.FilterValue.members).toHaveLength(2);
    expect(Object.keys(generated.FilterGroup.fields)).toEqual(["op", "values"]);

    expectDecodeEncodeRoundTrip(generated.FilterGroup, unionValidGroup);
    const decodeGroup = Schema.decodeUnknownSync(generated.FilterGroup);
    expect(() => decodeGroup({ op: "and", values: [42] })).toThrow();
    expect(() =>
      decodeGroup({ op: "and", values: [{ op: 7, values: [] }] })
    ).toThrow();

    const decodeValue = Schema.decodeUnknownSync(generated.FilterValue);
    expect(decodeValue("eu")).toBe("eu");
    expect(decodeValue({ op: "or", values: ["nested"] })).toEqual({
      op: "or",
      values: ["nested"],
    });
    expect(
      Schema.encodeSync(generated.FilterValue)({ op: "or", values: [] })
    ).toEqual({
      op: "or",
      values: [],
    });
    expect(() => decodeValue(true)).toThrow();
  }
);

test.each(["httpclient", "httpapi"] as const)(
  "generated %s self-recursive schema keeps public fields and round-trips nested nodes",
  async (format) => {
    const source = await generateClient(
      selfRecursiveSpec,
      format,
      `SelfClient_${format}`
    );
    const generated = await writeAndImport(`self-${format}.ts`, source);

    expect(Object.keys(generated.TreeNode.fields)).toEqual([
      "TreeNode",
      "value",
      "next",
    ]);

    expectDecodeEncodeRoundTrip(generated.TreeNode, selfValidNode);
    const decodeNode = Schema.decodeUnknownSync(generated.TreeNode);
    expect(decodeNode({ value: "leaf" })).toEqual({ value: "leaf" });
    expect(() => decodeNode({ value: 1 })).toThrow();
    expect(() => decodeNode({ value: "a", next: { value: null } })).toThrow();
    expect(() => decodeNode({ TreeNode: 7, value: "a" })).toThrow();
  }
);

test.each(["httpclient", "httpapi"] as const)(
  "generated %s colliding sanitized names and quoted recursive keys stay structurally correct",
  async (format) => {
    const source = await generateClient(
      collidingNamesSpec,
      format,
      `CollisionClient_${format}`
    );
    const generated = await writeAndImport(`collision-${format}.ts`, source);

    // `Source_config` and `source_config` sanitize to the same identifier, so
    // the second recursive definition must be emitted under a fresh binding
    // (`Source_config1`) with every structural reference rewired to it, while
    // quoted property keys spelled exactly like the recursive names stay data
    // keys instead of being rewritten as identifier substitutions.
    expect(Object.keys(generated.Source_config.fields)).toEqual([
      "Source_config",
      "peer",
    ]);
    expect(Object.keys(generated.Source_config1.fields)).toEqual([
      "source_config",
      "next",
    ]);

    const decodeWrapper = Schema.decodeUnknownSync(generated.Source_config);
    const wrapperValue = {
      Source_config: "key equals schema name",
      peer: { source_config: null, next: { next: {} } },
    };
    expectDecodeEncodeRoundTrip(generated.Source_config, wrapperValue);
    expect(() =>
      decodeWrapper({
        peer: { source_config: 5, next: {} },
      })
    ).toThrow();
    expect(() =>
      decodeWrapper({
        peer: { source_config: null, next: { next: "not an object" } },
      })
    ).toThrow();

    expectDecodeEncodeRoundTrip(generated.Source_config1, {
      source_config: null,
      next: { next: { source_config: "deep" } },
    });
  }
);

test("typeOnly generation emits the same type aliases as runtime generation", () => {
  const generateTypeAliases = (typeOnly: boolean): string[] => {
    const generator = JsonSchemaGenerator.make();
    for (const [$ref, schema] of Object.entries(
      mutualRecursionSpec.components.schemas
    )) {
      generator.addSchema($ref, schema);
    }
    const source = generator.generate(
      "openapi-3.1",
      mutualRecursionSpec.components.schemas,
      typeOnly
    );
    return source
      .split("\n")
      .filter((line) => line.startsWith("export type "))
      .map((line) => line.trim())
      .sort();
  };

  const runtimeAliases = generateTypeAliases(false);
  const typeOnlyAliases = generateTypeAliases(true);

  expect(typeOnlyAliases.length).toBeGreaterThan(0);
  expect(typeOnlyAliases).toEqual(runtimeAliases);
});
