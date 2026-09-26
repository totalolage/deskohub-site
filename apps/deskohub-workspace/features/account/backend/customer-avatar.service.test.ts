import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { buildVersionedDeliveryUrl } from "@deskohub/cloudinary/delivery";
import {
  type CloudinaryPublicId,
  CloudinaryPublicIdSchema,
} from "@deskohub/cloudinary/schema";
import { Context, Effect, Fiber, Layer, Option } from "effect";
import sharp from "sharp";
import { customerAccountIdSchema } from "../customer-account";

const accountId = customerAccountIdSchema.make("acct-avatar-1");

type CloudinaryCall =
  | {
      readonly op: "upload";
      readonly publicId: string;
      readonly folder: string;
    }
  | {
      readonly op: "rename";
      readonly from: string;
      readonly to: string;
      readonly overwrite: boolean;
    }
  | { readonly op: "destroy"; readonly publicId: string }
  | { readonly op: "search"; readonly folder: string }
  | { readonly op: "get"; readonly publicId: string };

let calls: CloudinaryCall[] = [];
let renameFailuresRemaining = 0;
let renameFailureReason = "failed";
let commitButLoseRenameResponse = false;
let uploadStoreThenFail = false;
let destroyOutcome: "destroyed" | "not-found" | "uncertain" = "destroyed";
let uncertainDestroyTargets: readonly string[] = [];
let renameGateMillis = 0;
let renameStarted = false;
let storedAssets: Set<string> = new Set();
let lastUploadedBytes: Uint8Array | null = null;

const makeAsset = (publicId: string, version: number) => ({
  public_id: publicId,
  secure_url: `https://res.cloudinary.test/upload/${publicId}`,
  url: `http://res.cloudinary.test/${publicId}`,
  width: 512,
  height: 512,
  format: "webp",
  resource_type: "image",
  version,
  created_at: "2026-09-01T00:00:00Z",
});

const Cloudinary = Context.Service<
  Cloudinary,
  {
    readonly getByPublicId: (
      publicId: CloudinaryPublicId
    ) => Effect.Effect<unknown, { httpCode?: number }>;
    readonly searchByFolder: (
      folder: string,
      options?: { readonly maxResults?: number }
    ) => Effect.Effect<unknown[], { _tag: string }>;
    readonly uploadImage: (input: {
      readonly bytes: Uint8Array;
      readonly publicId: CloudinaryPublicId;
      readonly folder: string;
    }) => Effect.Effect<unknown, never>;
    readonly destroyAsset: (
      publicId: CloudinaryPublicId
    ) => Effect.Effect<unknown, { _tag: string }>;
    readonly renameAsset: (
      from: CloudinaryPublicId,
      to: CloudinaryPublicId,
      options?: { readonly overwrite?: boolean }
    ) => Effect.Effect<unknown, { _tag: string }>;
  }
>()("@test/AvatarCloudinary");

