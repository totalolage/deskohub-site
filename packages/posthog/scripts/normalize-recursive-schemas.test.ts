import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import * as OpenApiGenerator from "@effect/openapi-generator/OpenApiGenerator";
import { Effect, Schema } from "effect";
import { normalizeRecursiveSchemas } from "./normalize-recursive-schemas";

const mutualRecursionSpec = {
  openapi: "3.1.0",
  info: {
    title: "Mutually recursive source field select config",
    version: "1.0.0",
  },
  paths: {
    "/root": {
      get: {
        operationId: "getRoot",
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
} as const;

const reverseOrderSpec = {
  openapi: "3.1.0",
  info: {
    title: "Mutually recursive schemas, option declared first",
    version: "1.0.0",
  },
  paths: mutualRecursionSpec.paths,
  components: {
    schemas: {
      SourceFieldSelectConfigOption:
        mutualRecursionSpec.components.schemas.SourceFieldSelectConfigOption,
      SourceFieldSelectConfig:
        mutualRecursionSpec.components.schemas.SourceFieldSelectConfig,
      RootWrapper: mutualRecursionSpec.components.schemas.RootWrapper,
    },
  },
} as const;

const selfRecursiveSpec = {
  openapi: "3.1.0",
  info: { title: "Directly self-recursive tree node", version: "1.0.0" },
  paths: {
    "/node": {
      get: {
        operationId: "getNode",
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
    schemas: {
      TreeNode: {
        type: "object",
        properties: {
          value: { type: "string" },
          next: { $ref: "#/components/schemas/TreeNode" },
        },
        required: ["value"],
      },
    },
  },
} as const;

const noRecursionSpec = {
  openapi: "3.1.0",
  info: { title: "Flat schemas without recursion", version: "1.0.0" },
  paths: {
    "/flat": {
      get: {
        operationId: "getFlat",
        responses: {
          "200": {
            description: "OK",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Flat" },
              },
            },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      Flat: {
        type: "object",
        properties: { name: { type: "string" } },
        required: ["name"],
      },
    },
  },
} as const;

const generateClient = (spec: object, name: string): Promise<string> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const generator = yield* OpenApiGenerator.OpenApiGenerator;
      return yield* generator.generate(spec as never, {
        format: "httpclient",
        name,
      });
    }).pipe(Effect.provide(OpenApiGenerator.layerTransformerSchema))
  );

const tempRoot = mkdtempSync(
  join(import.meta.dir, ".tmp-normalize-recursive-schemas-")
);

afterAll(() => {
  rmSync(tempRoot, { recursive: true, force: true });
});

const writeAndImport = async (fileName: string, source: string) => {
  const filePath = join(tempRoot, fileName);
  await Bun.write(filePath, source);
  return import(pathToFileURL(filePath).href);
};

const normalize = (source: string): string =>
  Effect.runSync(normalizeRecursiveSchemas(source));

const normalizationFailure = async (source: string) => {
  const error = await Effect.runPromise(
    Effect.flip(normalizeRecursiveSchemas(source))
  );
  expect(error._tag).toBe("GeneratedClientNormalizationError");
  return error;
};

const recursiveUnionSpec = {
  openapi: "3.1.0",
  info: { title: "Recursive public union", version: "1.0.0" },
  paths: {
    "/root": {
      get: {
        operationId: "getRoot",
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
} as const;

const validGroup = {
  op: "and",
  values: ["eu", { op: "or", values: ["us"] }],
};

const validRoot = {
  root: {
    label: "Region",
    options: [
      {
        value: "eu",
        priority: 2.5,
        config: { label: "Sub region", options: [] },
      },
    ],
  },
};

describe("normalizeRecursiveSchemas against the pinned OpenApiGenerator", () => {
  test("raw mutual recursion fails at import and normalization makes it usable", async () => {
    const raw = await generateClient(mutualRecursionSpec, "MutualClient");

    expect(raw).toContain("// recursive declarations");
    expect(raw).toContain("const __recursive_SourceFieldSelectConfig =");
    expect(raw).toContain("// recursive definitions");
    expect(raw).toContain("// schemas");

    const eagerReferenceAt = raw.indexOf(
      '"options": Schema.Array(SourceFieldSelectConfigOption)'
    );
    const optionDeclarationAt = raw.indexOf(
      "export const SourceFieldSelectConfigOption ="
    );
    expect(eagerReferenceAt).toBeGreaterThan(-1);
    expect(eagerReferenceAt).toBeLessThan(optionDeclarationAt);

    let rawImportError: unknown;
    try {
      await writeAndImport("mutual-raw.ts", raw);
    } catch (error) {
      rawImportError = error;
    }
    expect(rawImportError).toBeInstanceOf(ReferenceError);
    expect((rawImportError as ReferenceError).message).toContain(
      "SourceFieldSelectConfigOption"
    );

    const normalized = normalize(raw);
    expect(normalize(normalized)).toBe(normalized);
    expect(normalized).toContain(
      '"options": Schema.Array(Schema.suspend((): Schema.Codec<SourceFieldSelectConfigOption> => SourceFieldSelectConfigOption))'
    );
    expect(normalized).toContain(
      'export const RootWrapper = Schema.Struct({ "root": SourceFieldSelectConfig })'
    );

    const normalizedModule = await writeAndImport(
      "mutual-normalized.ts",
      normalized
    );
    expect(
      Object.keys(normalizedModule.SourceFieldSelectConfigOption.fields)
    ).toEqual(["value", "priority", "config"]);
    expect(Object.keys(normalizedModule.RootWrapper.fields)).toEqual(["root"]);
    const decodeRoot = Schema.decodeUnknownSync(normalizedModule.RootWrapper);
    const decoded = decodeRoot(validRoot);
    expect(decoded).toEqual(validRoot);
    const invalidRoot = {
      root: { label: "Region", options: [{ value: 42 }] },
    };
    expect(() => decodeRoot(invalidRoot)).toThrow();
    expect(Schema.encodeSync(normalizedModule.RootWrapper)(decoded)).toEqual(
      validRoot
    );
    expect(normalizedModule.GetRoot200).toBeDefined();
  });

  test("reverse component ordering normalizes to an importable client", async () => {
    const raw = await generateClient(reverseOrderSpec, "ReverseOrderClient");
    const normalized = normalize(raw);
    expect(normalize(normalized)).toBe(normalized);
    expect(normalized).toContain(
      '"options": Schema.Array(Schema.suspend((): Schema.Codec<SourceFieldSelectConfigOption> => SourceFieldSelectConfigOption))'
    );

    const module_ = await writeAndImport("reverse-normalized.ts", normalized);
    expect(Schema.decodeUnknownSync(module_.RootWrapper)(validRoot)).toEqual(
      validRoot
    );
  });

  test("recursive public Union keeps .members and decodes nested values", async () => {
    const raw = await generateClient(recursiveUnionSpec, "UnionClient");

    expect(raw).toContain("// recursive definitions");
    expect(raw).toContain(
      'export const FilterValue = Schema.Union([Schema.String, FilterGroup], { mode: "oneOf" })'
    );
    const eagerUnionReferenceAt = raw.indexOf(
      "Schema.Union([Schema.String, FilterGroup]"
    );
    const groupDeclarationAt = raw.indexOf("export const FilterGroup =");
    expect(eagerUnionReferenceAt).toBeGreaterThan(-1);
    expect(eagerUnionReferenceAt).toBeLessThan(groupDeclarationAt);

    let rawImportError: unknown;
    try {
      await writeAndImport("union-raw.ts", raw);
    } catch (error) {
      rawImportError = error;
    }
    expect(rawImportError).toBeInstanceOf(ReferenceError);
    expect((rawImportError as ReferenceError).message).toContain("FilterGroup");

    const normalized = normalize(raw);
    expect(normalize(normalized)).toBe(normalized);
    expect(normalized).toContain(
      'Schema.Union([Schema.String, Schema.suspend((): Schema.Codec<FilterGroup> => FilterGroup)], { mode: "oneOf" })'
    );
    expect(normalized).toContain(
      '"values": Schema.Array(Schema.suspend((): Schema.Codec<FilterValue> => FilterValue))'
    );

    const module_ = await writeAndImport("union-normalized.ts", normalized);
    expect(module_.FilterValue.members).toHaveLength(2);
    expect(Object.keys(module_.FilterGroup.fields)).toEqual(["op", "values"]);

    const decodeGroup = Schema.decodeUnknownSync(module_.FilterGroup);
    const decoded = decodeGroup(validGroup);
    expect(decoded).toEqual(validGroup);
    expect(() => decodeGroup({ op: "and", values: [42] })).toThrow();
    expect(() =>
      decodeGroup({ op: "and", values: [{ op: 7, values: [] }] })
    ).toThrow();
    expect(Schema.encodeSync(module_.FilterGroup)(decoded)).toEqual(validGroup);
    expect(Schema.decodeUnknownSync(module_.FilterValue)("eu")).toBe("eu");
    expect(
      Schema.decodeUnknownSync(module_.FilterValue)({ op: "or", values: [] })
    ).toEqual({ op: "or", values: [] });
    expect(() => Schema.decodeUnknownSync(module_.FilterValue)(true)).toThrow();
    expect(module_.GetRoot200).toBeDefined();
  });

  test("direct self recursion is generated deferred and stays valid untouched", async () => {
    const raw = await generateClient(selfRecursiveSpec, "SelfClient");
    expect(raw).not.toContain("// recursive declarations");
    expect(raw).toContain(
      '"next": Schema.optionalKey(Schema.suspend((): Schema.Codec<TreeNode> => TreeNode))'
    );
    expect(normalize(raw)).toBe(raw);

    const module_ = await writeAndImport("self-raw.ts", raw);
    const value = {
      value: "head",
      next: { value: "tail" },
    };
    expect(Schema.decodeUnknownSync(module_.TreeNode)(value)).toEqual(value);
    expect(() =>
      Schema.decodeUnknownSync(module_.TreeNode)({ value: 1 })
    ).toThrow();
  });

  test("clients without recursion pass through unchanged and stay valid", async () => {
    const raw = await generateClient(noRecursionSpec, "FlatClient");
    expect(raw).not.toContain("// recursive declarations");
    expect(normalize(raw)).toBe(raw);

    const module_ = await writeAndImport("flat-raw.ts", raw);
    expect(Schema.decodeUnknownSync(module_.Flat)({ name: "desk" })).toEqual({
      name: "desk",
    });
    expect(() => Schema.decodeUnknownSync(module_.Flat)({})).toThrow();
  });
});

describe("normalizeRecursiveSchemas AST safety on synthetic sections", () => {
  const astSafetyFixture = `
import * as Schema from "effect/Schema"
// recursive declarations
export type Widget = { readonly "child"?: Widget }
export const Widget = Schema.suspend((): Schema.Codec<Widget> => __recursive_Widget)
export type __recursive_Named = { readonly "name": string }
// non-recursive definitions
export type Holder = { readonly "widget"?: Widget }
export const Holder = Schema.Struct({ "widget": Widget })
// recursive definitions
const __recursive_Widget = Schema.Struct({
  "Widget": Schema.String,
  "note": Schema.Literal("Widget recursively refers to Widget"),
  "registry": WidgetRegistry.Widget,
  "named": Schema.Array(__recursive_Named),
  "child": Schema.optionalKey(Schema.suspend((): Schema.Codec<Widget> => Widget)),
  "alias": Widget,
})
// schemas
export const AfterMarker = Schema.Struct({ "widget": Widget, "named": __recursive_Named })
`;

  test("rewrites only eager value references before the schemas boundary", () => {
    const normalized = normalize(astSafetyFixture);

    const deferred = "Schema.suspend((): Schema.Codec<Widget> => Widget)";
    expect(normalized.split(deferred).length - 1).toBe(2);

    expect(normalized).toContain('"Widget": Schema.String,');
    expect(normalized).toContain(
      'Schema.Literal("Widget recursively refers to Widget")'
    );
    expect(normalized).toContain('"registry": WidgetRegistry.Widget,');
    expect(normalized).toContain(
      "Schema.Array(Schema.suspend((): Schema.Codec<__recursive_Named> => __recursive_Named))"
    );
    expect(normalized).toContain(`"alias": ${deferred},`);
    expect(normalized).toContain(
      'export const Holder = Schema.Struct({ "widget": Widget })'
    );

    const boundary = normalized.indexOf("// schemas");
    expect(normalized.slice(boundary)).toBe(
      astSafetyFixture.slice(astSafetyFixture.indexOf("// schemas"))
    );
    expect(normalize(normalized)).toBe(normalized);
  });

  test("normalizes when the optional declarations and non-recursive sections are empty", () => {
    const fixture = `
import * as Schema from "effect/Schema"
// recursive definitions
export type Branch = { readonly "leafs": ReadonlyArray<Leaf> }
export const Branch = Schema.Struct({ "leafs": Schema.Array(Leaf) })
const __recursive_Branch = Branch
export type Leaf = { readonly "branch"?: Branch }
export const Leaf = Schema.Struct({ "branch": Schema.optionalKey(Branch) })
// schemas
export const Root = Branch
`;
    const normalized = normalize(fixture);
    expect(normalized).toContain(
      "Schema.Array(Schema.suspend((): Schema.Codec<Leaf> => Leaf))"
    );
    expect(normalized).toContain(
      "const __recursive_Branch = Schema.suspend((): Schema.Codec<Branch> => Branch)"
    );
  });

  test("passes through sources without any recursive sections", () => {
    const fixture = `
import * as Schema from "effect/Schema"
// schemas
export const Root = Schema.Struct({ "widget": Widget })
`;
    expect(normalize(fixture)).toBe(fixture);
  });

  test("rejects duplicated section markers as a typed failure", async () => {
    const fixture = `
// recursive definitions
const __recursive_Widget = Widget
// schemas
// recursive definitions
const __recursive_Widget2 = Widget2
// schemas
`;
    const error = await normalizationFailure(fixture);
    expect(error.message).toContain("appears more than once");
  });

  test("rejects recursive declarations without recursive definitions as a typed failure", async () => {
    const fixture = `
// recursive declarations
export type Widget = { readonly "child"?: Widget }
// schemas
export const Root = Widget
`;
    const error = await normalizationFailure(fixture);
    expect(error.message).toContain("without a");
  });

  test("rejects recursive definitions without the trailing schemas marker as a typed failure", async () => {
    const fixture = `
// recursive declarations
export type Widget = { readonly "child"?: Widget }
export const Widget = Schema.suspend((): Schema.Codec<Widget> => __recursive_Widget)
// recursive definitions
const __recursive_Widget = Schema.String
`;
    const error = await normalizationFailure(fixture);
    expect(error.message).toContain('missing trailing "// schemas"');
  });

  test("rejects out-of-order section markers as a typed failure", async () => {
    const fixture = `
// schemas
// recursive declarations
export type Widget = { readonly "child"?: Widget }
export const Widget = Schema.suspend((): Schema.Codec<Widget> => __recursive_Widget)
// recursive definitions
const __recursive_Widget = Schema.String
`;
    const error = await normalizationFailure(fixture);
    expect(error.message).toContain("unexpected order");
  });
});
