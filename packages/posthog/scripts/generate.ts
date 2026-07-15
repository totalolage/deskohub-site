import { mkdir, mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Config, Data, Effect } from "effect";

const featureFlagsPath = "/api/projects/{project_id}/feature_flags/";
const filtersSchemaReference = "#/components/schemas/FeatureFlagFiltersSchema";
const listItemSchemaName = "PostHogFeatureFlagListItem";
const listItemSchemaReference = `#/components/schemas/${listItemSchemaName}`;
const listPageSchemaName = "PostHogFeatureFlagListPage";
const listPageSchemaReference = `#/components/schemas/${listPageSchemaName}`;
const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const generatedClientPath = join(packageRoot, "src/generated/effect.gen.ts");

type OpenApiObject = Record<string, unknown>;

class PostHogOpenApiGenerationError extends Data.TaggedError(
  "PostHogOpenApiGenerationError"
)<{
  readonly message: string;
}> {}

const generatePostHogClient = Effect.gen(function* () {
  const schemaUrl = yield* Config.url("POSTHOG_OPENAPI_SCHEMA_URL").pipe(
    Config.withDefault(
      new URL("https://eu.posthog.com/api/schema/?format=json")
    )
  );
  const schema = yield* downloadPostHogSchema(schemaUrl);
  const featureFlagSchema = yield* Effect.try({
    try: () => extractPostHogFeatureFlagSpec(schema, schemaUrl),
    catch: () =>
      new PostHogOpenApiGenerationError({
        message:
          "PostHog's OpenAPI schema no longer contains the expected feature flag definitions.",
      }),
  });

  yield* Effect.acquireUseRelease(
    Effect.tryPromise({
      try: () => mkdtemp(join(tmpdir(), "deskohub-posthog-openapi-")),
      catch: () =>
        new PostHogOpenApiGenerationError({
          message: "Could not create a temporary OpenAPI generation directory.",
        }),
    }),
    (temporaryDirectory) =>
      runOpenApiGenerator(featureFlagSchema, temporaryDirectory),
    (temporaryDirectory) =>
      Effect.promise(() =>
        rm(temporaryDirectory, { force: true, recursive: true })
      )
  );
});

const downloadPostHogSchema = (schemaUrl: URL) =>
  Effect.tryPromise({
    try: async () => {
      const response = await fetch(schemaUrl, {
        headers: { Accept: "application/vnd.oai.openapi+json" },
        signal: AbortSignal.timeout(30_000),
      });

      if (!response.ok) throw new Error("OpenAPI download failed");
      return response.json();
    },
    catch: () =>
      new PostHogOpenApiGenerationError({
        message: "Could not download PostHog's OpenAPI schema.",
      }),
  });