const CloudinaryLayer = Layer.succeed(Cloudinary, {
  getByPublicId: (publicId) =>
    Effect.suspend(() => {
      calls.push({ op: "get", publicId });
      if (!storedAssets.has(publicId)) {
        return Effect.fail({ _tag: "CloudinarySearchError", httpCode: 404 });
      }
      return Effect.succeed(makeAsset(publicId, 42));
    }),
  searchByFolder: (folder, options) =>
    Effect.suspend(() => {
      calls.push({ op: "search", folder });
      const matches = [...storedAssets].filter((id) =>
        id.startsWith(`${folder}/`)
      );
      return Effect.succeed(
        matches
          .slice(0, options?.maxResults ?? matches.length)
          .map((id) => makeAsset(id, 7))
      );
    }),
  uploadImage: (input) =>
    Effect.suspend(() => {
      const fullId = `${input.folder}/${input.publicId}`;
      calls.push({
        op: "upload",
        publicId: input.publicId,
        folder: input.folder,
      });
      storedAssets.add(fullId);
      lastUploadedBytes = input.bytes;
      if (uploadStoreThenFail) {
        return Effect.fail({ _tag: "CloudinaryUploadError" });
      }
      return Effect.succeed(makeAsset(fullId, 7));
    }),
  destroyAsset: (publicId) =>
    Effect.suspend(() => {
      calls.push({ op: "destroy", publicId });
      if (uncertainDestroyTargets.includes(publicId)) {
        return Effect.fail({ _tag: "CloudinaryDestroyError" });
      }
      if (destroyOutcome === "uncertain") {
        return Effect.fail({ _tag: "CloudinaryDestroyError" });
      }
      storedAssets.delete(publicId);
      return Effect.succeed(
        destroyOutcome === "destroyed" ? "destroyed" : "not-found"
      );
    }),
  renameAsset: (from, to, options) =>
    Effect.suspend(() => {
      calls.push({
        op: "rename",
        from,
        to,
        overwrite: options?.overwrite ?? false,
      });
      if (renameGateMillis > 0) {
        renameStarted = true;
        return Effect.sleep(`${renameGateMillis} millis`).pipe(
          Effect.andThen(() => renameOutcome(from, to))
        );
      }
      return renameOutcome(from, to);
    }),
});

const renameOutcome = (
  from: CloudinaryPublicId,
  to: CloudinaryPublicId
): Effect.Effect<unknown, { _tag: string }> => {
  if (commitButLoseRenameResponse) {
    // The provider committed the rename but lost the response: the
    // staged source is gone and the live asset exists.
    storedAssets.delete(from);
    storedAssets.add(to);
    return Effect.fail({
      _tag: "CloudinaryRenameError",
      reason: "source-missing",
    });
  }
  if (renameFailuresRemaining > 0) {
    renameFailuresRemaining -= 1;
    return Effect.fail({
      _tag: "CloudinaryRenameError",
      reason: renameFailureReason,
    });
  }
  storedAssets.delete(from);
  storedAssets.add(to);
  return Effect.succeed(makeAsset(to, 99));
};

Object.assign(Cloudinary, { Default: CloudinaryLayer });

const cloudinaryServerModule = "@deskohub/cloudinary" + "/server";
mock.module(cloudinaryServerModule, () => ({
  CloudinaryService: Cloudinary,
  makeCloudinaryRuntimeConfigLayer: () => Layer.mergeAll(CloudinaryLayer),
  buildVersionedDeliveryUrl,
  CloudinaryPublicIdSchema,
}));

let linkActivity: "active" | "deletion-requested" = "active";
let deletionRequestedAt: Date | null = null;

const Links = Context.Service<
  Links,
  {
    readonly findActivityState: (
      accountId: string
    ) => Effect.Effect<
      { kind: "active"; deletionRequestedAt: null } | { kind: "missing" },
      never
    >;
    readonly withAccountLock: <A, E, R>(
      accountId: string,
      effect: Effect.Effect<A, E, R>
    ) => Effect.Effect<A, E, R>;
  }
>()("@test/AvatarLinks");

const LinksLayer = Layer.succeed(Links, {
  findActivityState: () =>
    Effect.succeed(
      linkActivity === "active"
        ? { kind: "active", deletionRequestedAt: null }
        : {
            kind: "active",
            deletionRequestedAt: deletionRequestedAt ?? new Date(),
          }
    ),
  withAccountLock: (_accountId, effect) => effect,
});

mock.module("./customer-account-link.repository", () => ({
  CustomerAccountLinkRepository: Links,
}));

const { CustomerAvatarService, CustomerAvatarSettings } = await import(
  "./customer-avatar.service"
);

const makeLayer = (namespace: Option.Option<string>) =>
  CustomerAvatarService.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        CloudinaryLayer,
        LinksLayer,
        Layer.succeed(CustomerAvatarSettings, { namespace })
      )
    )
  );

const runWith = <A, E>(
  effect: Effect.Effect<A, E, never>,
  namespace: Option.Option<string> = Option.some("avatars/test")
) =>
  Effect.runPromise(
    Effect.provide(effect, makeLayer(namespace)) as Effect.Effect<A, E>
  );

