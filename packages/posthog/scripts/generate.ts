import { mkdtemp, rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Config, Data, Effect } from "effect";

const featureFlagsPath = "/api/projects/{project_id}/feature_flags/";
const filtersSchemaReference = "#/components/schemas/FeatureFlagFiltersSchema";
const listItemSchemaName = "PostHogFeatureFlagListItem";
const listItemSchemaReference = `#/components/schemas/${listItemSchemaName}`;
const listPageSchemaName = "PostHogFeatureFlagListPage";
const listPageSchemaReference = `#/components/schemas/${listPageSchemaName}`;
const packageRoot = Bun.fileURLToPath(new URL("..", import.meta.url));
const generatedClientPath = join(packageRoot, "src/generated/effect.gen.ts");

type OpenApiObject = Record<string, unknown>;

class PostHogOpenApiGenerationError extends Data.TaggedError(
  "PostHogOpenApiGenerationError"
)<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

const generatePostHogClient = Config.url("POSTHOG_OPENAPI_SCHEMA_URL").pipe(
  Config.withDefault(new URL("https://eu.posthog.com/api/schema/?format=json")),
  Effect.map((schemaUrl) => ({ schemaUrl })),
  Effect.bind("schema", downloadPostHogSchema),
  Effect.bind("featureFlagSchema", ({ schema, schemaUrl }) =>
    extractPostHogFeatureFlagSpec({ input: schema, sourceUrl: schemaUrl })
  ),
  Effect.flatMap(({ featureFlagSchema }) =>
    Effect.acquireUseRelease(
      createTemporaryDirectory(),
      (temporaryDirectory) =>
        runOpenApiGenerator({
          schema: featureFlagSchema,
          temporaryDirectory,
        }),
      removeTemporaryDirectory
    )
  )
);

function downloadPostHogSchema(input: { readonly schemaUrl: URL }) {
  return Effect.tryPromise({
    try: () =>
      fetch(input.schemaUrl, {
        headers: { Accept: "application/vnd.oai.openapi+json" },
        signal: AbortSignal.timeout(30_000),
      }),
    catch: (cause) =>
      new PostHogOpenApiGenerationError({
        message: "Could not download PostHog's OpenAPI schema.",
        cause,
      }),
  }).pipe(
    Effect.flatMap((response) =>
      response.ok
        ? Effect.succeed(response)
        : Effect.fail(
            new PostHogOpenApiGenerationError({
              message: `PostHog's OpenAPI schema request failed with status ${response.status}.`,
            })
          )
    ),
    Effect.flatMap((response) =>
      Effect.tryPromise({
        try: () => response.json(),
        catch: (cause) =>
          new PostHogOpenApiGenerationError({
            message: "Could not decode PostHog's OpenAPI schema.",
            cause,
          }),
      })
    )
  );
}

function createTemporaryDirectory() {
  return Effect.tryPromise({
    try: () => mkdtemp(join(tmpdir(), "deskohub-posthog-openapi-")),
    catch: (cause) =>
      new PostHogOpenApiGenerationError({
        message: "Could not create a temporary OpenAPI generation directory.",
        cause,
      }),
  });
}

function removeTemporaryDirectory(temporaryDirectory: string) {
  return Effect.tryPromise({
    try: () => rm(temporaryDirectory, { force: true, recursive: true }),
    catch: (cause) =>
      new PostHogOpenApiGenerationError({
        message: "Could not remove the temporary OpenAPI generation directory.",
        cause,
      }),
  });
}

const runOpenApiGenerator = (input: {
  readonly schema: OpenApiObject;
  readonly temporaryDirectory: string;
}) =>
  Effect.succeed(input).pipe(
    Effect.let("temporarySpecPath", ({ temporaryDirectory }) =>
      join(temporaryDirectory, "posthog-feature-flags.openapi.json")
    ),
    Effect.let(
      "temporaryOutputPath",
      () => `${generatedClientPath}.${crypto.randomUUID()}.tmp`
    ),
    Effect.tap(writeOpenApiSpec),
    Effect.bind("generator", startOpenApiGenerator),
    Effect.bind("generatorResult", readOpenApiGeneratorResult),
    Effect.bind("generatedClient", requireGeneratedClient),
    Effect.tap(writeGeneratedClient),
    Effect.tap(publishGeneratedClient),
    Effect.map(() => undefined)
  );

const writeOpenApiSpec = (input: {
  readonly schema: OpenApiObject;
  readonly temporarySpecPath: string;
}) =>
  Effect.tryPromise({
    try: () =>
      Bun.write(input.temporarySpecPath, `${JSON.stringify(input.schema)}\n`),
    catch: (cause) =>
      new PostHogOpenApiGenerationError({
        message: "Could not write the projected PostHog OpenAPI schema.",
        cause,
      }),
  });

const startOpenApiGenerator = (input: { readonly temporarySpecPath: string }) =>
  Effect.try({
    try: () =>
      Bun.spawn(
        [
          "bunx",
          "openapigen",
          "--spec",
          input.temporarySpecPath,
          "--name",
          "PostHogClient",
          "--format",
          "httpclient",
        ],
        {
          cwd: packageRoot,
          stderr: "pipe",
          stdout: "pipe",
        }
      ),
    catch: (cause) =>
      new PostHogOpenApiGenerationError({
        message: "Could not start the PostHog OpenAPI generator.",
        cause,
      }),
  });

