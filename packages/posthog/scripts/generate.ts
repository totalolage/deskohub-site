import * as OpenApiGenerator from "@effect/openapi-generator/OpenApiGenerator";
import { Config, Data, Effect } from "effect";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";
import type { OpenAPISpec } from "effect/unstable/httpapi/OpenApi";

const generatedClientPath = Bun.fileURLToPath(
  new URL("../src/generated/effect.gen.ts", import.meta.url)
);

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
    Effect.map((schema) => schema as unknown as OpenAPISpec),
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
  const generator = yield* OpenApiGenerator.OpenApiGenerator;
  const generatedClient = yield* generator.generate(schema, {
    format: "httpclient",
    name: "PostHogClient",
  });
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
