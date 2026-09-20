import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import * as OpenApiGenerator from "@effect/openapi-generator/OpenApiGenerator";
import { Effect, Schema } from "effect";
import type { OpenAPISpec } from "effect/unstable/httpapi/OpenApi";

const recursiveSpec = {
  openapi: "3.1.0",
  info: { title: "Recursive source fields", version: "1.0.0" },
  security: [],
  tags: [],
  paths: {
    "/fields": {
      get: {
        operationId: "getFields",
        parameters: [],
        security: [],
        tags: ["fields"],
        responses: {
          "200": {
            description: "Source fields",
            content: {
              "application/json": {
                schema: {
                  $ref: "#/components/schemas/SourceFieldSelectConfig",
                },
              },
            },
          },
        },
      },
    },
  },
  components: {
    securitySchemes: {},
    schemas: {
      SourceFieldSelectConfig: {
        type: "object",
        required: ["options"],
        properties: {
          options: {
            type: "array",
            items: {
              $ref: "#/components/schemas/SourceFieldSelectConfigOption",
            },
          },
        },
      },
      SourceFieldSelectConfigOption: {
        type: "object",
        required: ["value"],
        properties: {
          value: { type: "string" },
          fields: {
            type: "array",
            items: { $ref: "#/components/schemas/SourceFieldSelectConfig" },
          },
        },
      },
    },
  },
} satisfies OpenAPISpec;

test.each(["httpclient", "httpapi"] as const)(
  "generated %s mutually recursive schemas initialize and validate nested fields",
  async (format) => {
    const source = await Effect.runPromise(
      Effect.gen(function* () {
        const generator = yield* OpenApiGenerator.OpenApiGenerator;
        return yield* generator.generate(recursiveSpec, {
          format,
          name: "RecursiveClient",
        });
      }).pipe(Effect.provide(OpenApiGenerator.layerTransformerSchema))
    );
    const directory = await mkdtemp(
      Bun.fileURLToPath(new URL(".generate-test-", import.meta.url))
    );
    try {
      const path = `${directory}/client.ts`;
      await Bun.write(path, source);
      const generated = await import(path);
      const decode = Schema.decodeUnknownSync(
        generated.SourceFieldSelectConfig
      );
      const value = {
        options: [
          { value: "outer", fields: [{ options: [{ value: "inner" }] }] },
        ],
      };
      expect(decode(value)).toEqual(value);
      expect(() =>
        decode({
          options: [{ value: "outer", fields: [{ options: [{ value: 1 }] }] }],
        })
      ).toThrow();
      const decodeOption = Schema.decodeUnknownSync(
        generated.SourceFieldSelectConfigOption
      );
      expect(decodeOption(value.options[0])).toEqual(value.options[0]);
      expect(() =>
        decodeOption({ value: "outer", fields: [{ options: "invalid" }] })
      ).toThrow();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
);
