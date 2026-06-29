import { beforeEach, describe, expect, mock, test } from "bun:test";
import { Effect } from "effect";

mock.module("server-only", () => ({}));

type SearchCall = {
  expression: string;
  fields: string[];
  maxResults?: number;
  sort?: readonly [string, string];
};

type ResourceCall = {
  publicId: string;
  options: Record<string, unknown>;
};

const searchCalls: SearchCall[] = [];
const resourceCalls: ResourceCall[] = [];
let queuedResults: unknown[] = [];
let queuedResourceResults: unknown[] = [];
let executeAttempts = 0;
let resourceAttempts = 0;

const cloudinary = {
  config: mock(() => undefined),
  api: {
    resource: mock(
      async (publicId: string, options: Record<string, unknown>) => {
        resourceCalls.push({ publicId, options });
        resourceAttempts += 1;
        const next = queuedResourceResults.shift();
        if (next instanceof Error) throw next;
        if (next && typeof next === "object" && "throw" in next) {
          throw next.throw;
        }
        return next;
      }
    ),
  },
  search: {
    expression: mock((expression: string) => {
      const call: SearchCall = { expression, fields: [] };
      searchCalls.push(call);

      const builder = {
        with_field: mock((field: string) => {
          call.fields.push(field);
          return builder;
        }),
        max_results: mock((maxResults: number) => {
          call.maxResults = maxResults;
          return builder;
        }),
        sort_by: mock((field: string, direction: string) => {
          call.sort = [field, direction];
          return builder;
        }),
        execute: mock(async () => {
          executeAttempts += 1;
          const next = queuedResults.shift();
          if (next instanceof Error) throw next;
          if (next && typeof next === "object" && "throw" in next) {
            throw next.throw;
          }
          return next;
        }),
      };

      return builder;
    }),
  },
};

mock.module("cloudinary", () => ({ v2: cloudinary }));

const { makeCloudinaryRuntimeConfigLayer } = await import("./config");
const { CloudinaryService } = await import("./service");

const config = {
  cloudName: "cloud-name",
  apiKey: "api-key",
  apiSecret: "api-secret",
  defaultMaxResults: 7,
};

const asset = {
  public_id: "gallery/image",
  secure_url: "https://res.cloudinary.com/demo/image/upload/image.jpg",
  url: "http://res.cloudinary.com/demo/image/upload/image.jpg",
  width: 1200,
  height: 800,
  format: "jpg",
  resource_type: "image",
  created_at: "2026-06-20T10:00:00Z",
  tags: ["workspace"],
  context: { custom: { alt: "Desk" } },
};

beforeEach(() => {
  searchCalls.length = 0;
  resourceCalls.length = 0;
  queuedResults = [];
  queuedResourceResults = [];
  executeAttempts = 0;
  resourceAttempts = 0;
  cloudinary.config.mockClear();
  cloudinary.api.resource.mockClear();
  cloudinary.search.expression.mockClear();
});

const makeService = () =>
  Effect.runPromise(
    Effect.gen(function* () {
      return yield* CloudinaryService;
    }).pipe(
      Effect.provide(CloudinaryService.Live),
      Effect.provide(makeCloudinaryRuntimeConfigLayer(config))
    )
  );

describe("CloudinaryService", () => {
  test("gets an image by public ID", async () => {
    queuedResourceResults = [asset];

    const service = await makeService();
    const result = await Effect.runPromise(
      service.getByPublicId("gallery/image")
    );

    expect(result).toEqual(asset);
    expect(resourceCalls).toEqual([
      {
        publicId: "gallery/image",
        options: {
          resource_type: "image",
          type: "upload",
          tags: true,
          context: true,
        },
      },
    ]);
  });

  test("retries 500 public ID lookup failures", async () => {
    queuedResourceResults = [
      { throw: { http_code: 500, message: "first" } },
      asset,
    ];

    const service = await makeService();
    const result = await Effect.runPromise(
      service.getByPublicId("gallery/image")
    );

    expect(result).toEqual(asset);
    expect(resourceAttempts).toBe(2);
  });

  test("fails primitive public ID lookup rejections as CloudinarySearchError", async () => {
    queuedResourceResults = [{ throw: undefined }];

    const service = await makeService();
    const result = await Effect.runPromise(
      service.getByPublicId("gallery/image").pipe(Effect.result)
    );

    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") {
      expect(result.failure._tag).toBe("CloudinarySearchError");
      expect(result.failure.message).toBe("undefined");
      expect(result.failure.httpCode).toBeUndefined();
    }
    expect(resourceAttempts).toBe(1);
  });

  test("ignores malformed public ID lookup error fields", async () => {
    queuedResourceResults = [{ throw: { message: 123, http_code: "500" } }];

    const service = await makeService();
    const result = await Effect.runPromise(
      service.getByPublicId("gallery/image").pipe(Effect.result)
    );

    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") {
      expect(result.failure._tag).toBe("CloudinarySearchError");
      expect(result.failure.message).toBe(
        JSON.stringify({ message: 123, http_code: "500" })
      );
      expect(result.failure.httpCode).toBeUndefined();
    }
    expect(resourceAttempts).toBe(1);
  });

  test("retries nested HTTP codes after malformed top-level fields", async () => {
    queuedResourceResults = [
      {
        throw: {
          http_code: "500",
          error: { http_code: 500, message: "nested" },
        },
      },
      asset,
    ];

    const service = await makeService();
    const result = await Effect.runPromise(
      service.getByPublicId("gallery/image")
    );

    expect(result).toEqual(asset);
    expect(resourceAttempts).toBe(2);
  });

  test("searches with default options and decodes assets", async () => {
    queuedResults = [{ resources: [asset] }];

    const service = await makeService();
    const result = await Effect.runPromise(service.searchAll());

    expect(result).toEqual([asset]);
    expect(searchCalls).toEqual([
      {
        expression: "resource_type:image",
        fields: ["tags", "context"],
        maxResults: 7,
        sort: ["created_at", "desc"],
      },
    ]);
    expect(cloudinary.config).toHaveBeenCalledWith({
      cloud_name: "cloud-name",
      api_key: "api-key",
      api_secret: "api-secret",
    });
  });

  test("retries 500 search failures", async () => {
    queuedResults = [
      { throw: { error: { http_code: 500, message: "first" } } },
      { throw: { error: { http_code: 500, message: "second" } } },
      { resources: [asset] },
    ];

    const service = await makeService();
    const result = await Effect.runPromise(
      service.searchByExpression("tags=desk")
    );

    expect(result).toEqual([asset]);
    expect(executeAttempts).toBe(3);
  });

  test("fails invalid options as CloudinarySearchError", async () => {
    const service = await makeService();
    const result = await Effect.runPromise(
      service.searchAll({ maxResults: 0 } as never).pipe(Effect.result)
    );

    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") {
      expect(result.failure._tag).toBe("CloudinarySearchError");
    }
    expect(searchCalls).toEqual([]);
  });

  test("fails empty live config as CloudinaryConfigError", async () => {
    const result = await Effect.runPromise(
      Effect.gen(function* () {
        yield* CloudinaryService;
      }).pipe(
        Effect.provide(CloudinaryService.Live),
        Effect.provide(
          makeCloudinaryRuntimeConfigLayer({ ...config, apiKey: "" })
        ),
        Effect.result
      )
    );

    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") {
      expect(result.failure._tag).toBe("CloudinaryConfigError");
    }
    expect(cloudinary.config).not.toHaveBeenCalled();
  });
});
