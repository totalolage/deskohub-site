import { beforeEach, describe, expect, mock, test } from "bun:test";
import { Effect, Layer, Logger, References } from "effect";
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
const prefixDeleteCalls: {
  prefix: string;
  options: Record<string, unknown>;
}[] = [];
const uploadCalls: {
  options: Record<string, unknown>;
  byteLength: number;
}[] = [];
const destroyCalls: string[] = [];
const destroyOptions: Record<string, unknown>[] = [];
const renameCalls: {
  fromPublicId: string;
  toPublicId: string;
  options: Record<string, unknown>;
}[] = [];
let queuedResults: unknown[] = [];
let queuedResourceResults: unknown[] = [];
let queuedPrefixDeleteResults: unknown[] = [];
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
    delete_resources_by_prefix: mock(
      async (prefix: string, options: Record<string, unknown>) => {
        prefixDeleteCalls.push({ prefix, options });
        const next = queuedPrefixDeleteResults.shift();
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
    destroy: mock(
      async (publicId: string, options: Record<string, unknown>) => {
        destroyCalls.push(publicId);
        destroyOptions.push(options);
        destroyAttempts += 1;
        const next = queuedDestroyResults.shift();
        if (next && typeof next === "object" && "throw" in next) {
          throw next.throw;
        }
        return next;
      }
    ),
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
const { CloudinaryService, getGalleryImages } = await import("./service");

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
  prefixDeleteCalls.length = 0;
  uploadCalls.length = 0;
  destroyCalls.length = 0;
  destroyOptions.length = 0;
  renameCalls.length = 0;
  queuedResults = [];
  queuedResourceResults = [];
  queuedPrefixDeleteResults = [];
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
      expect(result.failure.message).toBe("Cloudinary public ID lookup failed");
      expect(result.failure.httpCode).toBeUndefined();
    }
    expect(resourceAttempts).toBe(1);
  });

  test("ignores malformed public ID lookup error fields without echoing provider text", async () => {
    queuedResourceResults = [{ throw: { message: 123, http_code: "500" } }];

    const service = await makeService();
    const result = await Effect.runPromise(
      service.getByPublicId(galleryImagePublicId).pipe(Effect.result)
    );

    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") {
      expect(result.failure._tag).toBe("CloudinarySearchError");
      expect(result.failure.message).toBe("Cloudinary public ID lookup failed");
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
    expect(destroyOptions).toEqual([{ invalidate: true }]);
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

  test("deletes resources by an exact image upload prefix", async () => {
    queuedPrefixDeleteResults = [
      { deleted: { "avatars/staging/account/one": "deleted" }, partial: false },
    ];

    const service = await makeService();
    await Effect.runPromise(
      service.deleteResourcesByPublicIdPrefix(
        cloudinaryPublicId("avatars/staging/account/")
      )
    );

    expect(prefixDeleteCalls).toEqual([
      {
        prefix: "avatars/staging/account/",
        options: { resource_type: "image", type: "upload" },
      },
    ]);
  });

  test("follows delete-by-prefix cursors and keeps the same account prefix", async () => {
    queuedPrefixDeleteResults = [
      {
        deleted: { "avatars/staging/account/one": "deleted" },
        partial: true,
        next_cursor: "cursor-2",
      },
      {
        deleted: { "avatars/staging/account/two": "deleted" },
        partial: false,
      },
    ];

    const service = await makeService();
    await Effect.runPromise(
      service.deleteResourcesByPublicIdPrefix(
        cloudinaryPublicId("avatars/staging/account/")
      )
    );

    expect(prefixDeleteCalls).toEqual([
      {
        prefix: "avatars/staging/account/",
        options: { resource_type: "image", type: "upload" },
      },
      {
        prefix: "avatars/staging/account/",
        options: {
          resource_type: "image",
          type: "upload",
          next_cursor: "cursor-2",
        },
      },
    ]);
  });

  test("fails on incomplete prefix-delete responses or a cursor that repeats", async () => {
    const service = await makeService();

    queuedPrefixDeleteResults = [
      { deleted: {}, partial: false, next_cursor: "unexpected" },
    ];
    const invalidCursor = await Effect.runPromise(
      service
        .deleteResourcesByPublicIdPrefix(
          cloudinaryPublicId("avatars/staging/account/")
        )
        .pipe(Effect.result)
    );
    expect(invalidCursor._tag).toBe("Failure");
    if (invalidCursor._tag === "Failure") {
      expect(invalidCursor.failure._tag).toBe("CloudinaryPrefixDeleteError");
      expect(invalidCursor.failure.outcome).toBe("uncertain");
    }

    queuedPrefixDeleteResults = [
      { deleted: {}, partial: true, next_cursor: "cursor-1" },
      { deleted: {}, partial: true, next_cursor: "cursor-1" },
    ];
    prefixDeleteCalls.length = 0;
    const repeatedCursor = await Effect.runPromise(
      service
        .deleteResourcesByPublicIdPrefix(
          cloudinaryPublicId("avatars/staging/account/")
        )
        .pipe(Effect.result)
    );
    expect(repeatedCursor._tag).toBe("Failure");
    expect(prefixDeleteCalls).toHaveLength(2);
  });

  test("bounds large prefix deletions and leaves a partial sweep uncertain", async () => {
    queuedPrefixDeleteResults = Array.from({ length: 25 }, (_, index) => ({
      deleted: {},
      partial: true,
      next_cursor: `cursor-${index + 1}`,
    }));

    const service = await makeService();
    const result = await Effect.runPromise(
      service
        .deleteResourcesByPublicIdPrefix(
          cloudinaryPublicId("avatars/staging/account/")
        )
        .pipe(Effect.result)
    );

    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") {
      expect(result.failure._tag).toBe("CloudinaryPrefixDeleteError");
      expect(result.failure.outcome).toBe("uncertain");
    }
    expect(prefixDeleteCalls).toHaveLength(25);
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

describe("CloudinaryService avatar-path logging", () => {
  const stagedPublicId = cloudinaryPublicId("avatars/test-staging/acct-abc-1");
  const livePublicId = cloudinaryPublicId("avatars/live/acct-abc-1");
  const stagedAsset = Schema.decodeUnknownSync(CloudinaryAssetSchema)({
    public_id: "avatars/test-staging/acct-abc-1",
    secure_url:
      "https://res.cloudinary.com/demo/image/upload/avatars/test-staging/acct-abc-1.webp",
    url: "http://res.cloudinary.com/demo/image/upload/avatars/test-staging/acct-abc-1.webp",
    width: 512,
    height: 512,
    format: "webp",
    resource_type: "image",
    version: 1710000000,
    created_at: "2026-09-20T10:00:00Z",
  });
  const liveAsset = createAsset("avatars/live/acct-abc-1");

  const captureLogs = async (
    run: (
      service: Awaited<ReturnType<typeof makeService>>
    ) => Effect.Effect<unknown, unknown, never>
  ) => {
    const captured: {
      message: unknown;
      annotations: Record<string, unknown>;
    }[] = [];
    const captureLogger = Logger.make((options) => {
      captured.push({
        message: options.message,
        annotations: {
          ...options.fiber.getRef(References.CurrentLogAnnotations),
        },
      });
    });
    const withCapture = <A, E>(effect: Effect.Effect<A, E, never>) =>
      Effect.provideService(
        Effect.provide(effect, Logger.layer([captureLogger])),
        References.MinimumLogLevel,
        "All"
      );

    const service = await Effect.runPromise(
      withCapture(
        Effect.provide(
          CloudinaryService,
          CloudinaryService.Default.pipe(
            Layer.provide(makeCloudinaryRuntimeConfigLayer(config))
          )
        )
      )
    );

    await Effect.runPromise(withCapture(run(service)));

    return captured;
  };

  test("never logs asset identifiers, account-bearing folders, or raw responses on the avatar path", async () => {
    queuedResourceResults = [liveAsset];
    queuedUploadResults = [stagedAsset];
    queuedRenameResults = [liveAsset];
    queuedDestroyResults = [{ result: "ok" }];

    const captured = await captureLogs((service) =>
      Effect.gen(function* () {
        yield* service.getByPublicId(livePublicId);
        yield* service.uploadImage({
          bytes: new Uint8Array([1, 2, 3]),
          publicId: stagedPublicId,
          folder: "avatars/test-staging/acct-abc-1",
        });
        yield* service.renameAsset(stagedPublicId, livePublicId, {
          overwrite: true,
        });
        yield* service.destroyAsset(stagedPublicId);
      })
    );

    const serialized = JSON.stringify(captured);
    // Asset identifiers and their delivery URLs never appear…
    expect(serialized).not.toContain("acct-abc-1");
    expect(serialized).not.toContain("avatars/test-staging");
    expect(serialized).not.toContain("avatars/live");
    expect(serialized).not.toContain("res.cloudinary.com");
    // …nor raw provider responses.
    expect(serialized).not.toContain("public_id");
    expect(serialized).not.toContain("secure_url");
    // But the fixed operation codes do.
    expect(serialized).toContain("Cloudinary public ID lookup started");
    expect(serialized).toContain("Cloudinary image upload started");
    expect(serialized).toContain("Cloudinary asset rename started");
    expect(serialized).toContain("Cloudinary asset destroy started");
    expect(serialized).toContain("Cloudinary asset destroy completed");
  });

  test("never logs provider failure text containing asset identifiers on the avatar path", async () => {
    // Each executor classifies the provider rejection internally; the
    // synthetic provider text carries asset-id markers that must never leak
    // into any log line, on success or failure paths.
    const identifyingMessage =
      "Cloudinary: resource acct-abc-1 under avatars/test-staging/acct-abc-1 not found";
    queuedResourceResults = [
      { throw: { http_code: 404, message: identifyingMessage } },
    ];
    queuedUploadResults = [
      { throw: { http_code: 400, message: identifyingMessage } },
    ];
    queuedRenameResults = [
      { throw: { http_code: 400, message: identifyingMessage } },
    ];
    queuedDestroyResults = [
      { throw: { http_code: 401, message: identifyingMessage } },
    ];
    const prefixFailureMessage =
      "Cloudinary delete failed for avatars/staging/account/acct-abc-1/ with cursor sentinel";
    queuedPrefixDeleteResults = [
      { throw: { http_code: 401, message: prefixFailureMessage } },
    ];

    const captured = await captureLogs((service) =>
      Effect.gen(function* () {
        yield* service.getByPublicId(livePublicId).pipe(Effect.ignore);
        yield* service
          .uploadImage({
            bytes: new Uint8Array([1]),
            publicId: stagedPublicId,
            folder: "avatars/test-staging/acct-abc-1",
          })
          .pipe(Effect.ignore);
        yield* service
          .renameAsset(stagedPublicId, livePublicId, { overwrite: true })
          .pipe(Effect.ignore);
        yield* service.destroyAsset(stagedPublicId).pipe(Effect.ignore);
        yield* service
          .deleteResourcesByPublicIdPrefix(
            cloudinaryPublicId("avatars/staging/account/acct-abc-1/")
          )
          .pipe(Effect.ignore);
      })
    );

    const serialized = JSON.stringify(captured);
    expect(serialized).not.toContain("acct-abc-1");
    expect(serialized).not.toContain("avatars/test-staging");
    expect(serialized).not.toContain(identifyingMessage);
    expect(serialized).not.toContain(prefixFailureMessage);
    expect(serialized).not.toContain("public_id");
    expect(serialized).not.toContain("avatars/staging/account");
    // The fixed failure codes are still emitted for diagnostics.
    expect(serialized).toContain("Cloudinary public ID lookup failed");
    expect(serialized).toContain("Cloudinary image upload failed");
    expect(serialized).toContain("Cloudinary asset rename failed");
    expect(serialized).toContain("Cloudinary asset destroy failed");
    expect(serialized).toContain("Cloudinary asset prefix delete failed");
  });

  test("lists folder assets on the sanitized path without logging identifiers on success", async () => {
    queuedResults = [{ resources: [stagedAsset] }];

    const captured = await captureLogs((service) =>
      service.listFolderAssets("avatars/test-staging/acct-abc-1", {
        maxResults: 8,
      })
    );

    expect(searchCalls[0]!.expression).toBe(
      "folder=avatars/test-staging/acct-abc-1 AND resource_type:image"
    );
    const serialized = JSON.stringify(captured);
    // The account-bearing folder, the asset identity, its delivery URL,
    // the raw provider response, and the expression never appear…
    expect(serialized).not.toContain("acct-abc-1");
    expect(serialized).not.toContain("avatars/test-staging");
    expect(serialized).not.toContain("res.cloudinary.com");
    expect(serialized).not.toContain("public_id");
    expect(serialized).not.toContain("secure_url");
    expect(serialized).not.toContain("folder=");
    // …only the fixed operation codes and the safe result count.
    expect(serialized).toContain("Cloudinary folder listing started");
    expect(serialized).toContain("Cloudinary folder listing completed");
  });

  test("lists folder assets on the sanitized path without logging provider failure text", async () => {
    const identifyingMessage =
      "Cloudinary: search on folder avatars/test-staging/acct-abc-1 denied for acct-abc-1";
    queuedResults = [
      { throw: { http_code: 401, message: identifyingMessage } },
    ];

    const captured = await captureLogs((service) =>
      service
        .listFolderAssets("avatars/test-staging/acct-abc-1", { maxResults: 8 })
        .pipe(Effect.ignore)
    );

    const serialized = JSON.stringify(captured);
    expect(serialized).not.toContain("acct-abc-1");
    expect(serialized).not.toContain("avatars/test-staging");
    expect(serialized).not.toContain(identifyingMessage);
    expect(serialized).not.toContain("folder=");
    // The fixed failure code is still emitted for diagnostics.
    expect(serialized).toContain("Cloudinary folder listing failed");
  });

  test("search failure logs exclude provider text, identifiers, and query values", async () => {
    const identifier = "cloudinary-account-id-sentinel";
    const providerMessage =
      `provider failure for ${identifier} at https://cloudinary.test/${identifier} ` +
      "with api_secret=synthetic-cloudinary-secret-sentinel";
    queuedResults = [
      { throw: { http_code: 401, message: providerMessage } },
      { throw: { error: { http_code: 401, message: providerMessage } } },
      { throw: { http_code: 401, message: providerMessage } },
    ];

    const captured = await captureLogs((service) =>
      Effect.gen(function* () {
        const folderFailure = yield* service
          .searchByFolder(`${identifier}/folder`)
          .pipe(Effect.result);
        expect(folderFailure._tag).toBe("Failure");
        if (folderFailure._tag === "Failure") {
          expect(folderFailure.failure._tag).toBe("CloudinarySearchError");
          expect(folderFailure.failure.message).toBe(providerMessage);
        }

        yield* getGalleryImages([[identifier]], { maxResults: 2 }).pipe(
          Effect.provideService(CloudinaryService, service),
          Effect.ignore
        );
        yield* service
          .searchByExpression(`public_id=${identifier}`)
          .pipe(Effect.ignore);
      })
    );

    const serialized = JSON.stringify(captured);
    expect(serialized).not.toContain(providerMessage);
    expect(serialized).not.toContain(identifier);
    expect(serialized).not.toContain("https://cloudinary.test");
    expect(serialized).not.toContain("synthetic-cloudinary-secret-sentinel");
    expect(serialized).not.toContain("api_secret");
    expect(serialized).not.toContain("401");
    expect(serialized).not.toContain("public_id=");
    expect(serialized).not.toContain("folder=");
    expect(serialized).toContain("Cloudinary search page failed");
    expect(serialized).toContain("Cloudinary search failed");
    expect(serialized).toContain("Cloudinary gallery images lookup failed");
  });
});
