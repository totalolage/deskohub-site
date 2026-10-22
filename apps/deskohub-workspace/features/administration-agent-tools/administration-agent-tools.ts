import {
  type AdministrationOperationBehavior,
  type AdministrationOperationReference,
  AdministrationOperationVariants,
  administrationOperationDeclaration,
  credentialPaths,
  disclosedCredentials,
  WorkspaceAdminApi,
} from "@deskohub/workspace-admin-api";
import {
  Context,
  Effect,
  Encoding,
  Match,
  Option,
  Predicate,
  Redacted,
  Schema,
  SchemaAST,
} from "effect";
import {
  HttpApi,
  type HttpApiEndpoint,
  type HttpApiGroup,
} from "effect/unstable/httpapi";
import { AdministratorAgentAuthorization } from "@/features/administrators/backend/administrator-agent-authorization.service";
import {
  type AgentTool,
  type AgentToolAttachment,
  AgentToolReply,
  getInvalidField,
} from "@/features/agent-tools/agent-tool";
import {
  AgentToolError,
  administrationAgentToolErrorResultSchema,
  decodeAdministrationError,
} from "@/features/agent-tools/agent-tool-error";
import type { CustomerAgentCaller } from "@/features/agent-tools/customer-agent-caller";
import {
  AdministrationAgentAccessToken,
  AdministrationApiClient,
  type AdministrationApiRequest,
} from "./administration-api-client";
import { assistantAccessEnded } from "./administration-assistant-refusal";

type Behavior = AdministrationOperationBehavior["Service"];

type Arguments = Schema.JsonObject;

/** Splits validated tool arguments into the operation's request parts. */
type RequestParts = (
  args: Arguments
) => Effect.Effect<AdministrationApiRequest, AgentToolError>;

/**
 * One administration operation as an agent tool: an endpoint, or one
 * variant of a generic mutation endpoint, with the arguments it takes and
 * how they map onto the endpoint's request.
 */
export interface AdministrationOperationTool {
  readonly reference: AdministrationOperationReference;
  /** `<group>.<endpoint>`, which the API client calls. */
  readonly operation: string;
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly behavior: Behavior;
  /** Every argument the tool takes; `confirm` included on destructive tools. */
  readonly argumentNames: ReadonlySet<string>;
  /** The arguments a call must pass. */
  readonly requiredArgumentNames: ReadonlySet<string>;
  /** The published input schema: one strict object of every argument. */
  readonly input: Schema.Top;
  /** The published output schema: the success results and the errors. */
  readonly output: AgentTool<never>["output"];
  readonly toRequest: RequestParts;
  /** Encodes the operation's success; binary successes become attachments. */
  readonly success: Schema.Top;
  readonly binary: boolean;
  /** Whether the success's JSON isn't an object, so it answers `{ items }`. */
  readonly wrapsResult: boolean;
  readonly errors: ReadonlyArray<Schema.Top>;
}

const confirmArgument = "confirm";

/** The arguments that identify one intended change across retries. */
const changeKeyArguments = new Set(["requestId", "attemptId", "invoiceId"]);

const toSnakeCase = (value: string) =>
  value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/-/g, "_")
    .toLowerCase();

const toWords = (value: string) => toSnakeCase(value).replace(/_/g, " ");

const capitalize = (value: string) =>
  value.charAt(0).toUpperCase() + value.slice(1);

/** A schema's top-level properties, or none when it isn't a plain object. */
const propertiesOf = (
  schema: Schema.Top | undefined
): Option.Option<ReadonlyArray<SchemaAST.PropertySignature>> => {
  if (schema === undefined) {
    return Option.some([]);
  }
  const { ast } = schema;
  return SchemaAST.isObjects(ast) &&
    ast.encoding === undefined &&
    ast.indexSignatures.length === 0
    ? Option.some(ast.propertySignatures)
    : Option.none();
};

const nameOf = (property: SchemaAST.PropertySignature) => String(property.name);

const isRequired = (property: SchemaAST.PropertySignature) =>
  !SchemaAST.isOptional(property.type);