const readOpenApiGeneratorResult = (input: {
  readonly generator: Bun.ReadableSubprocess;
}) =>
  Effect.all({
    exitCode: Effect.tryPromise({
      try: () => input.generator.exited,
      catch: (cause) =>
        new PostHogOpenApiGenerationError({
          message: "Could not wait for the PostHog OpenAPI generator.",
          cause,
        }),
    }),
    generatedClient: Effect.tryPromise({
      try: () => new Response(input.generator.stdout).text(),
      catch: (cause) =>
        new PostHogOpenApiGenerationError({
          message: "Could not read the generated PostHog API client.",
          cause,
        }),
    }),
    generatorError: Effect.tryPromise({
      try: () => new Response(input.generator.stderr).text(),
      catch: (cause) =>
        new PostHogOpenApiGenerationError({
          message: "Could not read the PostHog OpenAPI generator error.",
          cause,
        }),
    }),
  });

const requireGeneratedClient = (input: {
  readonly generatorResult: {
    readonly exitCode: number;
    readonly generatedClient: string;
    readonly generatorError: string;
  };
}) =>
  input.generatorResult.exitCode === 0
    ? Effect.succeed(input.generatorResult.generatedClient)
    : Effect.fail(
        new PostHogOpenApiGenerationError({
          message: "PostHog OpenAPI client generation failed.",
          cause: new Error(
            input.generatorResult.generatorError || "OpenAPI generator failed"
          ),
        })
      );

const writeGeneratedClient = (input: {
  readonly generatedClient: string;
  readonly temporaryOutputPath: string;
}) =>
  Effect.tryPromise({
    try: () =>
      Bun.write(
        input.temporaryOutputPath,
        input.generatedClient.replace(/[ \t]+$/gm, "")
      ),
    catch: (cause) =>
      new PostHogOpenApiGenerationError({
        message: "Could not write the generated PostHog API client.",
        cause,
      }),
  });

const publishGeneratedClient = (input: {
  readonly temporaryOutputPath: string;
}) =>
  Effect.tryPromise({
    try: () => rename(input.temporaryOutputPath, generatedClientPath),
    catch: (cause) =>
      new PostHogOpenApiGenerationError({
        message: "Could not publish the generated PostHog API client.",
        cause,
      }),
  });

export const extractPostHogFeatureFlagSpec = (input: {
  readonly input: unknown;
  readonly sourceUrl: URL;
}): Effect.Effect<OpenApiObject, PostHogOpenApiGenerationError> =>
  Effect.gen(function* () {
    const schema = yield* requireOpenApiObject(input.input);
    const paths = yield* requireOpenApiObject(schema.paths);
    const sourcePath = yield* requireOpenApiObject(paths[featureFlagsPath]);
    const operation = yield* requireOpenApiObject(sourcePath.get);
    const components = yield* requireOpenApiObject(schema.components);
    const schemas = yield* requireOpenApiObject(components.schemas);
    const featureFlag = yield* requireOpenApiObject(schemas.FeatureFlag);
    const featureFlagProperties = yield* requireOpenApiObject(
      featureFlag.properties
    );
    const paginatedFeatureFlags = yield* requireOpenApiObject(
      schemas.PaginatedFeatureFlagList
    );
    const pageProperties = yield* requireOpenApiObject(
      paginatedFeatureFlags.properties
    );

    yield* requireOpenApiObject(schemas.FeatureFlagFiltersSchema);
    schemas[listItemSchemaName] = {
      type: "object",
      required: ["key"],
      properties: {
        archived: yield* requireOpenApiObject(featureFlagProperties.archived),
        deleted: yield* requireOpenApiObject(featureFlagProperties.deleted),
        filters: { $ref: filtersSchemaReference },
        key: yield* requireOpenApiObject(featureFlagProperties.key),
      },
    };
    schemas[listPageSchemaName] = {
      type: "object",
      required: ["count", "results"],
      properties: {
        count: yield* requireOpenApiObject(pageProperties.count),
        next: yield* requireOpenApiObject(pageProperties.next),
        previous: yield* requireOpenApiObject(pageProperties.previous),
        results: {
          type: "array",
          items: { $ref: listItemSchemaReference },
        },
      },
    };

    const responses = yield* requireOpenApiObject(operation.responses);
    const successResponse = yield* requireOpenApiObject(responses["200"]);
    const responseContent = yield* requireOpenApiObject(
      successResponse.content
    );
    const jsonResponse = yield* requireOpenApiObject(
      responseContent["application/json"]
    );
    jsonResponse.schema = { $ref: listPageSchemaReference };

    const selectedComponents = yield* selectReferencedComponents({
      components,
      operation,
    });
    const securitySchemes = yield* requireOpenApiObject(
      components.securitySchemes
    );
    const securityRequirements = yield* getSecurityRequirements(operation);

    for (const requirement of securityRequirements) {
      const selectedSecuritySchemes = selectedComponents.securitySchemes ?? {};
      selectedComponents.securitySchemes = selectedSecuritySchemes;
      selectedSecuritySchemes[requirement] = yield* requireOpenApiObject(
        securitySchemes[requirement]
      );
    }

    const info = yield* requireOpenApiObject(schema.info);
    return yield* normalizeNullableTypes({
      openapi: schema.openapi,
      info: {
        title: "PostHog Feature Flags API",
        version: info.version,
        "x-source": input.sourceUrl.toString(),
      },
      paths: {
        [featureFlagsPath]: {
          ...(sourcePath.parameters === undefined
            ? {}
            : { parameters: sourcePath.parameters }),
          get: operation,
        },
      },
      components: selectedComponents,
    });
  });

