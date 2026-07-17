import * as OpenApiGenerator from "@effect/openapi-generator/OpenApiGenerator";
import * as OpenApiPatch from "@effect/openapi-generator/OpenApiPatch";
import { Config, Data, Effect } from "effect";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientResponse,
} from "effect/unstable/http";
import type { OpenAPISpec } from "effect/unstable/httpapi/OpenApi";

const generatedClientPath = Bun.fileURLToPath(
  new URL("../src/generated/effect.gen.ts", import.meta.url)
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

const downloadSchema = (schemaUrl: URL) =>
  HttpClient.get(schemaUrl).pipe(
    Effect.flatMap(HttpClientResponse.filterStatusOk),
    Effect.flatMap((response) => response.json),
    Effect.mapError(
      (cause) =>
        new PostHogOpenApiGenerationError({
          message: "Could not download PostHog's OpenAPI schema.",
          cause,
        })
    ),
    Effect.timeoutOrElse({
      duration: "30 seconds",
      orElse: () =>
        Effect.fail(
          new PostHogOpenApiGenerationError({
            message: "PostHog's OpenAPI schema download timed out.",
          })
        ),
    })
  );

const generatePostHogClient = Effect.gen(function* () {
  const schemaUrl = yield* Config.url("POSTHOG_OPENAPI_SCHEMA_URL").pipe(
    Config.withDefault(
      new URL("https://eu.posthog.com/api/schema/?format=json")
    )
  );
  const schema = yield* downloadSchema(schemaUrl);
  const compatibleSchema = yield* OpenApiPatch.applyPatches(
    [
      {
        source: "PostHog OpenAPI 3.1 nullable compatibility",
        patch: postHogOpenApiCompatibilityPatch,
      },
    ],
    schema
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
      Effect.provide(OpenApiGenerator.layerTransformerSchema),
      Effect.provide(FetchHttpClient.layer)
    )
  );
}