/** The union member whose discriminator is the variant's literal. */
const variantMember = (
  union: SchemaAST.AST,
  discriminator: string,
  variant: string
) =>
  Option.fromNullishOr(
    (SchemaAST.isUnion(union) ? union.types : [union]).find(
      (member) =>
        SchemaAST.isObjects(member) &&
        member.propertySignatures.some(
          (property) =>
            nameOf(property) === discriminator &&
            SchemaAST.isLiteral(property.type) &&
            property.type.literal === variant
        )
    )
  ).pipe(
    Option.filter(SchemaAST.isObjects),
    Option.map((member) =>
      member.propertySignatures.filter(
        (property) => nameOf(property) !== discriminator
      )
    )
  );

const pick = (args: Arguments, names: ReadonlyArray<string>): Arguments =>
  Object.fromEntries(
    names
      .filter((name) => Object.hasOwn(args, name))
      .map((name) => [name, args[name] ?? null])
  );

const decodePart = (
  schema: Schema.Top,
  value: Schema.Json,
  fieldOf: (path: string | undefined) => string | undefined
) =>
  Schema.decodeUnknownEffect(schema as Schema.Decoder<unknown>)(value, {
    onExcessProperty: "error",
    errors: "first",
  }).pipe(
    Effect.mapError((error) =>
      AgentToolError.invalidInput(fieldOf(getInvalidField(error.issue)))
    )
  );

const sameField = (path: string | undefined) => path;

/** The JSON Schema object of one property, in the order agents see them. */
/**
 * One strict object of the arguments. An empty struct would accept any
 * object, so a tool without arguments takes an object with no keys.
 */
const argumentSchema = (
  properties: ReadonlyArray<SchemaAST.PropertySignature>
): Schema.Top =>
  properties.length === 0
    ? Schema.Record(Schema.String, Schema.Never)
    : Schema.make<Schema.Top>(
        new SchemaAST.Objects(properties, [], {
          parseOptions: { onExcessProperty: "error" },
        })
      );

const confirmProperty = new SchemaAST.PropertySignature(
  confirmArgument,
  Schema.optionalKey(
    Schema.Boolean.annotate({
      description:
        "Pass true to apply the change. Without it the call changes nothing and answers a preview of what it would change.",
    })
  ).ast
);

const describe = ({
  title,
  behavior,
  argumentNames,
}: {
  readonly title: string;
  readonly behavior: Behavior;
  readonly argumentNames: ReadonlySet<string>;
}) =>
  [
    `${title}.`,
    Match.value(behavior.kind).pipe(
      Match.when("read", () => "Reads only; changes nothing."),
      Match.when("write", () => "Changes administration data."),
      Match.when("destructive", () =>
        behavior.preview?._tag === "DryRun"
          ? "Destructive. With dryRun: true it only reports what it would change. A real run without confirm: true changes nothing and answers that report as a preview; repeat the call with confirm: true to apply it."
          : "Destructive. Without confirm: true it changes nothing and answers a preview of the current state; repeat the call with confirm: true to apply it."
      ),
      Match.exhaustive
    ),
    ...[...changeKeyArguments]
      .filter((name) => argumentNames.has(name))
      .map(
        (name) =>
          `${name} is a new UUID for each intended change; repeat the same value only when retrying this exact call.`
      ),
  ].join(" ");

/** Every operation's success schema, at the success status. */
const successOf = (
  successes: ReadonlyMap<number, readonly [Schema.Top, ...Array<Schema.Top>]>,
  reference: string
) => {
  const schemas = [...successes.values()].flat();
  const [success, ...others] = schemas;
  if (success === undefined || others.length > 0) {
    throw new Error(`${reference} must have exactly one success schema.`);
  }
  return success;
};

const isBinary = (success: Schema.Top) =>
  Schema.is(Schema.toType(success) as Schema.Schema<unknown>)(new Uint8Array());

/**
 * Refuses an operation whose success or errors can carry a credential the
 * contract doesn't allow it to disclose.
 */
const guardCredentials = ({
  reference,
  success,
  errors,
}: {
  readonly reference: AdministrationOperationReference;
  readonly success: Schema.Top;
  readonly errors: ReadonlyArray<Schema.Top>;
}) => {
  const operation = reference.split(".").slice(0, 2).join(".");
  const disclosed = disclosedCredentials
    .filter((entry) => entry.operation === operation)
    .map((entry) => entry.path.join("."));
  const leaked = [
    ...credentialPaths(success).filter(
      (path) => !disclosed.includes(path.join("."))
    ),
    ...errors.flatMap(credentialPaths),
  ];
  if (leaked.length > 0) {
    throw new Error(
      `${reference} can return credentials at ${leaked.map((path) => path.join(".") || "(root)").join(", ")}.`
    );
  }
};

