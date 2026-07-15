import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { extractPostHogFeatureFlagSpec } from "./generate";

describe("extractPostHogFeatureFlagSpec", () => {
  test("projects the list operation from current PostHog definitions", () => {
    const schema = Effect.runSync(
      extractPostHogFeatureFlagSpec({
        input: {
          openapi: "3.1.0",
          info: { title: "PostHog API", version: "1.0.0" },
          paths: {
            "/api/projects/{project_id}/feature_flags/": {
              get: {
                operationId: "feature_flags_list",
                responses: {
                  200: {
                    content: {
                      "application/json": {
                        schema: {
                          $ref: "#/components/schemas/PaginatedFeatureFlagList",
                        },
                      },
                    },
                  },
                },
                security: [{ PersonalAPIKeyAuth: ["feature_flag:read"] }],
              },
            },
          },
          components: {
            schemas: {
              PaginatedFeatureFlagList: {
                properties: {
                  count: { type: "integer" },
                  next: { type: ["string", "null"] },
                  previous: { type: ["string", "null"] },
                  results: {
                    items: { $ref: "#/components/schemas/FeatureFlag" },
                    type: "array",
                  },
                },
                type: "object",
              },
              FeatureFlag: {
                properties: {
                  archived: { type: "boolean" },
                  deleted: { type: "boolean" },
                  filters: { type: "object" },
                  key: { type: "string" },
                },
                type: "object",
              },
              FeatureFlagFiltersSchema: {
                properties: {
                  multivariate: {
                    $ref: "#/components/schemas/FeatureFlagMultivariateSchema",
                  },
                },
                type: "object",
              },
              FeatureFlagMultivariateSchema: { type: "object" },
              UnrelatedSchema: { type: "object" },
            },
            securitySchemes: {
              PersonalAPIKeyAuth: { scheme: "bearer", type: "http" },
            },
          },
        },
        sourceUrl: new URL("https://example.com/api/schema/"),
      })
    );

    expect(schema.paths).toHaveProperty(
      "/api/projects/{project_id}/feature_flags/"
    );
    expect(schema.components).toEqual({
      schemas: {
        FeatureFlagFiltersSchema: {
          properties: {
            multivariate: {
              $ref: "#/components/schemas/FeatureFlagMultivariateSchema",
            },
          },
          type: "object",
        },
        FeatureFlagMultivariateSchema: { type: "object" },
        PostHogFeatureFlagListItem: {
          properties: {
            archived: { type: "boolean" },
            deleted: { type: "boolean" },
            filters: {
              $ref: "#/components/schemas/FeatureFlagFiltersSchema",
            },
            key: { type: "string" },
          },
          required: ["key"],
          type: "object",
        },
        PostHogFeatureFlagListPage: {
          properties: {
            count: { type: "integer" },
            next: {
              oneOf: [{ type: "string" }, { type: "null" }],
            },
            previous: {
              oneOf: [{ type: "string" }, { type: "null" }],
            },
            results: {
              items: {
                $ref: "#/components/schemas/PostHogFeatureFlagListItem",
              },
              type: "array",
            },
          },
          required: ["count", "results"],
          type: "object",
        },
      },
      securitySchemes: {
        PersonalAPIKeyAuth: { scheme: "bearer", type: "http" },
      },
    });
  });

  test("returns invalid PostHog definitions through the Effect error channel", () => {
    const error = Effect.runSync(
      extractPostHogFeatureFlagSpec({
        input: { openapi: "3.1.0" },
        sourceUrl: new URL("https://example.com/api/schema/"),
      }).pipe(Effect.flip)
    );

    expect(error._tag).toBe("PostHogOpenApiGenerationError");
  });
});