const pngBytes = (width: number, height: number) =>
  sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 120, g: 40, b: 200 },
    },
  })
    .png()
    .toBuffer()
    .then((buffer) => new Uint8Array(buffer));

const uploadInput = (
  bytes: Uint8Array,
  overrides: { declaredSize?: number; declaredMediaType?: string } = {}
) => ({
  bytes,
  declaredSize: overrides.declaredSize ?? bytes.byteLength,
  declaredMediaType: overrides.declaredMediaType ?? "image/png",
});

const resetFakes = () => {
  calls = [];
  renameFailuresRemaining = 0;
  renameFailureReason = "failed";
  commitButLoseRenameResponse = false;
  uploadStoreThenFail = false;
  destroyOutcome = "destroyed";
  uncertainDestroyTargets = [];
  renameGateMillis = 0;
  renameStarted = false;
  storedAssets = new Set();
  lastUploadedBytes = null;
  linkActivity = "active";
  deletionRequestedAt = null;
};

/** Clears the call log and failure programming while keeping stored assets. */
const clearCalls = () => {
  calls = [];
  renameFailuresRemaining = 0;
  commitButLoseRenameResponse = false;
  uploadStoreThenFail = false;
};

/**
 * Fails the first upload's promotion with no live avatar, so the staged
 * asset is retained as the only recoverable copy. Returns its public ID.
 */
const retainStaging = async () => {
  renameFailuresRemaining = 3;
  const bytes = await pngBytes(100, 100);
  await runWith(
    Effect.flatMap(CustomerAvatarService, (avatars) =>
      avatars.upload(accountId, uploadInput(bytes)).pipe(Effect.result)
    )
  );
  const stagedId = [...storedAssets][0]!;
  expect(stagedId.startsWith("avatars/test-staging/acct-avatar-1/")).toBe(true);
  clearCalls();
  return stagedId;
};

