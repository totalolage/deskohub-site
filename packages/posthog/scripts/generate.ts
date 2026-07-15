import { $ } from "bun";
import { Config, Data, Effect } from "effect";
import * as FetchHttpClient from "effect/unstable/http/FetchHttpClient";
import * as HttpClient from "effect/unstable/http/HttpClient";
import * as HttpClientResponse from "effect/unstable/http/HttpClientResponse";

const packageRoot = Bun.fileURLToPath(new URL("..", import.meta.url));
const generatedClientPath = Bun.fileURLToPath(
  new URL("../src/generated/effect.gen.ts", import.meta.url)
);

class PostHogOpenApiGenerationError extends Data.TaggedError(
  "PostHogOpenApiGenerationError"
)<{
  readonly message: string;
  readonly cause?: unknown;
}> {}

const writeFile = (path: string, content: ArrayBuffer | string) =>
  Effect.tryPromise({
    try: () => Bun.write(path, content),
    catch: (cause) =>
      new PostHogOpenApiGenerationError({
        message: `Could not write ${path}.`,
        cause,
      }),
  }).pipe(Effect.asVoid);

const downloadSchema = (schemaUrl: URL, outputPath: string) =>
  HttpClient.get(schemaUrl).pipe(
    Effect.flatMap(HttpClientResponse.filterStatusOk),
    Effect.flatMap((response) => response.arrayBuffer),
    Effect.flatMap((schema) => writeFile(outputPath, schema)),
    Effect.mapError((cause) =>
      cause instanceof PostHogOpenApiGenerationError
        ? cause
        : new PostHogOpenApiGenerationError({
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

const generateClient = (schemaPath: string) =>
  Effect.tryPromise({
    try: () =>
      $`bunx openapigen --spec ${schemaPath} --name PostHogClient --format httpclient`
        .cwd(packageRoot)
        .quiet()
        .text(),
    catch: (cause) =>
      new PostHogOpenApiGenerationError({
        message: "Could not generate the PostHog API client.",
        cause,
      }),
  }).pipe(
    Effect.flatMap((generatedClient) =>
      writeFile(
        generatedClientPath,
        `// @ts-nocheck -- generated from PostHog's complete OpenAPI schema\n${generatedClient.replace(/[ \t]+$/gm, "")}`
      )
    )
  );

const removeTemporarySchema = (schemaPath: string) =>
  Effect.tryPromise({
    try: () => $`rm -f ${schemaPath}`.quiet(),
    catch: (cause) =>
      new PostHogOpenApiGenerationError({
        message: "Could not remove the temporary PostHog OpenAPI schema.",
        cause,
      }),
  }).pipe(Effect.asVoid);

const generatePostHogClient = Config.url("POSTHOG_OPENAPI_SCHEMA_URL").pipe(
  Config.withDefault(new URL("https://eu.posthog.com/api/schema/?format=json")),
  Effect.flatMap((schemaUrl) =>
    Effect.acquireUseRelease(
      Effect.sync(
        () =>
          `${(Bun.env.TMPDIR ?? "/tmp").replace(/\/$/, "")}/deskohub-posthog-openapi-${crypto.randomUUID()}.json`
      ),
      (schemaPath) =>
        downloadSchema(schemaUrl, schemaPath).pipe(
          Effect.andThen(generateClient(schemaPath))
        ),
      removeTemporarySchema
    )
  )
);

if (import.meta.main) {
  Effect.runPromise(
    generatePostHogClient.pipe(Effect.provide(FetchHttpClient.layer))
  );
}