/** Whether the schema's JSON is always an object. */
/** A schema whose JSON is an object, as tool results are. */
type JsonObjectSchema = Schema.Codec<Schema.JsonObject, Schema.JsonObject>;

const encodesToObject = (ast: SchemaAST.AST): boolean => {
  const encoded = SchemaAST.toEncoded(ast);
  return SchemaAST.isUnion(encoded)
    ? encoded.types.every(encodesToObject)
    : SchemaAST.isObjects(encoded);
};

const successResultSchema = ({
  success,
  binary,
  wrapsResult,
}: {
  readonly success: Schema.Top;
  readonly binary: boolean;
  readonly wrapsResult: boolean;
}): JsonObjectSchema => {
  if (binary) {
    return Schema.Struct({
      uri: Schema.String,
      mimeType: Schema.String,
      byteLength: Schema.Number,
    }).annotate({
      description:
        "The document, attached to the result as an embedded resource.",
    });
  }
  const json = Schema.toCodecJson(success as Schema.Codec<unknown>);
  // `encodesToObject` decided whether the JSON is an object; wrapped, it is.
  return (
    wrapsResult ? Schema.Struct({ items: json }) : json
  ) as JsonObjectSchema;
};

const outputSchema = ({
  behavior,
  result,
}: {
  readonly behavior: Behavior;
  readonly result: JsonObjectSchema;
}): AgentTool<never>["output"] => {
  const preview = Schema.Struct({
    outcome: Schema.Literal("confirmation-required"),
    operation: Schema.String.annotate({
      description: "The tool to call again with confirm: true.",
    }),
    input: Schema.Record(Schema.String, Schema.Json).annotate({
      description: "The arguments to repeat with confirm: true.",
    }),
    current: Schema.optionalKey(
      Schema.Record(Schema.String, Schema.Json).annotate({
        description:
          "What the change would act on now, by the read operation that showed it.",
      })
    ),
    dryRun: Schema.optionalKey(
      Schema.Json.annotate({
        description: "What a real run would change, from a dry run.",
      })
    ),
  });
  const successes =
    behavior.kind === "destructive"
      ? [
          Schema.Struct({
            outcome: Schema.Literal("applied"),
            result,
          }),
          preview,
          ...(behavior.preview?._tag === "DryRun"
            ? [Schema.Struct({ outcome: Schema.Literal("dry-run"), result })]
            : []),
        ]
      : [result];
  return Schema.toStandardJSONSchemaV1(
    Schema.toStandardSchemaV1(
      Schema.Union([...successes, administrationAgentToolErrorResultSchema])
    )
  );
};

interface EndpointReflection {
  readonly group: HttpApiGroup.AnyWithProps;
  readonly endpoint: HttpApiEndpoint.AnyWithProps;
  readonly mergedAnnotations: Context.Context<never>;
  readonly successes: ReadonlyMap<
    number,
    readonly [Schema.Top, ...Array<Schema.Top>]
  >;
  readonly errors: ReadonlyMap<
    number,
    readonly [Schema.Top, ...Array<Schema.Top>]
  >;
}

const payloadOf = (
  endpoint: HttpApiEndpoint.AnyWithProps,
  reference: string
) => {
  const [payload, ...others] = [...endpoint.payload.values()].flatMap(
    ({ schemas }) => schemas
  );
  if (others.length > 0) {
    throw new Error(`${reference} must accept one payload schema.`);
  }
  return payload;
};

/**
 * The tool, or tools for a generic mutation endpoint, of one endpoint.
 * Path parameters, query and payload fields become one flat object of
 * arguments; a payload that isn't a plain object is passed whole as
 * `payload`, and a generic mutation's variant fields are flattened next to
 * the payload's other fields.
 */