describe("CustomerAvatarService", () => {
  test("stages the normalized upload and promotes it onto the fixed live public ID", async () => {
    resetFakes();
    const bytes = await pngBytes(300, 200);

    const outcome = await runWith(
      Effect.flatMap(CustomerAvatarService, (avatars) =>
        avatars.upload(accountId, uploadInput(bytes))
      )
    );

    expect(calls.map(({ op }) => op)).toEqual(["search", "upload", "rename"]);
    const search = calls[0]!;
    const upload = calls[1]!;
    const rename = calls[2]!;
    if (
      search.op === "search" &&
      upload.op === "upload" &&
      rename.op === "rename"
    ) {
      expect(search.folder).toBe("avatars/test-staging/acct-avatar-1");
      expect(upload.folder).toBe("avatars/test-staging/acct-avatar-1");
      expect(rename.to).toBe("avatars/test/acct-avatar-1");
      expect(rename.overwrite).toBe(true);
    }
    expect(storedAssets.size).toBe(1);
    expect(storedAssets.has("avatars/test/acct-avatar-1")).toBe(true);
    expect(outcome).toMatchObject({
      url: buildVersionedDeliveryUrl(
        makeAsset("avatars/test/acct-avatar-1", 99)
      ),
      version: 99,
    });
    expect((outcome as { url: string }).url).toContain("v99/");
  });

  test("normalizes the upload to bounded metadata-free WebP before staging", async () => {
    resetFakes();
    const bytes = await sharp({
      create: {
        width: 3000,
        height: 1500,
        channels: 3,
        background: { r: 10, g: 20, b: 30 },
      },
    })
      .png()
      .toBuffer();

    await runWith(
      Effect.flatMap(CustomerAvatarService, (avatars) =>
        avatars.upload(accountId, uploadInput(new Uint8Array(bytes)))
      )
    );

    expect(lastUploadedBytes).not.toBeNull();
    if (lastUploadedBytes) {
      const metadata = await sharp(lastUploadedBytes).metadata();
      expect(metadata.format).toBe("webp");
      expect(metadata.width).toBe(512);
      expect(metadata.height).toBe(256);
      expect(Object.hasOwn(metadata, "exif")).toBe(false);
    }
  });

  test("rejects oversized claimed and actual sizes without calling the provider", async () => {
    resetFakes();
    const bytes = await pngBytes(50, 50);

    const outcome = await runWith(
      Effect.flatMap(CustomerAvatarService, (avatars) =>
        avatars
          .upload(
            accountId,
            uploadInput(bytes, {
              declaredSize: 3 * 1024 * 1024,
              declaredMediaType: "image/png",
            })
          )
          .pipe(Effect.result)
      )
    );

    expect(outcome).toMatchObject({
      _tag: "Failure",
      failure: {
        _tag: "CustomerAvatarRejectedError",
        reason: "file-too-large",
      },
    });
    const actualOutcome = await runWith(
      Effect.flatMap(CustomerAvatarService, (avatars) =>
        avatars
          .upload(
            accountId,
            uploadInput(new Uint8Array(3 * 1024 * 1024).fill(1), {
              declaredSize: 10,
              declaredMediaType: "image/png",
            })
          )
          .pipe(Effect.result)
      )
    );
    expect(actualOutcome).toMatchObject({
      failure: { reason: "file-too-large" },
    });
    expect(calls).toHaveLength(0);
  });

  test("rejects wrong and spoofed media types before decoding", async () => {
    resetFakes();
    const bytes = await pngBytes(50, 50);

    const wrongType = await runWith(
      Effect.flatMap(CustomerAvatarService, (avatars) =>
        avatars
          .upload(
            accountId,
            uploadInput(bytes, { declaredMediaType: "image/gif" })
          )
          .pipe(Effect.result)
      )
    );
    expect(wrongType).toMatchObject({
      failure: { reason: "unsupported-format" },
    });

    const spoofed = await runWith(
      Effect.flatMap(CustomerAvatarService, (avatars) =>
        avatars
          .upload(
            accountId,
            uploadInput(new TextEncoder().encode("plain text, not an image"), {
              declaredMediaType: "image/png",
            })
          )
          .pipe(Effect.result)
      )
    );
    expect(spoofed).toMatchObject({ failure: { reason: "undecodable-image" } });
    expect(calls).toHaveLength(0);
  });

  test("rejects pixel-bomb dimensions before decoding into memory", async () => {
    resetFakes();
    const bomb = await sharp({
      create: {
        width: 10001,
        height: 1,
        channels: 3,
        background: { r: 0, g: 0, b: 0 },
      },
    })
      .png()
      .toBuffer();

    const outcome = await runWith(
      Effect.flatMap(CustomerAvatarService, (avatars) =>
        avatars
          .upload(
            accountId,
            uploadInput(new Uint8Array(bomb), {
              declaredMediaType: "image/png",
            })
          )
          .pipe(Effect.result)
      )
    );

    expect(outcome).toMatchObject({
      failure: { reason: "image-dimensions-too-large" },
    });
    expect(calls).toHaveLength(0);
  });

  test("reports a retryable failure and retains the staged asset when the promotion stays uncommitted without a previous avatar", async () => {
    resetFakes();
    // Two provider-level attempts plus the reconciliation attempt all fail.
    renameFailuresRemaining = 3;
    const bytes = await pngBytes(100, 100);

    const outcome = await runWith(
      Effect.flatMap(CustomerAvatarService, (avatars) =>
        avatars.upload(accountId, uploadInput(bytes)).pipe(Effect.result)
      )
    );

    expect(outcome).toMatchObject({
      failure: { _tag: "CustomerAvatarProviderError" },
    });
    const ops = calls.map(({ op }) => op);
    // The reconciliation lookup runs before anything is destroyed; with no
    // live asset the staging is the only recoverable copy and is retained.
    expect(ops).toEqual([
      "search",
      "upload",
      "rename",
      "rename",
      "rename",
      "get",
    ]);
    expect(storedAssets.size).toBe(1);
    expect([...storedAssets][0]!.startsWith("avatars/test-staging/")).toBe(
      true
    );
  });

  test("recovers a retained staging asset by promoting it to the live ID on the next upload", async () => {
    resetFakes();
    const retainedStagedId = await retainStaging();

    const bytes = await pngBytes(110, 110);
    const outcome = await runWith(
      Effect.flatMap(CustomerAvatarService, (avatars) =>
        avatars.upload(accountId, uploadInput(bytes))
      )
    );

    // The recovery promotion targets the retained staging copy first.
    const firstRename = calls.find((call) => call.op === "rename");
    expect(firstRename).toMatchObject({
      from: retainedStagedId,
      to: "avatars/test/acct-avatar-1",
      overwrite: true,
    });
    const firstRenameIndex = calls.findIndex((call) => call.op === "rename");
    const firstUploadIndex = calls.findIndex((call) => call.op === "upload");
    expect(firstRenameIndex).toBeLessThan(firstUploadIndex);
    // The fresh upload then takes over the live ID and the outcome succeeds.
    expect(outcome).toMatchObject({ version: 99 });
    expect(storedAssets.has("avatars/test/acct-avatar-1")).toBe(true);
    expect(storedAssets.size).toBe(1);
  });

  test("account deletion destroys the live avatar and then any retained staging assets", async () => {
    resetFakes();
    const retainedStagedId = await retainStaging();

    const outcome = await runWith(
      Effect.flatMap(CustomerAvatarService, (avatars) =>
        avatars.destroy(accountId).pipe(Effect.result)
      )
    );

    expect(outcome._tag).toBe("Success");
    expect(calls.map(({ op }) => op)).toEqual(["destroy", "search", "destroy"]);
    const destroys = calls.filter(
      (call): call is Extract<CloudinaryCall, { op: "destroy" }> =>
        call.op === "destroy"
    );
    expect(destroys[0]!.publicId).toBe("avatars/test/acct-avatar-1");
    expect(destroys[1]!.publicId).toBe(retainedStagedId);
    // Nothing recoverable survives deletion.
    expect(storedAssets.size).toBe(0);
  });

  test("keeps deletion successful when the staging folder holds more assets than the bounded sweep", async () => {
    resetFakes();
    storedAssets.add("avatars/test/acct-avatar-1");
    // Seed more retained staging assets than the maxResults: 8 sweep bound.
    const stagingIds = Array.from(
      { length: 10 },
      (_, index) => `avatars/test-staging/acct-avatar-1/overflow-${index}`
    );
    for (const id of stagingIds) {
      storedAssets.add(id);
    }

    const outcome = await runWith(
      Effect.flatMap(CustomerAvatarService, (avatars) =>
        avatars.destroy(accountId).pipe(Effect.result)
      )
    );

    // Deletion succeeds: the sweep is bounded by design and the live
    // destroy is the authoritative step, so overflow never fails it.
    expect(outcome._tag).toBe("Success");
    const destroys = calls.filter((call) => call.op === "destroy");
    // One for the live asset plus at most the bounded sweep window.
    expect(destroys).toHaveLength(9);
    expect(destroys[0]).toMatchObject({
      publicId: "avatars/test/acct-avatar-1",
    });
    const destroyedStagingIds = stagingIds.filter(
      (id) => !storedAssets.has(id)
    );
    expect(destroyedStagingIds.length).toBeLessThanOrEqual(8);
  });

  test("an uncertain staging destroy during deletion fails retryably", async () => {
    resetFakes();
    const retainedStagedId = await retainStaging();
    uncertainDestroyTargets = [retainedStagedId];

    const outcome = await runWith(
      Effect.flatMap(CustomerAvatarService, (avatars) =>
        avatars.destroy(accountId).pipe(Effect.result)
      )
    );

    expect(outcome).toMatchObject({
      failure: { _tag: "CustomerAvatarProviderError" },
    });
    // The live avatar went first; the deletion stays retryable.
    expect(storedAssets.has("avatars/test/acct-avatar-1")).toBe(false);
    expect(storedAssets.has(retainedStagedId)).toBe(true);
  });

  test("recovers a promotion that committed while its response was lost", async () => {
    resetFakes();
    commitButLoseRenameResponse = true;
    const bytes = await pngBytes(100, 100);

    const outcome = await runWith(
      Effect.flatMap(CustomerAvatarService, (avatars) =>
        avatars.upload(accountId, uploadInput(bytes))
      )
    );

    // Success is reported only against the confirmed live asset.
    expect(outcome).toMatchObject({
      url: expect.stringContaining("/upload/"),
      version: 42,
    });
    const ops = calls.map(({ op }) => op);
    expect(ops).toEqual([
      "search",
      "upload",
      "rename",
      "rename",
      "get",
      "destroy",
    ]);
    expect(storedAssets.has("avatars/test/acct-avatar-1")).toBe(true);
  });

  test("preserves the previous avatar and reports a retryable failure when an uncertain promotion never commits", async () => {
    resetFakes();
    renameFailuresRemaining = 3;
    storedAssets.add("avatars/test/acct-avatar-1");
    const bytes = await pngBytes(100, 100);

    const outcome = await runWith(
      Effect.flatMap(CustomerAvatarService, (avatars) =>
        avatars.upload(accountId, uploadInput(bytes)).pipe(Effect.result)
      )
    );

    expect(outcome).toMatchObject({
      failure: { _tag: "CustomerAvatarProviderError" },
    });
    const ops = calls.map(({ op }) => op);
    expect(ops).toEqual([
      "search",
      "upload",
      "rename",
      "rename",
      "rename",
      "get",
      "destroy",
    ]);
    // The previous avatar stays live.
    expect(storedAssets.has("avatars/test/acct-avatar-1")).toBe(true);
  });

  test("destroys the known staging ID when the provider stores the bytes but fails the upload", async () => {
    resetFakes();
    uploadStoreThenFail = true;
    const bytes = await pngBytes(100, 100);

    const outcome = await runWith(
      Effect.flatMap(CustomerAvatarService, (avatars) =>
        avatars.upload(accountId, uploadInput(bytes)).pipe(Effect.result)
      )
    );

    expect(outcome).toMatchObject({
      failure: { _tag: "CustomerAvatarProviderError" },
    });
    const destroy = calls.find((call) => call.op === "destroy");
    expect(destroy).toBeDefined();
    if (destroy?.op === "destroy") {
      expect(
        destroy.publicId.startsWith("avatars/test-staging/acct-avatar-1")
      ).toBe(true);
    }
    expect(storedAssets.size).toBe(0);
  });

  test("replaces the previous avatar through promotion with overwrite", async () => {
    resetFakes();
    storedAssets.add("avatars/test/acct-avatar-1");
    const bytes = await pngBytes(120, 90);

    const outcome = await runWith(
      Effect.flatMap(CustomerAvatarService, (avatars) =>
        avatars.upload(accountId, uploadInput(bytes))
      )
    );

    expect(outcome).toMatchObject({
      url: expect.stringContaining("/upload/"),
      version: 99,
    });
    expect(calls.filter((call) => call.op === "rename")).toHaveLength(1);
  });

  test("blocks the upload when the deletion marker is set, without calling the provider", async () => {
    resetFakes();
    linkActivity = "deletion-requested";
    const bytes = await pngBytes(50, 50);

    const outcome = await runWith(
      Effect.flatMap(CustomerAvatarService, (avatars) =>
        avatars.upload(accountId, uploadInput(bytes)).pipe(Effect.result)
      )
    );

    expect(outcome).toMatchObject({ failure: { reason: "link-required" } });
    expect(calls).toHaveLength(0);
  });

  test("fails closed with an unavailable error when the namespace cannot be determined", async () => {
    resetFakes();
    const bytes = await pngBytes(50, 50);

    const outcome = await runWith(
      Effect.flatMap(CustomerAvatarService, (avatars) =>
        avatars.upload(accountId, uploadInput(bytes)).pipe(Effect.result)
      ),
      Option.none()
    );

    expect(outcome).toMatchObject({
      failure: { _tag: "CustomerAvatarUnavailableError" },
    });
    expect(calls).toHaveLength(0);
  });

  test("removes the avatar idempotently and reports uncertain destroys as retryable", async () => {
    resetFakes();
    storedAssets.add("avatars/test/acct-avatar-1");

    const removed = await runWith(
      Effect.flatMap(CustomerAvatarService, (avatars) =>
        avatars.remove(accountId)
      )
    );
    expect(removed).toBeUndefined();
    expect(calls.map(({ op }) => op)).toEqual(["destroy", "search"]);

    clearCalls();
    const missing = await runWith(
      Effect.flatMap(CustomerAvatarService, (avatars) =>
        avatars.remove(accountId).pipe(Effect.result)
      )
    );
    expect(missing._tag).toBe("Success");

    resetFakes();
    destroyOutcome = "uncertain";
    const uncertain = await runWith(
      Effect.flatMap(CustomerAvatarService, (avatars) =>
        avatars.remove(accountId).pipe(Effect.result)
      )
    );
    expect(uncertain).toMatchObject({
      failure: { _tag: "CustomerAvatarProviderError" },
    });
  });

  test("looks up the avatar with one bounded provider call and returns absence for 404", async () => {
    resetFakes();
    storedAssets.add("avatars/test/acct-avatar-1");

    const found = await runWith(
      Effect.flatMap(CustomerAvatarService, (avatars) =>
        avatars.lookup(accountId).pipe(Effect.result)
      )
    );
    expect(found).toMatchObject({
      success: {
        url: expect.stringContaining("avatars/test/acct-avatar-1"),
        version: 42,
      },
    });
    expect(calls.filter((call) => call.op === "get")).toHaveLength(1);

    resetFakes();
    const absent = await runWith(
      Effect.flatMap(CustomerAvatarService, (avatars) =>
        avatars.lookup(accountId).pipe(Effect.result)
      )
    );
    expect(absent).toMatchObject({ success: null });
  });

  test("an interruption during a delayed rename cannot land after deletion", async () => {
    resetFakes();
    // The provider holds the rename response; the upload is in flight.
    renameGateMillis = 100;
    const bytes = await pngBytes(100, 100);

    const deletion = await runWith(
      Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(
          Effect.flatMap(CustomerAvatarService, (avatars) =>
            avatars.upload(accountId, uploadInput(bytes))
          )
        );

        // Wait until the rename request is actually in flight.
        const waitUntilStarted = (): Effect.Effect<void> =>
          renameStarted
            ? Effect.void
            : Effect.sleep("5 millis").pipe(Effect.andThen(waitUntilStarted));
        yield* waitUntilStarted();

        // The action runtime times out: the interrupt is deferred by the
        // uninterruptible critical section, so the rename settles first.
        yield* Fiber.interrupt(fiber);

        // Deletion runs afterwards inside its own critical section.
        const result = yield* Effect.flatMap(CustomerAvatarService, (avatars) =>
          avatars.destroy(accountId).pipe(Effect.result)
        );

        // Give any hypothetical late rename ample time to land.
        yield* Effect.sleep("300 millis");
        // No late provider mutation arrived while waiting.
        const settledCallCount = calls.length;
        yield* Effect.sleep("200 millis");
        expect(calls.length).toBe(settledCallCount);
        return result;
      })
    );

    // Deletion completed cleanly.
    expect(deletion._tag).toBe("Success");
    const renameIndexes = calls
      .map((call, index) => ({ call, index }))
      .filter(({ call }) => call.op === "rename");
    const firstDestroyIndex = calls.findIndex((call) => call.op === "destroy");
    // Every rename settled before deletion destroyed the avatar.
    for (const { index } of renameIndexes) {
      expect(index).toBeLessThan(firstDestroyIndex);
    }
    // Identity/avatar state is consistent: nothing survives deletion.
    expect(storedAssets.size).toBe(0);
  });
});
