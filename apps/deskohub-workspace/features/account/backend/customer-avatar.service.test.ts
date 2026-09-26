import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { buildVersionedDeliveryUrl } from "@deskohub/cloudinary/delivery";
import {
  type CloudinaryPublicId,
  CloudinaryPublicIdSchema,
} from "@deskohub/cloudinary/schema";
import { Context, Effect, Layer, Option } from "effect";
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
  | { readonly op: "get"; readonly publicId: string };

let calls: CloudinaryCall[] = [];
let renameFailuresRemaining = 0;
let renameFailureReason = "failed";
let commitButLoseRenameResponse = false;
let uploadStoreThenFail = false;
let destroyOutcome: "destroyed" | "not-found" | "uncertain" = "destroyed";
let storedAsset: string | null = null;
let lookupAsset: string | null = null;
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
      if (lookupAsset !== publicId) {
        return Effect.fail({ _tag: "CloudinarySearchError", httpCode: 404 });
      }
      return Effect.succeed(makeAsset(publicId, 42));
    }),
  uploadImage: (input) =>
    Effect.suspend(() => {
      const fullId = `${input.folder}/${input.publicId}`;
      calls.push({
        op: "upload",
        publicId: input.publicId,
        folder: input.folder,
      });
      storedAsset = fullId;
      lastUploadedBytes = input.bytes;
      if (uploadStoreThenFail) {
        return Effect.fail({ _tag: "CloudinaryUploadError" });
      }
      return Effect.succeed(makeAsset(fullId, 7));
    }),
  destroyAsset: (publicId) =>
    Effect.suspend(() => {
      calls.push({ op: "destroy", publicId });
      if (destroyOutcome === "uncertain") {
        return Effect.fail({ _tag: "CloudinaryDestroyError" });
      }
      if (storedAsset === publicId) storedAsset = null;
      if (lookupAsset === publicId) lookupAsset = null;
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
      if (commitButLoseRenameResponse) {
        // The provider committed the rename but lost the response: the
        // staged source is gone and the live asset exists.
        storedAsset = null;
        lookupAsset = to;
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
      storedAsset = null;
      lookupAsset = to;
      return Effect.succeed(makeAsset(to, 99));
    }),
});

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
  storedAsset = null;
  lookupAsset = null;
  lastUploadedBytes = null;
  linkActivity = "active";
  deletionRequestedAt = null;
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

    expect(calls.map(({ op }) => op)).toEqual(["upload", "rename"]);
    const upload = calls[0]!;
    const rename = calls[1]!;
    if (upload.op === "upload" && rename.op === "rename") {
      expect(upload.folder).toBe("avatars/test-staging/acct-avatar-1");
      expect(rename.to).toBe("avatars/test/acct-avatar-1");
      expect(rename.overwrite).toBe(true);
    }
    expect(storedAsset).toBeNull();
    expect(lookupAsset).toBe("avatars/test/acct-avatar-1");
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
    expect(ops).toEqual(["upload", "rename", "rename", "rename", "get"]);
    expect(lookupAsset).toBeNull();
    expect(ops).not.toContain("destroy");
    expect(storedAsset).not.toBeNull();
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
    expect(ops).toEqual(["upload", "rename", "rename", "get", "destroy"]);
    expect(lookupAsset).toBe("avatars/test/acct-avatar-1");
    expect(storedAsset).toBeNull();
  });

  test("preserves the previous avatar and reports a retryable failure when an uncertain promotion never commits", async () => {
    resetFakes();
    renameFailuresRemaining = 3;
    lookupAsset = "avatars/test/acct-avatar-1";
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
      "upload",
      "rename",
      "rename",
      "rename",
      "get",
      "destroy",
    ]);
    // The previous avatar stays live.
    expect(lookupAsset).toBe("avatars/test/acct-avatar-1");
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
    expect(storedAsset).toBeNull();
  });

  test("replaces the previous avatar through promotion with overwrite", async () => {
    resetFakes();
    lookupAsset = "avatars/test/acct-avatar-1";
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
    lookupAsset = "avatars/test/acct-avatar-1";

    const removed = await runWith(
      Effect.flatMap(CustomerAvatarService, (avatars) =>
        avatars.remove(accountId)
      )
    );
    expect(removed).toBeUndefined();
    expect(calls.map(({ op }) => op)).toEqual(["destroy"]);

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
    lookupAsset = "avatars/test/acct-avatar-1";

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
});