const deriveEndpointTools = ({
  group,
  endpoint,
  mergedAnnotations,
  successes,
  errors,
}: EndpointReflection): ReadonlyArray<AdministrationOperationTool> => {
  const operation: AdministrationOperationReference = `${group.identifier}.${endpoint.name}`;
  const declaration = administrationOperationDeclaration(mergedAnnotations);
  if (Option.isNone(declaration)) {
    throw new Error(`${operation} declares no administration operation.`);
  }
  if (declaration.value._tag === "CliOnly") {
    return [];
  }
  const params = endpoint.params;
  const query = endpoint.query;
  const payload = payloadOf(endpoint, operation);
  const paramProperties = Option.getOrThrowWith(
    propertiesOf(params),
    () => new Error(`${operation} path parameters must be an object.`)
  );
  const queryProperties = Option.getOrThrowWith(
    propertiesOf(query),
    () => new Error(`${operation} query must be an object.`)
  );
  const success = successOf(successes, operation);
  const binary = isBinary(success);
  const wrapsResult = !binary && !encodesToObject(success.ast);
  const errorSchemas = [...errors.values()].flat();

  const variants = Context.getOption(
    mergedAnnotations,
    AdministrationOperationVariants
  );

  const makeTool = ({
    reference,
    name,
    title,
    behavior,
    payloadArguments,
    toPayload,
  }: {
    readonly reference: AdministrationOperationReference;
    readonly name: string;
    readonly title: string;
    readonly behavior: Behavior;
    readonly payloadArguments: ReadonlyArray<SchemaAST.PropertySignature>;
    readonly toPayload: (
      args: Arguments
    ) => Effect.Effect<unknown, AgentToolError> | undefined;
  }): AdministrationOperationTool => {
    const properties = [
      ...paramProperties,
      ...queryProperties,
      ...payloadArguments,
      ...(behavior.kind === "destructive" ? [confirmProperty] : []),
    ];
    const names = properties.map(nameOf);
    const collisions = names.filter(
      (name, index) => names.indexOf(name) !== index
    );
    if (collisions.length > 0) {
      throw new Error(`${reference} has colliding arguments: ${collisions}.`);
    }
    guardCredentials({ reference, success, errors: errorSchemas });
    const argumentNames = new Set(names);
    const paramNames = paramProperties.map(nameOf);
    const queryNames = queryProperties.map(nameOf);
    return {
      reference,
      operation,
      name,
      title,
      description: describe({ title, behavior, argumentNames }),
      behavior,
      argumentNames,
      requiredArgumentNames: new Set(properties.filter(isRequired).map(nameOf)),
      input: argumentSchema(properties),
      output: outputSchema({
        behavior,
        result: successResultSchema({ success, binary, wrapsResult }),
      }),
      toRequest: (args) =>
        Effect.all({
          params:
            params === undefined
              ? Effect.void
              : decodePart(params, pick(args, paramNames), sameField),
          query:
            query === undefined
              ? Effect.void
              : decodePart(query, pick(args, queryNames), sameField),
          payload: toPayload(args) ?? Effect.void,
        }),
      success,
      binary,
      wrapsResult,
      errors: errorSchemas,
    };
  };

  const title = capitalize(toWords(endpoint.name));

  if (Option.isSome(variants)) {
    const { field, discriminator, operations } = variants.value;
    const payloadProperties = Option.getOrThrowWith(
      propertiesOf(payload),
      () => new Error(`${operation} payload must be an object.`)
    );
    const union = payloadProperties.find(
      (property) => nameOf(property) === field
    );
    if (payload === undefined || union === undefined) {
      throw new Error(`${operation} payload has no ${field} field.`);
    }
    const outer = payloadProperties.filter(
      (property) => nameOf(property) !== field
    );
    const subject = endpoint.name.replace(/^mutate/, "");
    return Object.entries(operations).map(([variant, behavior]) => {
      const member = Option.getOrThrowWith(
        variantMember(union.type, discriminator, variant),
        () => new Error(`${operation} has no ${variant} variant.`)
      );
      const outerNames = outer.map(nameOf);
      const memberNames = member.map(nameOf);
      return makeTool({
        reference: `${operation}.${variant}`,
        name: `admin_${toSnakeCase(subject)}_${toSnakeCase(variant)}`,
        title: `${capitalize(toWords(subject))}: ${toWords(variant)}`,
        behavior,
        payloadArguments: [...outer, ...member],
        toPayload: (args) =>
          decodePart(
            payload,
            {
              ...pick(args, outerNames),
              [field]: { [discriminator]: variant, ...pick(args, memberNames) },
            },
            (path) =>
              path?.startsWith(`${field}.`)
                ? path.slice(field.length + 1)
                : path
          ),
      });
    });
  }

  if (declaration.value._tag !== "Operation") {
    throw new Error(`${operation} declares variants without a variant map.`);
  }
  const behavior = declaration.value.behavior;
  const reference = operation;
  const name = `admin_${toSnakeCase(endpoint.name)}`;
  if (payload === undefined) {
    return [
      makeTool({
        reference,
        name,
        title,
        behavior,
        payloadArguments: [],
        toPayload: () => undefined,
      }),
    ];
  }
  return Option.match(propertiesOf(payload), {
    onSome: (payloadProperties) => {
      const payloadNames = payloadProperties.map(nameOf);
      return [
        makeTool({
          reference,
          name,
          title,
          behavior,
          payloadArguments: payloadProperties,
          toPayload: (args) =>
            decodePart(payload, pick(args, payloadNames), sameField),
        }),
      ];
    },
    // A payload that isn't one plain object, such as a union, is passed
    // whole.
    onNone: () => [
      makeTool({
        reference,
        name,
        title,
        behavior,
        payloadArguments: [
          new SchemaAST.PropertySignature("payload", payload.ast),
        ],
        toPayload: (args) =>
          decodePart(payload, args.payload ?? null, (path) =>
            path === undefined ? "payload" : `payload.${path}`
          ),
      }),
    ],
  });
};

