import { beforeEach, describe, expect, mock, test } from "bun:test";
import { Effect, Layer } from "effect";
import * as Schema from "effect/Schema";

mock.module("server-only", () => ({}));

type SearchCall = {
  expression: string;
  fields: string[];
  maxResults?: number;
  nextCursor?: string;
  sort?: readonly [string, string];
};

type ResourceCall = {
  publicId: string;
  options: Record<string, unknown>;
};

const searchCalls: SearchCall[] = [];
const resourceCalls: ResourceCall[] = [];
const uploadCalls: {
  options: Record<string, unknown>;
  byteLength: number;
}[] = [];
const destroyCalls: string[] = [];
const renameCalls: {
  fromPublicId: string;
  toPublicId: string;
  options: Record<string, unknown>;
}[] = [];
let queuedResults: unknown[] = [];
let queuedResourceResults: unknown[] = [];
let queuedUploadResults: unknown[] = [];
let queuedDestroyResults: unknown[] = [];
let queuedRenameResults: unknown[] = [];
let executeAttempts = 0;
let resourceAttempts = 0;
let uploadAttempts = 0;
let destroyAttempts = 0;
let renameAttempts = 0;

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
  uploader: {
    upload_stream: mock(
      (
        options: Record<string, unknown>,
        callback: (error: unknown, result: unknown) => void
      ) => ({
        end: (bytes: Uint8Array) => {
          uploadCalls.push({ options, byteLength: bytes.byteLength });
          uploadAttempts += 1;
          const next = queuedUploadResults.shift();
          const thrown =
            next && typeof next === "object" && "throw" in next
              ? (next as { throw: unknown }).throw
              : undefined;
          const result =
            next != null && !(typeof next === "object" && "throw" in next)
              ? next
              : undefined;
          callback(thrown, result);
        },
      })
    ),
    destroy: mock(async (publicId: string) => {
      destroyCalls.push(publicId);
      destroyAttempts += 1;
      const next = queuedDestroyResults.shift();
      if (next && typeof next === "object" && "throw" in next) {
        throw next.throw;
      }
      return next;
    }),
    rename: mock(
      async (
        fromPublicId: string,
        toPublicId: string,
        options: Record<string, unknown>
      ) => {
        renameCalls.push({ fromPublicId, toPublicId, options });
        renameAttempts += 1;
        const next = queuedRenameResults.shift();
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
        next_cursor: mock((nextCursor: string) => {
          call.nextCursor = nextCursor;
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
const { CloudinaryAssetSchema, CloudinaryPublicIdSchema } = await import(
  "./schema"
);
const { CloudinaryService } = await import("./service");

const cloudinaryPublicId = Schema.decodeUnknownSync(CloudinaryPublicIdSchema);
const galleryImagePublicId = cloudinaryPublicId("gallery/image");

const config = {
  cloudName: "cloud-name",
  apiKey: "api-key",
  apiSecret: "api-secret",
  defaultPageSize: 7,
};

const createAsset = (publicId: string) =>
  Schema.decodeUnknownSync(CloudinaryAssetSchema)({
    public_id: publicId,
    secure_url: "https://res.cloudinary.com/demo/image/upload/image.jpg",
    url: "http://res.cloudinary.com/demo/image/upload/image.jpg",
    width: 1200,
    height: 800,
    format: "jpg",
    resource_type: "image",
    created_at: "2026-06-20T10:00:00Z",
    tags: ["workspace"],
    context: { custom: { alt: "Desk" } },
  });

const asset = createAsset("gallery/image");

beforeEach(() => {
  searchCalls.length = 0;
  resourceCalls.length = 0;
  uploadCalls.length = 0;
  destroyCalls.length = 0;
  renameCalls.length = 0;
  queuedResults = [];
  queuedResourceResults = [];
  queuedUploadResults = [];
  queuedDestroyResults = [];
  queuedRenameResults = [];
  executeAttempts = 0;
  resourceAttempts = 0;
  uploadAttempts = 0;
  destroyAttempts = 0;
  renameAttempts = 0;
  cloudinary.config.mockClear();
  cloudinary.api.resource.mockClear();
  cloudinary.search.expression.mockClear();
  cloudinary.uploader.upload_stream.mockClear();
  cloudinary.uploader.destroy.mockClear();
  cloudinary.uploader.rename.mockClear();
});

const makeService = () =>
  Effect.runPromise(
    CloudinaryService.pipe(
      Effect.provide(
        CloudinaryService.Default.pipe(
          Layer.provide(makeCloudinaryRuntimeConfigLayer(config))
        )
      )
    )
  );

describe("CloudinaryService", () => {
  test("gets an image by public ID", async () => {
    queuedResourceResults = [asset];

    const service = await makeService();
    const result = await Effect.runPromise(
      service.getByPublicId(galleryImagePublicId)
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
      service.getByPublicId(galleryImagePublicId)
    );

    expect(result).toEqual(asset);
    expect(resourceAttempts).toBe(2);
  });

  test("fails primitive public ID lookup rejections as CloudinarySearchError", async () => {
    queuedResourceResults = [{ throw: undefined }];

    const service = await makeService();
    const result = await Effect.runPromise(
      service.getByPublicId(galleryImagePublicId).pipe(Effect.result)
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
      service.getByPublicId(galleryImagePublicId).pipe(Effect.result)
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
      service.getByPublicId(galleryImagePublicId)
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

  test("follows every search cursor when no result limit is requested", async () => {
    const secondAsset = createAsset("gallery/second-image");
    queuedResults = [
      { next_cursor: "next-page", resources: [asset] },
      { resources: [secondAsset] },
    ];

    const service = await makeService();
    const result = await Effect.runPromise(service.searchAll());

    expect(result).toEqual([asset, secondAsset]);
    expect(searchCalls).toEqual([
      {
        expression: "resource_type:image",
        fields: ["tags", "context"],
        maxResults: 7,
        sort: ["created_at", "desc"],
      },
      {
        expression: "resource_type:image",
        fields: ["tags", "context"],
        maxResults: 7,
        nextCursor: "next-page",
        sort: ["created_at", "desc"],
      },
    ]);
  });

  test("treats maxResults as a total cap across search pages", async () => {
    const firstPage = Array.from({ length: 7 }, (_, index) =>
      createAsset(`gallery/page-one-${index + 1}`)
    );
    const secondPage = Array.from({ length: 3 }, (_, index) =>
      createAsset(`gallery/page-two-${index + 1}`)
    );
    queuedResults = [
      { next_cursor: "next-page", resources: firstPage },
      { resources: secondPage },
    ];

    const service = await makeService();
    const result = await Effect.runPromise(
      service.searchAll({ maxResults: 8 })
    );

    expect(result).toEqual([...firstPage, secondPage[0]!]);
    expect(
      searchCalls.map(({ maxResults, nextCursor }) => ({
        maxResults,
        nextCursor,
      }))
    ).toEqual([
      { maxResults: 7, nextCursor: undefined },
      { maxResults: 1, nextCursor: "next-page" },
    ]);
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
      CloudinaryService.pipe(
        Effect.provide(
          CloudinaryService.Default.pipe(
            Layer.provide(
              makeCloudinaryRuntimeConfigLayer({ ...config, apiKey: "" })
            )
          )
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

describe("CloudinaryService uploads", () => {
  const uploadedAsset = Schema.decodeUnknownSync(CloudinaryAssetSchema)({
    public_id: "avatars/staged/abc123",
    secure_url:
      "https://res.cloudinary.com/demo/image/upload/avatars/staged/abc123.webp",
    url: "http://res.cloudinary.com/demo/image/upload/avatars/staged/abc123.webp",
    width: 512,
    height: 512,
    format: "webp",
    resource_type: "image",
    version: 1710000000,
    created_at: "2026-09-20T10:00:00Z",
  });

  test("uploads image bytes with fixed public ID, folder, and resource type", async () => {
    queuedUploadResults = [uploadedAsset];

    const service = await makeService();
    const result = await Effect.runPromise(
      service.uploadImage({
        bytes: new Uint8Array([1, 2, 3]),
        publicId: cloudinaryPublicId("avatars/staged/abc123"),
        folder: "avatars/staged",
      })
    );

    expect(result).toEqual(uploadedAsset);
    expect(uploadCalls).toEqual([
      {
        options: {
          public_id: "avatars/staged/abc123",
          folder: "avatars/staged",
          resource_type: "image",
        },
        byteLength: 3,
      },
    ]);
  });

  test("does not retry upload failures with a 4xx code", async () => {
    queuedUploadResults = [{ throw: { http_code: 400, message: "invalid" } }];

    const service = await makeService();
    const result = await Effect.runPromise(
      service
        .uploadImage({
          bytes: new Uint8Array([1]),
          publicId: cloudinaryPublicId("avatars/staged/abc123"),
          folder: "avatars/staged",
        })
        .pipe(Effect.result)
    );

    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") {
      expect(result.failure._tag).toBe("CloudinaryUploadError");
      expect(result.failure.httpCode).toBe(400);
    }
    expect(uploadAttempts).toBe(1);
  });

  test("retries transient 5xx upload failures and then succeeds", async () => {
    queuedUploadResults = [
      { throw: { http_code: 500, message: "first" } },
      { throw: { http_code: 503, message: "second" } },
      uploadedAsset,
    ];

    const service = await makeService();
    const result = await Effect.runPromise(
      service.uploadImage({
        bytes: new Uint8Array([1]),
        publicId: cloudinaryPublicId("avatars/staged/abc123"),
        folder: "avatars/staged",
      })
    );

    expect(result).toEqual(uploadedAsset);
    expect(uploadAttempts).toBe(3);
  });
});

describe("CloudinaryService destroys", () => {
  const destroy = (service: Awaited<ReturnType<typeof makeService>>) =>
    Effect.runPromise(
      service.destroyAsset(galleryImagePublicId).pipe(Effect.result)
    );

  test("classifies an ok destroy result as destroyed", async () => {
    queuedDestroyResults = [{ result: "ok" }];

    const service = await makeService();
    const result = await destroy(service);

    expect(result._tag).toBe("Success");
    if (result._tag === "Success") {
      expect(result.success).toBe("destroyed");
    }
    expect(destroyCalls).toEqual(["gallery/image"]);
  });

  test("classifies a missing asset as not-found", async () => {
    queuedDestroyResults = [{ result: "not found" }];

    const service = await makeService();
    const result = await destroy(service);

    expect(result._tag).toBe("Success");
    if (result._tag === "Success") {
      expect(result.success).toBe("not-found");
    }
  });

  test("treats an unrecognized destroy outcome as uncertain without retrying", async () => {
    queuedDestroyResults = [{ result: "something-unexpected" }];

    const service = await makeService();
    const result = await destroy(service);

    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") {
      expect(result.failure._tag).toBe("CloudinaryDestroyError");
      expect(result.failure.outcome).toBe("uncertain");
    }
    expect(destroyAttempts).toBe(1);
  });

  test("exhausts retries on transient destroy failures and reports uncertainty", async () => {
    queuedDestroyResults = [
      { throw: { http_code: 500, message: "first" } },
      { throw: { http_code: 500, message: "second" } },
      { throw: { http_code: 500, message: "third" } },
    ];

    const service = await makeService();
    const result = await destroy(service);

    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") {
      expect(result.failure.outcome).toBe("uncertain");
      expect(result.failure.httpCode).toBe(500);
    }
    expect(destroyAttempts).toBe(3);
  });

  test("does not retry a definitive destroy failure", async () => {
    queuedDestroyResults = [
      { throw: { http_code: 401, message: "unauthorized" } },
    ];

    const service = await makeService();
    const result = await destroy(service);

    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") {
      expect(result.failure.outcome).toBe("failed");
      expect(result.failure.httpCode).toBe(401);
    }
    expect(destroyAttempts).toBe(1);
  });
});

describe("CloudinaryService renames", () => {
  test("renames an asset without overwrite by default", async () => {
    queuedRenameResults = [asset];

    const service = await makeService();
    const result = await Effect.runPromise(
      service.renameAsset(
        cloudinaryPublicId("avatars/staged/abc123"),
        galleryImagePublicId
      )
    );

    expect(result).toEqual(asset);
    expect(renameCalls).toEqual([
      {
        fromPublicId: "avatars/staged/abc123",
        toPublicId: "gallery/image",
        options: { overwrite: false },
      },
    ]);
  });

  test("classifies an existing rename target without retrying", async () => {
    queuedRenameResults = [
      {
        throw: {
          http_code: 400,
          message: "There is already a file with that public id",
        },
      },
    ];

    const service = await makeService();
    const result = await Effect.runPromise(
      service
        .renameAsset(
          cloudinaryPublicId("avatars/staged/abc123"),
          galleryImagePublicId
        )
        .pipe(Effect.result)
    );

    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") {
      expect(result.failure._tag).toBe("CloudinaryRenameError");
      expect(result.failure.reason).toBe("target-exists");
    }
    expect(renameAttempts).toBe(1);
  });

  test("retries transient rename failures and then succeeds", async () => {
    queuedRenameResults = [
      { throw: { http_code: 500, message: "first" } },
      asset,
    ];

    const service = await makeService();
    const result = await Effect.runPromise(
      service.renameAsset(
        cloudinaryPublicId("avatars/staged/abc123"),
        galleryImagePublicId
      )
    );

    expect(result).toEqual(asset);
    expect(renameAttempts).toBe(2);
  });
});