const requireOpenApiObject = (
  value: unknown
): Effect.Effect<OpenApiObject, PostHogOpenApiGenerationError> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? Effect.succeed(value as OpenApiObject)
    : Effect.fail(invalidPostHogOpenApiSchema());

const collectReferences = (value: unknown, references: Set<string>): void => {
  if (Array.isArray(value)) {
    for (const item of value) collectReferences(item, references);
    return;
  }

  if (value === null || typeof value !== "object") return;

  for (const [key, item] of Object.entries(value)) {
    if (key === "$ref" && typeof item === "string") references.add(item);
    else collectReferences(item, references);
  }
};

const selectReferencedComponents = (input: {
  readonly components: OpenApiObject;
  readonly operation: OpenApiObject;
}) =>
  Effect.gen(function* () {
    const selectedComponents: Record<string, OpenApiObject> = {};
    const pendingReferences = new Set<string>();
    collectReferences(input.operation, pendingReferences);

    for (const reference of pendingReferences) {
      const [section, name] = yield* parseComponentReference(reference);
      const sourceSection = yield* requireOpenApiObject(
        input.components[section]
      );
      const component = yield* requireOpenApiObject(sourceSection[name]);
      const selectedSection = selectedComponents[section] ?? {};
      selectedComponents[section] = selectedSection;
      selectedSection[name] = component;
      collectReferences(component, pendingReferences);
    }

    return selectedComponents;
  });

const parseComponentReference = (reference: string) => {
  const match = reference.match(/^#\/components\/([^/]+)\/([^/]+)$/);
  return match?.[1] && match[2]
    ? Effect.succeed([match[1], match[2]] as const)
    : Effect.fail(invalidPostHogOpenApiSchema());
};

const getSecurityRequirements = (operation: OpenApiObject) =>
  Array.isArray(operation.security)
    ? Effect.forEach(operation.security, requireOpenApiObject).pipe(
        Effect.map((requirements) =>
          requirements.flatMap((requirement) => Object.keys(requirement))
        )
      )
    : Effect.succeed([]);

const normalizeNullableTypes = (
  value: OpenApiObject
): Effect.Effect<OpenApiObject, PostHogOpenApiGenerationError> =>
  Effect.gen(function* () {
    for (const [key, item] of Object.entries(value)) {
      if (Array.isArray(item)) {
        if (key === "type" && item.includes("null")) {
          const definedTypes = item.filter((type) => type !== "null");
          if (definedTypes.length !== 1) {
            return yield* Effect.fail(invalidPostHogOpenApiSchema());
          }

          value.oneOf = [
            {
              type: definedTypes[0],
              ...(typeof value.format === "string"
                ? { format: value.format }
                : {}),
            },
            { type: "null" },
          ];
          delete value.type;
          delete value.format;
          continue;
        }

        for (const child of item) {
          if (
            child !== null &&
            typeof child === "object" &&
            !Array.isArray(child)
          ) {
            yield* normalizeNullableTypes(child as OpenApiObject);
          }
        }
        continue;
      }

      if (item !== null && typeof item === "object") {
        yield* normalizeNullableTypes(item as OpenApiObject);
      }
    }

    return value;
  });

const invalidPostHogOpenApiSchema = () =>
  new PostHogOpenApiGenerationError({
    message:
      "PostHog's OpenAPI schema no longer contains the expected feature flag definitions.",
  });

const runPostHogClientGenerator = generatePostHogClient.pipe(
  Effect.matchEffect({
    onFailure: () =>
      Effect.tryPromise({
        try: () =>
          Bun.write(Bun.stderr, "PostHog API client generation failed.\n"),
        catch: (cause) =>
          new PostHogOpenApiGenerationError({
            message: "Could not write the PostHog generator failure message.",
            cause,
          }),
      }).pipe(
        Effect.tap(() =>
          Effect.sync(() => {
            process.exitCode = 1;
          })
        )
      ),
    onSuccess: () =>
      Effect.tryPromise({
        try: () => Bun.write(Bun.stdout, "Generated PostHog API client.\n"),
        catch: (cause) =>
          new PostHogOpenApiGenerationError({
            message: "Could not write the PostHog generator success message.",
            cause,
          }),
      }),
  })
);

if (import.meta.main) {
  Effect.runPromise(runPostHogClientGenerator);
}