const runOpenApiGenerator = (
  schema: OpenApiObject,
  temporaryDirectory: string
) =>
  Effect.tryPromise({
    try: async () => {
      const temporarySpecPath = join(
        temporaryDirectory,
        "posthog-feature-flags.openapi.json"
      );
      const temporaryOutputPath = `${generatedClientPath}.${crypto.randomUUID()}.tmp`;
      await writeFile(temporarySpecPath, `${JSON.stringify(schema)}\n`);

      const generator = Bun.spawn(
        [
          "bunx",
          "openapigen",
          "--spec",
          temporarySpecPath,
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
      );
      const [exitCode, generatedClient, generatorError] = await Promise.all([
        generator.exited,
        new Response(generator.stdout).text(),
        new Response(generator.stderr).text(),
      ]);

      if (exitCode !== 0) {
        throw new Error(generatorError || "OpenAPI generator failed");
      }

      await mkdir(dirname(generatedClientPath), { recursive: true });
      await writeFile(
        temporaryOutputPath,
        generatedClient.replace(/[ \t]+$/gm, "")
      );
      await rename(temporaryOutputPath, generatedClientPath);
    },
    catch: () =>
      new PostHogOpenApiGenerationError({
        message: "Could not generate the PostHog API client.",
      }),
  });

export const extractPostHogFeatureFlagSpec = (
  input: unknown,
  sourceUrl: URL
): OpenApiObject => {
  const schema = requireOpenApiObject(input);
  const paths = requireOpenApiObject(schema.paths);
  const sourcePath = requireOpenApiObject(paths[featureFlagsPath]);
  const operation = requireOpenApiObject(sourcePath.get);
  const components = requireOpenApiObject(schema.components);
  const schemas = requireOpenApiObject(components.schemas);
  const featureFlag = requireOpenApiObject(schemas.FeatureFlag);
  const featureFlagProperties = requireOpenApiObject(featureFlag.properties);
  const paginatedFeatureFlags = requireOpenApiObject(
    schemas.PaginatedFeatureFlagList
  );
  const pageProperties = requireOpenApiObject(paginatedFeatureFlags.properties);

  requireOpenApiObject(schemas.FeatureFlagFiltersSchema);
  schemas[listItemSchemaName] = {
    type: "object",
    required: ["key"],
    properties: {
      archived: requireOpenApiObject(featureFlagProperties.archived),
      deleted: requireOpenApiObject(featureFlagProperties.deleted),
      filters: { $ref: filtersSchemaReference },
      key: requireOpenApiObject(featureFlagProperties.key),
    },
  };
  schemas[listPageSchemaName] = {
    type: "object",
    required: ["count", "results"],
    properties: {
      count: requireOpenApiObject(pageProperties.count),
      next: requireOpenApiObject(pageProperties.next),
      previous: requireOpenApiObject(pageProperties.previous),
      results: {
        type: "array",
        items: { $ref: listItemSchemaReference },
      },
    },
  };

  const responses = requireOpenApiObject(operation.responses);
  const successResponse = requireOpenApiObject(responses["200"]);
  const responseContent = requireOpenApiObject(successResponse.content);
  const jsonResponse = requireOpenApiObject(
    responseContent["application/json"]
  );
  jsonResponse.schema = { $ref: listPageSchemaReference };

  const selectedComponents: Record<string, OpenApiObject> = {};
  const pendingReferences = new Set<string>();
  collectReferences(operation, pendingReferences);

  for (const reference of pendingReferences) {
    const [section, name] = parseComponentReference(reference);
    const sourceSection = requireOpenApiObject(components[section]);
    const component = requireOpenApiObject(sourceSection[name]);
    const selectedSection = selectedComponents[section] ?? {};
    selectedComponents[section] = selectedSection;
    selectedSection[name] = component;
    collectReferences(component, pendingReferences);
  }

  const securitySchemes = requireOpenApiObject(components.securitySchemes);
  for (const requirement of getSecurityRequirements(operation)) {
    const selectedSecuritySchemes = selectedComponents.securitySchemes ?? {};
    selectedComponents.securitySchemes = selectedSecuritySchemes;
    selectedSecuritySchemes[requirement] = requireOpenApiObject(
      securitySchemes[requirement]
    );
  }

  return normalizeNullableTypes({
    openapi: schema.openapi,
    info: {
      title: "PostHog Feature Flags API",
      version: requireOpenApiObject(schema.info).version,
      "x-source": sourceUrl.toString(),
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
};

const requireOpenApiObject = (value: unknown): OpenApiObject => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Expected an OpenAPI object");
  }

  return value as OpenApiObject;
};

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

const parseComponentReference = (reference: string) => {
  const match = reference.match(/^#\/components\/([^/]+)\/([^/]+)$/);
  if (!match?.[1] || !match[2])
    throw new Error("Unsupported OpenAPI reference");
  return [match[1], match[2]] as const;
};

const getSecurityRequirements = (operation: OpenApiObject) => {
  if (!Array.isArray(operation.security)) return [];

  return operation.security.flatMap((requirement) =>
    Object.keys(requireOpenApiObject(requirement))
  );
};

const normalizeNullableTypes = (value: OpenApiObject): OpenApiObject => {
  for (const [key, item] of Object.entries(value)) {
    if (Array.isArray(item)) {
      if (key === "type" && item.includes("null")) {
        const definedTypes = item.filter((type) => type !== "null");
        if (definedTypes.length !== 1) {
          throw new Error("Unsupported nullable OpenAPI type union");
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
          normalizeNullableTypes(child as OpenApiObject);
        }
      }
      continue;
    }

    if (item !== null && typeof item === "object") {
      normalizeNullableTypes(item as OpenApiObject);
    }
  }

  return value;
};

if (import.meta.main) {
  Effect.runPromise(generatePostHogClient).then(
    () => process.stdout.write("Generated PostHog API client.\n"),
    () => {
      process.stderr.write("PostHog API client generation failed.\n");
      process.exitCode = 1;
    }
  );
}