type ReadPreview = Extract<
  NonNullable<Behavior["preview"]>,
  { readonly _tag: "Read" }
>;

/** The operation's argument a read preview takes as `name`. */
const previewArgumentSource = (preview: ReadPreview, name: string) =>
  preview.arguments?.[name] ?? name;

/** The arguments of a read preview, taken from the operation's. */
const previewArguments = ({
  preview,
  previewTool,
  args,
}: {
  readonly preview: ReadPreview;
  readonly previewTool: AdministrationOperationTool;
  readonly args: Arguments;
}): Arguments =>
  Object.fromEntries(
    [...previewTool.argumentNames].flatMap((name) => {
      const value = args[previewArgumentSource(preview, name)];
      return value === undefined ? [] : [[name, value]];
    })
  );

/** Derives one tool per administration operation the contract serves. */
export const deriveAdministrationOperationTools = <
  Id extends string,
  Groups extends HttpApiGroup.Any,
>(
  api: HttpApi.HttpApi<Id, Groups>
): ReadonlyArray<AdministrationOperationTool> => {
  const tools: Array<AdministrationOperationTool> = [];
  HttpApi.reflect(api, {
    onGroup: () => undefined,
    onEndpoint: (reflection) => {
      tools.push(...deriveEndpointTools(reflection));
    },
  });
  const byReference = new Map(tools.map((tool) => [tool.reference, tool]));
  for (const tool of tools) {
    const preview = tool.behavior.preview;
    if (preview?._tag === "DryRun" && !tool.argumentNames.has("dryRun")) {
      throw new Error(`${tool.reference} previews a dry run without dryRun.`);
    }
    if (preview?._tag !== "Read") {
      continue;
    }
    for (const reference of preview.operations) {
      const previewTool = byReference.get(reference);
      if (previewTool === undefined || previewTool.behavior.kind !== "read") {
        throw new Error(
          `${tool.reference} previews with ${reference}, which no read tool serves.`
        );
      }
      const missing = [...previewTool.requiredArgumentNames].filter(
        (name) => !tool.argumentNames.has(previewArgumentSource(preview, name))
      );
      if (missing.length > 0) {
        throw new Error(
          `${tool.reference} can't preview with ${reference}: it lacks ${missing}.`
        );
      }
    }
  }
  return tools;
};

const toJson = <Value>(schema: Schema.Top, value: Value) =>
  Schema.encodeUnknownEffect(
    Schema.toCodecJson(schema as Schema.Codec<unknown>)
  )(value);

const decodeJsonObject = Schema.decodeUnknownEffect(
  Schema.Record(Schema.String, Schema.Json)
);

/** An operation's typed error as the API encodes it, if it is one. */
const encodeOperationError = <OperationError>(
  tool: AdministrationOperationTool,
  error: OperationError
) =>
  Option.firstSomeOf(
    tool.errors.map((schema) =>
      Schema.encodeUnknownOption(
        Schema.toCodecJson(schema as Schema.Codec<unknown>)
      )(error).pipe(Option.flatMap(decodeAdministrationError))
    )
  );

interface OperationOutcome {
  readonly result: Schema.JsonObject;
  readonly attachments: ReadonlyArray<AgentToolAttachment>;
}

