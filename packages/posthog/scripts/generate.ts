import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import * as OpenApiGenerator from "@effect/openapi-generator/OpenApiGenerator";
import * as OpenApiPatch from "@effect/openapi-generator/OpenApiPatch";
import { Data, Effect } from "effect";
import type { OpenAPISpec } from "effect/unstable/httpapi/OpenApi";

const generatedClientPath = Bun.fileURLToPath(
  new URL("../src/generated/effect.gen.ts", import.meta.url)
);
const schemaPath = new URL("../posthog-openapi.json.gz", import.meta.url);
const schemaDigestPath = new URL(
  "../posthog-openapi.json.gz.sha256",
  import.meta.url
);

const postHogOpenApiCompatibilityPatch: OpenApiPatch.JsonPatchDocument = [
  {
    op: "replace",
    path: "/components/schemas/PaginatedFeatureFlagList/properties/next",
    value: {
      oneOf: [{ type: "string", format: "uri" }, { enum: [null] }],
    },
  },
  {
    op: "replace",
    path: "/components/schemas/PaginatedFeatureFlagList/properties/previous",
    value: {
      oneOf: [{ type: "string", format: "uri" }, { enum: [null] }],
    },
  },
  {
    op: "replace",
    path: "/components/schemas/UserBasic/properties/hedgehog_config",
    value: {
      oneOf: [{ type: "object", additionalProperties: true }, { enum: [null] }],
      readOnly: true,
    },
  },
  {
    op: "replace",
    path: "/components/schemas/FeatureFlag/properties/surveys",
    value: { readOnly: true },
  },
  {
    op: "replace",
    path: "/components/schemas/FeatureFlag/properties/features",
    value: { readOnly: true },
  },
  {
    op: "replace",
    path: "/components/schemas/FeatureFlag/properties/last_called_at",
    value: {
      oneOf: [{ type: "string", format: "date-time" }, { enum: [null] }],
      description:
        "Last time this feature flag was called (from $feature_flag_called events)",
    },
  },
];

class PostHogOpenApiGenerationError extends Data.TaggedError(
  "PostHogOpenApiGenerationError"
)<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

const writeGeneratedClient = (generatedClient: string) =>
  Effect.tryPromise({
    try: () =>
      Bun.write(
        generatedClientPath,
        `// @ts-nocheck -- generated from PostHog's complete OpenAPI schema\n${generatedClient.replace(/[ \t]+$/gm, "")}`
      ),
    catch: (cause) =>
      new PostHogOpenApiGenerationError({
        message: "Could not write the generated PostHog API client.",
        cause,
      }),
  }).pipe(Effect.asVoid);

const readPinnedSchema = Effect.tryPromise({
  try: async () => {
    const [compressed, expectedDigest] = await Promise.all([
      Bun.file(schemaPath).arrayBuffer(),
      Bun.file(schemaDigestPath).text(),
    ]);
    const bytes = new Uint8Array(compressed);
    const actualDigest = createHash("sha256").update(bytes).digest("hex");
    if (actualDigest !== expectedDigest.trim()) {
      throw new Error("PostHog OpenAPI schema digest mismatch.");
    }
    return JSON.parse(gunzipSync(bytes).toString("utf8")) as unknown;
  },
  catch: (cause) =>
    new PostHogOpenApiGenerationError({
      message: "Could not read the pinned PostHog OpenAPI schema.",
      cause,
    }),
});

const generatePostHogClient = Effect.gen(function* () {
  const schema = yield* readPinnedSchema;
  const compatibleSchema = yield* OpenApiPatch.applyPatches(
    [
      {
        source: "PostHog OpenAPI 3.1 nullable compatibility",
        patch: postHogOpenApiCompatibilityPatch,
      },
    ],
    schema as never
  ).pipe(
    Effect.mapError(
      (cause) =>
        new PostHogOpenApiGenerationError({
          message:
            "Could not apply PostHog OpenAPI generator compatibility patches.",
          cause,
        })
    )
  );
  const generator = yield* OpenApiGenerator.OpenApiGenerator;
  const generatedClient = yield* generator.generate(
    compatibleSchema as unknown as OpenAPISpec,
    {
      format: "httpclient",
      name: "PostHogClient",
    }
  );
  yield* writeGeneratedClient(generatedClient);
});

if (import.meta.main) {
  Effect.runPromise(
    generatePostHogClient.pipe(
      Effect.provide(OpenApiGenerator.layerTransformerSchema)
    )
  );
}
