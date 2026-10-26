import { describe, expect, test } from "bun:test";
import { Context, Option, Schema, SchemaAST } from "effect";
import { HttpApi, OpenApi } from "effect/unstable/httpapi";
import {
  dhwVersionHeader,
  MinimumDhwVersion,
  OutdatedDhwRefusal,
} from "./dhw-version";
import { WorkspaceAdminApi } from "./workspace-admin-http-api";

/**
 * Released `dhw` binaries decode the campaign and automation endpoints as
 * they were when each binary shipped, so the contract recorded here may only
 * change on purpose. Regenerate it with
 * `UPDATE_WIRE_CONTRACT=1 bun test src/campaign-operation-wire-contract.test.ts`
 * and format it with `bunx biome format --write <fixture>`, then review the diff.
 */
const fixture = new URL(
  "./campaign-operation-wire-contract.golden.json",
  import.meta.url
);

const recordedGroups = ["campaigns", "automations"] as const;

type Json =
  | null
  | boolean
  | number
  | string
  | ReadonlyArray<Json>
  | { readonly [key: string]: Json };

/** Annotation values as JSON; an annotation that has no JSON form fails. */
const toJson = (value: unknown, at: string): Json => {
  if (Option.isOption(value)) {
    return Option.match(value, {
      onNone: () => ({ _tag: "None" }),
      onSome: (some) => ({ _tag: "Some", value: toJson(some, `${at}.value`) }),
    });
  }
  if (Array.isArray(value)) {
    return value.map((item, index) => toJson(item, `${at}[${index}]`));
  }
  switch (typeof value) {
    case "string":
    case "number":
    case "boolean":
      return value;
    case "object":
      if (value === null) return null;
      return Object.fromEntries(
        Object.entries(value)
          .filter(([, field]) => field !== undefined)
          .map(([key, field]) => [key, toJson(field, `${at}.${key}`)])
      );
    default:
      throw new Error(`${at} has no JSON form to record.`);
  }
};

/**
 * The parse options a request part decodes with, as the schema parser reads
 * them, and each union member's own.
 */
const parseOptionsOf = (ast: SchemaAST.AST): Json => {
  const own = toJson(
    SchemaAST.resolveAt<SchemaAST.ParseOptions>("parseOptions")(ast) ?? null,
    "parseOptions"
  );
  return SchemaAST.isUnion(ast)
    ? { union: own, members: ast.types.map(parseOptionsOf) }
    : own;
};

const decodedSchemaOf = (schema: Schema.Top | undefined) =>
  schema === undefined
    ? null
    : Schema.toJsonSchemaDocument(Schema.toType(schema));

const componentReference = /^#\/components\/schemas\/(.+)$/;

/** The component schemas `roots` reach through `$ref`, sorted by name. */
const reachableComponents = (
  roots: ReadonlyArray<unknown>,
  components: Readonly<Record<string, unknown>>
) => {
  const names = new Set<string>();
  const pending = [...roots];
  while (pending.length > 0) {
    const node = pending.pop();
    if (Array.isArray(node)) {
      pending.push(...node);
    } else if (typeof node === "object" && node !== null) {
      for (const [key, field] of Object.entries(node)) {
        const name =
          key === "$ref" && typeof field === "string"
            ? componentReference.exec(field)?.[1]
            : undefined;
        if (name === undefined) {
          pending.push(field);
        } else if (!names.has(name)) {
          if (!Object.hasOwn(components, name)) {
            throw new Error(`${field} names no component schema.`);
          }
          names.add(name);
          pending.push(components[name]);
        }
      }
    }
  }
  return Object.fromEntries(
    [...names].sort().map((name) => [name, components[name]])
  );
};

/**
 * The wire contract of every campaign and automation endpoint of
 * `WorkspaceAdminApi`: its OpenAPI operation (method, path and query
 * parameters, body, success and error responses), the parse options of each
 * request part, its middleware in declaration order (the last declared runs
 * first), and the annotations `dhw`, the MCP tools and the middleware read.
 */
const campaignOperationWireContract = () => {
  const spec = OpenApi.fromApi(WorkspaceAdminApi);
  const groups: Record<string, Record<string, unknown>> = Object.fromEntries(
    recordedGroups.map((name) => [name, {}])
  );
  const operations: Array<OpenApi.OpenAPISpecOperation> = [];
  HttpApi.reflect(WorkspaceAdminApi, {
    predicate: ({ group }) =>
      recordedGroups.some((name) => name === group.identifier),
    onGroup: () => undefined,
    onEndpoint: ({ group, endpoint, mergedAnnotations, middleware }) => {
      const reference = `${group.identifier}.${endpoint.name}`;
      const openApiPath = endpoint.path.replace(/:(\w+)\??/g, "{$1}");
      const operation =
        spec.paths[openApiPath]?.[
          endpoint.method.toLowerCase() as OpenApi.OpenAPISpecMethodName
        ];
      if (operation === undefined) {
        throw new Error(`${reference} is missing from the OpenAPI document.`);
      }
      operations.push(operation);
      groups[group.identifier]![endpoint.name] = {
        method: endpoint.method,
        path: endpoint.path,
        parseOptions: {
          headers:
            endpoint.headers === undefined
              ? null
              : parseOptionsOf(endpoint.headers.ast),
          params:
            endpoint.params === undefined
              ? null
              : parseOptionsOf(endpoint.params.ast),
          query:
            endpoint.query === undefined
              ? null
              : parseOptionsOf(endpoint.query.ast),
          payload: Object.fromEntries(
            [...endpoint.payload].map(([contentType, { schemas }]) => [
              contentType,
              schemas.map((schema) => parseOptionsOf(schema.ast)),
            ])
          ),
        },
        // OpenAPI shows path and query parameters as their wire strings; the
        // decoded side keeps the checks a string encoding drops.
        decodedParameters: {
          headers: decodedSchemaOf(endpoint.headers),
          params: decodedSchemaOf(endpoint.params),
          query: decodedSchemaOf(endpoint.query),
        },
        middleware: [...middleware].map((service) => service.key),
        annotations: Object.fromEntries(
          [...mergedAnnotations.mapUnsafe]
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, value]) => [key, toJson(value, `${reference} ${key}`)])
        ),
        effectiveAnnotations: {
          minimumDhwVersion: toJson(
            Context.get(mergedAnnotations, MinimumDhwVersion),
            `${reference} MinimumDhwVersion`
          ),
          outdatedDhwRefusal: Context.get(
            mergedAnnotations,
            OutdatedDhwRefusal
          ),
        },
        operation,
      };
    },
  });
  return {
    dhwVersionHeader,
    groups,
    components: {
      schemas: reachableComponents(operations, spec.components.schemas),
      securitySchemes: Object.fromEntries(
        Object.entries(spec.components.securitySchemes).filter(([name]) =>
          operations.some((operation) =>
            operation.security.some((requirement) =>
              Object.hasOwn(requirement, name)
            )
          )
        )
      ),
    },
  };
};

describe("campaign operation wire contract", () => {
  test("every campaign and automation endpoint keeps its recorded wire contract", async () => {
    // A JSON round trip drops `undefined` fields, as the fixture file does.
    const current = JSON.parse(JSON.stringify(campaignOperationWireContract()));
    if (process.env.UPDATE_WIRE_CONTRACT === "1") {
      await Bun.write(fixture, `${JSON.stringify(current, null, 2)}\n`);
    }

    expect(current).toEqual(await Bun.file(fixture).json());
  }, 30_000);
});