/** Runs the operation and encodes its success as the tool's result. */
const runOperation = (tool: AdministrationOperationTool, args: Arguments) =>
  tool.toRequest(args).pipe(
    Effect.flatMap((request) =>
      Effect.flatMap(AdministrationApiClient, (client) =>
        client.call(tool.operation, request)
      ).pipe(
        Effect.mapError((error) =>
          Option.match(encodeOperationError(tool, error), {
            onSome: AgentToolError.administrationFailed,
            onNone: () =>
              AgentToolError.unavailable("administration_unavailable")(error),
          })
        )
      )
    ),
    Effect.flatMap(
      ({
        value,
        contentType,
      }): Effect.Effect<OperationOutcome, AgentToolError> =>
        value instanceof Uint8Array
          ? Effect.succeed(
              toAttachmentOutcome({
                tool,
                args,
                bytes: value,
                mimeType: Option.getOrElse(
                  contentType,
                  () => "application/octet-stream"
                ),
              })
            )
          : toJson(tool.success, value).pipe(
              Effect.flatMap((json) =>
                decodeJsonObject(tool.wrapsResult ? { items: json } : json)
              ),
              Effect.map((result) => ({ result, attachments: [] })),
              Effect.mapError(
                AgentToolError.unavailable("administration_unavailable")
              )
            )
    )
  );

const toAttachmentOutcome = ({
  tool,
  args,
  bytes,
  mimeType,
}: {
  readonly tool: AdministrationOperationTool;
  readonly args: Arguments;
  readonly bytes: Uint8Array;
  readonly mimeType: string;
}): OperationOutcome => {
  const subject = Object.values(args).filter(Predicate.isString).slice(0, 1);
  const uri = ["urn:deskohub:administration", tool.reference, ...subject].join(
    ":"
  );
  return {
    result: { uri, mimeType, byteLength: bytes.byteLength },
    attachments: [{ uri, mimeType, blob: Encoding.encodeBase64(bytes) }],
  };
};

/**
 * Answers a destructive call without `confirm: true` with what it would
 * change, read through the same API and authentication, and changes
 * nothing: no mutation runs, no change key is claimed and no action is
 * recorded.
 */
const previewOperation = ({
  tool,
  args,
  tools,
}: {
  readonly tool: AdministrationOperationTool;
  readonly args: Arguments;
  readonly tools: ReadonlyMap<string, AdministrationOperationTool>;
}) => {
  const input = Object.fromEntries(
    Object.entries(args).filter(([name]) => name !== confirmArgument)
  );
  const confirmation = {
    outcome: "confirmation-required",
    operation: tool.name,
    input,
  } as const;
  const preview = tool.behavior.preview;
  if (preview === undefined) {
    return Effect.succeed<OperationOutcome>({
      result: confirmation,
      attachments: [],
    });
  }
  return Match.value(preview).pipe(
    Match.tag("DryRun", () =>
      runOperation(tool, { ...input, dryRun: true }).pipe(
        Effect.map(
          ({ result, attachments }): OperationOutcome => ({
            result: { ...confirmation, dryRun: result },
            attachments,
          })
        )
      )
    ),
    Match.tag("Read", (read) =>
      Effect.forEach(read.operations, (reference) =>
        Option.match(Option.fromNullishOr(tools.get(reference)), {
          onNone: () =>
            Effect.die(new Error(`No read tool serves ${reference}.`)),
          onSome: (previewTool) =>
            runOperation(
              previewTool,
              previewArguments({ preview: read, previewTool, args: input })
            ).pipe(Effect.map((outcome) => [reference, outcome] as const)),
        })
      ).pipe(
        Effect.map(
          (outcomes): OperationOutcome => ({
            result: {
              ...confirmation,
              current: Object.fromEntries(
                outcomes.map(([reference, { result }]) => [reference, result])
              ),
            },
            attachments: outcomes.flatMap(([, { attachments }]) => attachments),
          })
        )
      )
    ),
    Match.exhaustive
  );
};

const argumentsSchema = Schema.Record(Schema.String, Schema.Json);

const confirmationSchema = Schema.Struct({
  confirm: Schema.optionalKey(Schema.Boolean),
  dryRun: Schema.optionalKey(Schema.Json),
});

