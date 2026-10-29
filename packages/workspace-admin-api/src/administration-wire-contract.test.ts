import { describe, expect, test } from "bun:test";
import { Context, Option, Schema, SchemaAST } from "effect";
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiSchema,
  OpenApi,
} from "effect/unstable/httpapi";
import {
  dhwVersionHeader,
  MinimumDhwVersion,
  OutdatedDhwRefusal,
} from "./dhw-version";
import { WorkspaceAdminApi } from "./workspace-admin-http-api";

/**
 * Released `dhw` binaries decode every administration endpoint as it was
 * when each binary shipped, so the contract recorded here may only change on
 * purpose. Regenerate it with
 * `UPDATE_WIRE_CONTRACT=1 bun test src/administration-wire-contract.test.ts`
 * and review the diff. The test writes the fixture in its committed form;
 * Biome skips it as larger than its size limit.
 */
const fixture = new URL(
  "./administration-wire-contract.golden.json",
  import.meta.url
);

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
 * The wire contract of every endpoint of `api`: its OpenAPI
 * operation (method, path and query parameters, body, success and error
 * responses), the parse options of each request part, its middleware in
 * declaration order (the last declared runs first), and the annotations
 * `dhw`, the MCP tools and the middleware read.
 */
const wireContractOf = <Id extends string, Groups extends HttpApiGroup.Any>(
  api: HttpApi.HttpApi<Id, Groups>
) => {
  const spec = OpenApi.fromApi(api);
  const groups: Record<string, Record<string, unknown>> = {};
  const operations: Array<OpenApi.OpenAPISpecOperation> = [];
  HttpApi.reflect(api, {
    onGroup: ({ group }) => {
      groups[group.identifier] = {};
    },
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

type JsonObject = { readonly [key: string]: Json };

const isJsonObject = (value: Json | undefined): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

type RecordedEndpoint = JsonObject & {
  readonly decodedParameters: Readonly<Record<string, JsonObject | null>>;
  readonly operation: JsonObject;
};

type RecordedContract = {
  readonly dhwVersionHeader: Json;
  readonly groups: Readonly<
    Record<string, Readonly<Record<string, RecordedEndpoint>>>
  >;
  readonly components: {
    readonly schemas: Readonly<Record<string, Json>>;
    readonly securitySchemes: Json;
  };
};

/** A recorded contract as it reads back from the fixture file. */
const recordedFormOf = (
  contract: ReturnType<typeof wireContractOf>
): RecordedContract => JSON.parse(JSON.stringify(contract));

const definitionReference = /^#\/\$defs\/(.+)$/;

const schemaNamedBy =
  (reference: RegExp, schemas: Readonly<Record<string, Json>>) =>
  (ref: string) => {
    const name = reference.exec(ref)?.[1];
    return name !== undefined && Object.hasOwn(schemas, name)
      ? schemas[name]
      : undefined;
  };

/** Orders `[key, value]` entries by key. */
const byKey = (
  [a]: readonly [string, unknown],
  [b]: readonly [string, unknown]
) => a.localeCompare(b);

/** Keywords whose values are JSON data, not schemas. */
const dataKeywords = new Set(["const", "default", "enum", "examples"]);

/** Keywords whose values map names to schemas. */
const schemaMapKeywords = new Set([
  "$defs",
  "dependentSchemas",
  "patternProperties",
  "properties",
]);

/**
 * `node`'s fields with `schema` applied to each schema it holds and `data`
 * to each JSON value it holds, so a property named like a keyword stays a
 * schema and literal data is never read as one.
 */
const mapFields = (
  node: JsonObject,
  schema: (field: Json) => Json,
  data: (field: Json) => Json
) =>
  Object.entries(node).map(([key, field]): [string, Json] => {
    if (dataKeywords.has(key)) return [key, data(field)];
    if (!schemaMapKeywords.has(key) || !isJsonObject(field)) {
      return [key, schema(field)];
    }
    return [
      key,
      Object.fromEntries(
        Object.entries(field)
          .sort(byKey)
          .map(([name, member]) => [name, schema(member)])
      ),
    ];
  });

/** `value` with its object keys sorted, so equal values serialize alike. */
const withSortedKeys = (value: Json): Json => {
  if (Array.isArray(value)) return value.map(withSortedKeys);
  if (!isJsonObject(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(byKey)
      .map(([key, field]) => [key, withSortedKeys(field)])
  );
};

/**
 * `node` with each `$ref` replaced by the schema it names. A reference back
 * into a schema still being expanded becomes `{ $recursiveRef: n }`, the nth
 * enclosing expansion.
 */
const inlineReferences = (
  node: Json,
  schemaNamed: (ref: string) => Json | undefined,
  expanding: ReadonlyArray<string> = []
): Json => {
  if (Array.isArray(node)) {
    return node.map((item) => inlineReferences(item, schemaNamed, expanding));
  }
  if (!isJsonObject(node)) return node;
  const ref = node.$ref;
  if (typeof ref !== "string") {
    return Object.fromEntries(
      mapFields(
        node,
        (field) => inlineReferences(field, schemaNamed, expanding),
        (field) => field
      )
    );
  }
  if (Object.keys(node).length > 1) {
    throw new Error(`${ref} has keywords beside it.`);
  }
  const enclosing = expanding.lastIndexOf(ref);
  if (enclosing !== -1) return { $recursiveRef: expanding.length - enclosing };
  const schema = schemaNamed(ref);
  if (schema === undefined) throw new Error(`${ref} names no schema.`);
  return inlineReferences(schema, schemaNamed, [...expanding, ref]);
};

/** `values` in the order of their JSON text, for arrays that are sets. */
const sortedByJson = (values: ReadonlyArray<Json>) =>
  values
    .map((value) => [JSON.stringify(value), value] as const)
    .sort(byKey)
    .map(([, value]) => value);

const jsonTypesOf = (schema: JsonObject) => {
  const types = typeof schema.type === "string" ? [schema.type] : schema.type;
  return Array.isArray(types)
    ? types.map((type) => (type === "integer" ? "number" : type))
    : undefined;
};

const literalsOf = (schema: JsonObject) => {
  if (Array.isArray(schema.enum)) {
    return schema.enum.map((literal) => JSON.stringify(literal));
  }
  return "const" in schema ? [JSON.stringify(schema.const ?? null)] : undefined;
};

const disjoint = (
  a: ReadonlyArray<Json> | undefined,
  b: ReadonlyArray<Json> | undefined
) => a !== undefined && b !== undefined && !a.some((item) => b.includes(item));

/**
 * Whether no value satisfies both schemas: their JSON types or literal values
 * differ, or a property both require does, as a `_tag` does.
 */
const excludeEachOther = (
  a: Json | undefined,
  b: Json | undefined
): boolean => {
  if (!isJsonObject(a) || !isJsonObject(b)) return false;
  if (
    disjoint(jsonTypesOf(a), jsonTypesOf(b)) ||
    disjoint(literalsOf(a), literalsOf(b))
  ) {
    return true;
  }
  const required = (schema: JsonObject) =>
    Array.isArray(schema.required) ? schema.required : [];
  const property = (schema: JsonObject, key: string) =>
    isJsonObject(schema.properties) ? schema.properties[key] : undefined;
  return required(a).some(
    (key) =>
      typeof key === "string" &&
      required(b).includes(key) &&
      excludeEachOther(property(a, key), property(b, key))
  );
};

/**
 * The properties and tuple elements of `schema` that hold a single literal,
 * which Effect may narrow a union on.
 */
const sentinelKeysOf = (schema: Json) => {
  if (!isJsonObject(schema)) return [];
  const isSingleLiteral = (field: Json) =>
    isJsonObject(field) && literalsOf(field)?.length === 1;
  return [
    ...Object.entries(isJsonObject(schema.properties) ? schema.properties : {})
      .filter(([, field]) => isSingleLiteral(field))
      .map(([key]) => `property ${key}`),
    ...(Array.isArray(schema.prefixItems) ? schema.prefixItems : []).flatMap(
      (field, index) => (isSingleLiteral(field) ? [`element ${index}`] : [])
    ),
  ];
};

/**
 * A union's alternatives, sorted only where decoding cannot depend on their
 * order. Effect narrows a union to its candidates by the input's runtime type,
 * or by the first sentinel (a required literal property or tuple element) the
 * input holds, trying sentinel keys in member order, and then decodes with
 * the first candidate that accepts the input. So the order is dropped only
 * when each pair of alternatives excludes each other and all of them share at
 * most one sentinel key, as `_tag`-discriminated errors and nullable values
 * do. A repeated alternative is dropped because it can never be the first to
 * accept an input. Nested unions stay nested: Effect does not narrow into
 * them.
 */
const unionAlternatives = (alternatives: ReadonlyArray<Json>) => {
  const distinct = [
    ...new Map(
      alternatives.map((alternative) => [
        JSON.stringify(alternative),
        alternative,
      ])
    ).values(),
  ];
  const orderFree =
    new Set(distinct.flatMap(sentinelKeysOf)).size <= 1 &&
    distinct.every((a, index) =>
      distinct.slice(index + 1).every((b) => excludeEachOther(a, b))
    );
  return orderFree ? sortedByJson(distinct) : distinct;
};

/**
 * `schema`, with every `$ref` inlined, without what decoding does not depend
 * on: key order, the order of `required`, `enum` and `type`, which are sets,
 * and the order of union alternatives where `unionAlternatives` drops it.
 * Every other array keeps its order.
 */
const normalizeSchema = (schema: Json, isAlternative = false): Json => {
  if (Array.isArray(schema)) {
    return schema.map((item) => normalizeSchema(item));
  }
  if (!isJsonObject(schema)) return schema;
  const { anyOf, ...keywords } = schema;
  const fields: Record<string, Json> = Object.fromEntries(
    mapFields(keywords, (field) => normalizeSchema(field), withSortedKeys)
  );
  for (const set of ["required", "enum", "type"]) {
    const values = fields[set];
    if (Array.isArray(values)) fields[set] = sortedByJson(values);
  }
  if (anyOf !== undefined) {
    if (!Array.isArray(anyOf)) throw new Error("`anyOf` holds an array.");
    const alternatives = unionAlternatives(
      anyOf.map((alternative) => normalizeSchema(alternative, true))
    );
    // A one-member union decodes as its member, except as a union
    // alternative: Effect narrows only on a direct member's sentinels.
    if (
      alternatives.length === 1 &&
      Object.keys(fields).length === 0 &&
      !isAlternative
    ) {
      return alternatives[0] ?? null;
    }
    fields.anyOf = alternatives;
  }
  return Object.fromEntries(Object.entries(fields).sort(byKey));
};

const operationWireFormOf = (
  operation: JsonObject,
  componentNamed: (ref: string) => Json | undefined
) => {
  const normalized = normalizeSchema(
    inlineReferences(operation, componentNamed)
  );
  if (!isJsonObject(normalized)) throw new Error("An operation is an object.");
  const { parameters, responses, ...rest } = normalized;
  return {
    ...rest,
    // A parameter is identified by its location and name.
    parameters: Array.isArray(parameters) ? sortedByJson(parameters) : null,
    // OpenAPI generates each response description from the schema
    // identifiers, joined in member order; decoding never reads it.
    responses: Object.fromEntries(
      Object.entries(isJsonObject(responses) ? responses : {}).map(
        ([status, response]) => {
          if (!isJsonObject(response)) return [status, response];
          const { description: _, ...content } = response;
          return [status, content];
        }
      )
    ),
  };
};

/**
 * What a released `dhw` binary depends on in a recorded contract. Schemas are
 * compared by structure, with every `$ref` inlined: component and definition
 * names never reach the wire, and restructuring the endpoint declarations may
 * rename them. Union order is dropped only where decoding cannot depend on
 * it. Middleware order, annotations and parse options compare as recorded.
 */
const wireFormOf = (contract: RecordedContract) => {
  const componentNamed = schemaNamedBy(
    componentReference,
    contract.components.schemas
  );
  return {
    dhwVersionHeader: contract.dhwVersionHeader,
    securitySchemes: contract.components.securitySchemes,
    groups: Object.fromEntries(
      Object.entries(contract.groups).map(([group, endpoints]) => [
        group,
        Object.fromEntries(
          Object.entries(endpoints).map(
            ([name, { decodedParameters, operation, ...endpoint }]) => [
              name,
              {
                ...endpoint,
                decodedParameters: Object.fromEntries(
                  Object.entries(decodedParameters).map(([part, document]) => [
                    part,
                    document === null
                      ? null
                      : {
                          dialect: document.dialect,
                          schema: normalizeSchema(
                            inlineReferences(
                              document.schema ?? null,
                              schemaNamedBy(
                                definitionReference,
                                isJsonObject(document.definitions)
                                  ? document.definitions
                                  : {}
                              )
                            )
                          ),
                        },
                  ])
                ),
                operation: operationWireFormOf(operation, componentNamed),
              },
            ]
          )
        ),
      ])
    ),
  };
};

class SampleConflict extends Schema.TaggedErrorClass<SampleConflict>()(
  "SampleConflict",
  { message: Schema.String }
) {
  static schema = this.pipe(HttpApiSchema.status("Conflict"));
}

const inProgressFields = { message: Schema.String, requestId: Schema.String };

class SampleInProgress extends Schema.TaggedErrorClass<SampleInProgress>()(
  "SampleInProgress",
  inProgressFields
) {
  static schema = this.pipe(HttpApiSchema.status("Conflict"));
}

/** `SampleInProgress` on the wire, under another schema name. */
class RenamedInProgress extends Schema.TaggedErrorClass<RenamedInProgress>(
  "RenamedInProgress"
)("SampleInProgress", inProgressFields) {
  static schema = this.pipe(HttpApiSchema.status("Conflict"));
}

/** `SampleInProgress` with a numeric request ID. */
class NumberedInProgress extends Schema.TaggedErrorClass<NumberedInProgress>(
  "NumberedInProgress"
)("SampleInProgress", { message: Schema.String, requestId: Schema.Number }) {
  static schema = this.pipe(HttpApiSchema.status("Conflict"));
}

class SampleMissing extends Schema.TaggedErrorClass<SampleMissing>()(
  "SampleMissing",
  { message: Schema.String }
) {
  static schema = this.pipe(HttpApiSchema.status("NotFound"));
}

const note = Schema.Struct({ note: Schema.String });
const pinnedNote = Schema.Struct({
  note: Schema.String,
  pinned: Schema.optionalKey(Schema.Boolean),
});

// Each excludes the other by `_tag`, but Effect narrows a union on the first
// sentinel key the input holds, so `{ a: "a", b: "b", _tag: "B" }` decodes
// only when `bTagged` comes first.
const aTagged = Schema.Struct({
  a: Schema.Literal("a"),
  _tag: Schema.Literal("A"),
});
const bTagged = Schema.Struct({
  b: Schema.Literal("b"),
  _tag: Schema.Literal("B"),
});

const sampleContract = ({
  errors,
  payload = [note, pinnedNote],
  success = Schema.Struct({ accepted: Schema.Boolean }),
}: {
  readonly errors: ReadonlyArray<Schema.Top>;
  readonly payload?: readonly [Schema.Top, Schema.Top];
  readonly success?: Schema.Top;
}) =>
  recordedFormOf(
    wireContractOf(
      HttpApi.make("sample").add(
        HttpApiGroup.make("sample").add(
          HttpApiEndpoint.post("act", "/act", {
            payload: Schema.Union(payload),
            success,
            error: errors,
          })
        )
      )
    )
  );

describe("administration wire contract", () => {
  test("every administration endpoint keeps its recorded wire contract", async () => {
    const current = recordedFormOf(wireContractOf(WorkspaceAdminApi));
    if (process.env.UPDATE_WIRE_CONTRACT === "1") {
      await Bun.write(fixture, `${JSON.stringify(current, null, 2)}\n`);
    }
    const recorded: RecordedContract = await Bun.file(fixture).json();

    expect(wireFormOf(current)).toEqual(wireFormOf(recorded));
  }, 30_000);

  test("reordering or renaming error schemas keeps the wire contract", () => {
    const declared = sampleContract({
      errors: [
        SampleConflict.schema,
        SampleInProgress.schema,
        SampleMissing.schema,
      ],
    });
    const reordered = sampleContract({
      errors: [
        SampleMissing.schema,
        SampleInProgress.schema,
        SampleConflict.schema,
      ],
    });
    const renamed = sampleContract({
      errors: [
        SampleConflict.schema,
        RenamedInProgress.schema,
        SampleMissing.schema,
      ],
    });

    // The generated documents differ; the wire contracts do not.
    expect(reordered).not.toEqual(declared);
    expect(renamed).not.toEqual(declared);
    expect(wireFormOf(reordered)).toEqual(wireFormOf(declared));
    expect(wireFormOf(renamed)).toEqual(wireFormOf(declared));
  });

  test("a changed error set or an order decoding depends on changes the wire contract", () => {
    const errors = [
      SampleConflict.schema,
      SampleInProgress.schema,
      SampleMissing.schema,
    ];
    const declared = wireFormOf(sampleContract({ errors }));

    expect(
      wireFormOf(
        sampleContract({
          errors: [
            SampleConflict.schema,
            NumberedInProgress.schema,
            SampleMissing.schema,
          ],
        })
      )
    ).not.toEqual(declared);
    expect(
      wireFormOf(
        sampleContract({
          errors: [SampleInProgress.schema, SampleMissing.schema],
        })
      )
    ).not.toEqual(declared);
    // Both payload members accept `{ note }`, so the first one decodes it.
    expect(
      wireFormOf(sampleContract({ errors, payload: [pinnedNote, note] }))
    ).not.toEqual(declared);
    expect(
      wireFormOf(sampleContract({ errors, payload: [aTagged, bTagged] }))
    ).not.toEqual(
      wireFormOf(sampleContract({ errors, payload: [bTagged, aTagged] }))
    );
    // `{ _tag: "A", a: "a", note: "n" }` decodes as `note` first when `aTagged`
    // sits in a nested union, whose sentinels Effect does not narrow on.
    expect(
      wireFormOf(
        sampleContract({
          errors,
          success: Schema.Union([note, Schema.Union([aTagged])]),
        })
      )
    ).not.toEqual(
      wireFormOf(
        sampleContract({ errors, success: Schema.Union([note, aTagged]) })
      )
    );
  });
});