/** Runs a tool call: validates, gates destructive changes, and calls. */
const callAdministrationTool = Effect.fn("administrationAgentTools.call")(
  function* ({
    tool,
    tools,
    args,
  }: {
    readonly tool: AdministrationOperationTool;
    readonly tools: ReadonlyMap<string, AdministrationOperationTool>;
    readonly args: Schema.Json;
  }) {
    const object = yield* Schema.decodeUnknownEffect(argumentsSchema)(
      args
    ).pipe(Effect.mapError(() => AgentToolError.invalidInput()));
    const unknown = Object.keys(object).find(
      (name) => !tool.argumentNames.has(name)
    );
    if (unknown !== undefined) {
      return yield* AgentToolError.invalidInput(unknown);
    }
    const { confirm, dryRun } = yield* Schema.decodeUnknownEffect(
      confirmationSchema
    )(object, { onExcessProperty: "ignore" }).pipe(
      Effect.mapError((error) =>
        AgentToolError.invalidInput(getInvalidField(error.issue))
      )
    );
    // Validates every argument before anything runs, previews included.
    yield* tool.toRequest(object);
    if (tool.behavior.kind !== "destructive") {
      return yield* runOperation(tool, object);
    }
    if (tool.behavior.preview?._tag === "DryRun" && dryRun === true) {
      return yield* runOperation(tool, object).pipe(
        Effect.map(
          ({ result, attachments }): OperationOutcome => ({
            result: { outcome: "dry-run", result },
            attachments,
          })
        )
      );
    }
    if (confirm !== true) {
      return yield* previewOperation({ tool, args: object, tools });
    }
    return yield* runOperation(
      tool,
      Object.fromEntries(
        Object.entries(object).filter(([name]) => name !== confirmArgument)
      )
    ).pipe(
      Effect.map(
        ({ result, attachments }): OperationOutcome => ({
          result: { outcome: "applied", result },
          attachments,
        })
      )
    );
  }
);

/**
 * Checks the caller's token and administrator grant again before a call
 * answers anything, as a grant can end after the tools were listed: a
 * preview that reads nothing would otherwise answer a caller who lost
 * access.
 */
const authorizeCaller = (caller: CustomerAgentCaller) =>
  Effect.flatMap(AdministratorAgentAuthorization, (authorization) =>
    authorization.authorize(caller)
  ).pipe(
    Effect.mapError((error) => {
      if (error.reason === "unavailable") {
        return AgentToolError.unavailable("administration_unavailable")(error);
      }
      const { _tag, message } = assistantAccessEnded();
      return AgentToolError.administrationFailed({ _tag, message });
    })
  );

/**
 * The administration operations as agent tools, called for the agent whose
 * token the request carried. Each call checks the token and the
 * administrator grant first, and an operation it runs goes through the
 * administration API, which authenticates them again.
 */
export const makeAdministrationAgentTools = (
  operationTools: ReadonlyArray<AdministrationOperationTool>
): ReadonlyArray<
  AgentTool<AdministrationApiClient | AdministratorAgentAuthorization>
> => {
  const byReference = new Map(
    operationTools.map((tool) => [tool.reference, tool])
  );
  return operationTools.map((tool) => ({
    access: "administration",
    name: tool.name,
    title: tool.title,
    description: tool.description,
    readOnly: tool.behavior.kind === "read",
    destructive: tool.behavior.kind === "destructive",
    idempotent: tool.behavior.idempotent,
    unavailableCode: "administration_unavailable",
    input: Schema.toStandardJSONSchemaV1(tool.input),
    output: tool.output,
    call: (args, caller = Option.none<CustomerAgentCaller>()) =>
      Option.match(caller, {
        // The route lists administration tools only for a verified caller.
        onNone: () => Effect.fail(AgentToolError.serviceUnavailable()),
        onSome: (agentCaller) =>
          authorizeCaller(agentCaller).pipe(
            Effect.andThen(
              callAdministrationTool({ tool, tools: byReference, args })
            ),
            Effect.map(
              ({ result, attachments }) =>
                new AgentToolReply({ result, attachments })
            ),
            Effect.provideService(
              AdministrationAgentAccessToken,
              Redacted.make(agentCaller.accessToken)
            )
          ),
      }).pipe(
        Effect.catchDefect((defect) =>
          Effect.fail(
            AgentToolError.unavailable("administration_unavailable")(defect)
          )
        )
      ),
  }));
};

/** The tool of every operation `WorkspaceAdminApi` serves to agents. */
export const administrationOperationTools =
  deriveAdministrationOperationTools(WorkspaceAdminApi);
