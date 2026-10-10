import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { buildVersionedDeliveryUrl } from "@deskohub/cloudinary/delivery";
import {
  type CloudinaryPublicId,
  CloudinaryPublicIdSchema,
} from "@deskohub/cloudinary/schema";
import {
  Context,
  Deferred,
  Effect,
  Fiber,
  Layer,
  Option,
  Schema,
} from "effect";
import sharp from "sharp";
import { reservationCustomerEmailSchema } from "@/features/reservation/reservation-contact";
import { customerAccountIdSchema } from "../customer-account";
import {
  type CustomerAccountSession,
  CustomerAuthentication,
} from "./customer-authentication.service";

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
  | { readonly op: "delete-prefix"; readonly prefix: string }
  | { readonly op: "search"; readonly folder: string }
  | { readonly op: "get"; readonly publicId: string };

let calls: CloudinaryCall[] = [];
let renameFailuresRemaining = 0;
let renameFailureReason = "failed";
let renameFailureHttpCode: number | undefined;
let commitButLoseRenameResponse = false;
let renameReportsSourceMissingWithoutCommit = false;
let uploadStoreThenFail = false;
let hideStagingFromSearch = false;
let prefixDeleteFails = false;
let destroyOutcome: "destroyed" | "not-found" | "uncertain" = "destroyed";
let uncertainDestroyTargets: readonly string[] = [];
let renameGateMillis = 0;
let renameStarted = false;
let renameSettledDeferred: Deferred.Deferred<never, void> | null = null;
let accountLockGate: {
  readonly entered: Deferred.Deferred<never, void>;
  readonly release: Deferred.Deferred<never, void>;
} | null = null;
let storedAssets: Set<string> = new Set();
/** Immutable provider asset identities keyed by public ID. */
let assetIdByPublicId: Map<string, string> = new Map();
let lastUploadedBytes: Uint8Array | null = null;
let lastUploadedAssetId: string | null = null;
let currentSession: CustomerAccountSession | null = null;

const makeSession = (account: string): CustomerAccountSession => ({
  accountId: customerAccountIdSchema.make(account),
  email: Schema.decodeSync(reservationCustomerEmailSchema)(
    "avatar@example.test"
  ),
  deletionRequested: false,
});

const makeAsset = (publicId: string, version: number, assetId?: string) => ({
  public_id: publicId,
  asset_id: assetId ?? `asset-${publicId}`,
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
    readonly listFolderAssets: (
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
    readonly deleteResourcesByPublicIdPrefix: (
      prefix: CloudinaryPublicId
    ) => Effect.Effect<void, { _tag: string }>;
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
      return Effect.succeed(
        makeAsset(publicId, 42, assetIdByPublicId.get(publicId))
      );
    }),
  listFolderAssets: (folder, options) =>
    Effect.suspend(() => {
      calls.push({ op: "search", folder });
      let matches = [...storedAssets].filter((id) =>
        id.startsWith(`${folder}/`)
      );
      if (hideStagingFromSearch) {
        matches = [];
      }
      return Effect.succeed(
        matches
          .slice(0, options?.maxResults ?? matches.length)
          .map((id) => makeAsset(id, 7, assetIdByPublicId.get(id)))
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
      // A fresh immutable provider identity per upload, like the real one.
      lastUploadedAssetId = `asset-upload-${crypto.randomUUID()}`;
      assetIdByPublicId.set(fullId, lastUploadedAssetId);
      lastUploadedBytes = input.bytes;
      if (uploadStoreThenFail) {
        return Effect.fail({ _tag: "CloudinaryUploadError" });
      }
      return Effect.succeed(
        makeAsset(fullId, 7, assetIdByPublicId.get(fullId))
      );
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
      assetIdByPublicId.delete(publicId);
      return Effect.succeed(
        destroyOutcome === "destroyed" ? "destroyed" : "not-found"
      );
    }),
  deleteResourcesByPublicIdPrefix: (prefix) =>
    Effect.suspend(() => {
      calls.push({ op: "delete-prefix", prefix });
      if (prefixDeleteFails) {
        return Effect.fail({ _tag: "CloudinaryPrefixDeleteError" });
      }
      for (const publicId of storedAssets) {
        if (publicId.startsWith(prefix)) {
          storedAssets.delete(publicId);
          assetIdByPublicId.delete(publicId);
        }
      }
      return Effect.void;
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
          Effect.andThen(() => renameOutcome(from, to)),
          Effect.tap(() =>
            renameSettledDeferred
              ? Deferred.succeed(renameSettledDeferred, undefined)
              : Effect.void
          )
        );
      }
      return renameOutcome(from, to);
    }),
});

const renameOutcome = (
  from: CloudinaryPublicId,
  to: CloudinaryPublicId
): Effect.Effect<unknown, { _tag: string }> => {
  if (renameReportsSourceMissingWithoutCommit) {
    // The provider reports the staged source as gone without the rename
    // having committed: the live asset is still the previous avatar.
    storedAssets.delete(from);
    assetIdByPublicId.delete(from);
    return Effect.fail({
      _tag: "CloudinaryRenameError",
      reason: "source-missing",
    });
  }
  if (commitButLoseRenameResponse) {
    commitButLoseRenameResponse = false;
    // The provider committed the rename but lost the response: the
    // staged source is gone and the live asset exists with the promoted
    // upload's immutable identity.
    storedAssets.delete(from);
    storedAssets.add(to);
    const assetId = assetIdByPublicId.get(from);
    assetIdByPublicId.delete(from);
    if (assetId !== undefined) assetIdByPublicId.set(to, assetId);
    if (renameFailureHttpCode !== undefined) {
      return Effect.fail({
        _tag: "CloudinaryRenameError",
        reason: renameFailureReason,
        httpCode: renameFailureHttpCode,
      });
    }
    return Effect.fail({
      _tag: "CloudinaryRenameError",
      reason: "source-missing",
    });
  }
  if (!storedAssets.has(from)) {
    return Effect.fail({
      _tag: "CloudinaryRenameError",
      reason: "source-missing",
      httpCode: 404,
    });
  }
  if (renameFailuresRemaining > 0) {
    renameFailuresRemaining -= 1;
    return Effect.fail({
      _tag: "CloudinaryRenameError",
      reason: renameFailureReason,
      httpCode: renameFailureHttpCode,
    });
  }
  storedAssets.delete(from);
  storedAssets.add(to);
  const assetId = assetIdByPublicId.get(from);
  assetIdByPublicId.delete(from);
  if (assetId !== undefined) assetIdByPublicId.set(to, assetId);
  return Effect.succeed(makeAsset(to, 99, assetId));
};

Object.assign(Cloudinary, { Live: CloudinaryLayer });

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
  withAccountLock: (_accountId, effect) =>
    Effect.suspend(() => {
      const gate = accountLockGate;
      return gate === null
        ? effect
        : Deferred.succeed(gate.entered, undefined).pipe(
            Effect.andThen(Deferred.await(gate.release)),
            Effect.andThen(effect)
          );
    }),
});

mock.module("./customer-account-link.repository", () => ({
  CustomerAccountLinkRepository: Links,
}));

const {
  CustomerAvatarService,
  CustomerAvatarSettings,
  deriveCustomerAvatarNamespace,
} = await import("./customer-avatar.service");

const makeLayer = (namespace: Option.Option<string>) =>
  CustomerAvatarService.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        CloudinaryLayer,
        LinksLayer,
        Layer.succeed(CustomerAuthentication, {
          currentUser: Effect.suspend(() =>
            currentSession === null
              ? Effect.succeed(null)
              : Effect.succeed(currentSession)
          ),
        }),
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
  renameFailureHttpCode = undefined;
  commitButLoseRenameResponse = false;
  renameReportsSourceMissingWithoutCommit = false;
  uploadStoreThenFail = false;
  hideStagingFromSearch = false;
  prefixDeleteFails = false;
  destroyOutcome = "destroyed";
  uncertainDestroyTargets = [];
  renameGateMillis = 0;
  renameStarted = false;
  renameSettledDeferred = null;
  accountLockGate = null;
  storedAssets = new Set();
  assetIdByPublicId = new Map();
  lastUploadedBytes = null;
  lastUploadedAssetId = null;
  linkActivity = "active";
  deletionRequestedAt = null;
  currentSession = makeSession(accountId);
};

describe("customer avatar namespaces", () => {
  test("isolates production, development, and immutable preview identities", () => {
    expect(
      deriveCustomerAvatarNamespace({
        vercelEnvironment: "production",
        deploymentId: Option.some("preview-commit"),
      })
    ).toEqual(Option.some("avatars/production"));
    expect(
      deriveCustomerAvatarNamespace({
        vercelEnvironment: "development",
        deploymentId: Option.none(),
      })
    ).toEqual(Option.some("avatars/development"));
    expect(
      deriveCustomerAvatarNamespace({
        vercelEnvironment: "preview",
        deploymentId: Option.some("  immutable-commit  "),
      })
    ).toEqual(Option.some("avatars/preview/immutable-commit"));
  });

  test("fails closed when the preview identity is missing or empty", () => {
    for (const deploymentId of [Option.none(), Option.some("   ")]) {
      expect(
        deriveCustomerAvatarNamespace({
          vercelEnvironment: "preview",
          deploymentId,
        })
      ).toEqual(Option.none());
    }
  });
});

/** Clears the call log and failure programming while keeping stored assets. */
const clearCalls = () => {
  calls = [];
  renameFailuresRemaining = 0;
  renameFailureHttpCode = undefined;
  commitButLoseRenameResponse = false;
  renameReportsSourceMissingWithoutCommit = false;
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

    // Recovery checks the live asset first (absent), lists staging (empty),
    // then stages and promotes the fresh upload.
    expect(calls.map(({ op }) => op)).toEqual([
      "get",
      "search",
      "upload",
      "rename",
    ]);
    const search = calls[1]!;
    const upload = calls[2]!;
    const rename = calls[3]!;
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

  test("loads the uploaded account avatar again from provider state after a fresh service read", async () => {
    resetFakes();
    const bytes = await pngBytes(300, 200);

    await runWith(
      Effect.flatMap(CustomerAvatarService, (avatars) =>
        avatars.upload(accountId, uploadInput(bytes))
      )
    );
    clearCalls();

    const reloaded = await runWith(
      Effect.flatMap(CustomerAvatarService, (avatars) =>
        avatars.lookup(accountId)
      )
    );

    expect(reloaded).toEqual({
      url: buildVersionedDeliveryUrl(
        makeAsset(
          "avatars/test/acct-avatar-1",
          42,
          assetIdByPublicId.get("avatars/test/acct-avatar-1")
        )
      ),
      version: 42,
    });
    expect(calls).toEqual([
      { op: "get", publicId: "avatars/test/acct-avatar-1" },
    ]);
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

  test("accepts and normalizes an actual WebP upload", async () => {
    resetFakes();
    const webp = await sharp({
      create: {
        width: 180,
        height: 120,
        channels: 3,
        background: { r: 90, g: 130, b: 170 },
      },
    })
      .webp()
      .toBuffer();

    const outcome = await runWith(
      Effect.flatMap(CustomerAvatarService, (avatars) =>
        avatars.upload(
          accountId,
          uploadInput(new Uint8Array(webp), {
            declaredMediaType: "image/webp",
          })
        )
      )
    );

    expect(outcome).toMatchObject({ version: 99 });
    expect(lastUploadedBytes).not.toBeNull();
    if (lastUploadedBytes) {
      expect((await sharp(lastUploadedBytes).metadata()).format).toBe("webp");
    }
  });

  test("strips real metadata from an input image that carries EXIF before staging", async () => {
    resetFakes();
    // The fixture itself carries EXIF metadata, so the assertion proves
    // stripping rather than an already-metadata-free input.
    const bytesWithExif = await sharp({
      create: {
        width: 600,
        height: 400,
        channels: 3,
        background: { r: 40, g: 80, b: 160 },
      },
    })
      .jpeg()
      .withMetadata({
        exif: { IFD0: { Copyright: "deskohub-avatar-fixture" } },
      })
      .toBuffer();
    const probedInput = await sharp(bytesWithExif).metadata();
    expect(probedInput.exif).toBeDefined();

    const outcome = await runWith(
      Effect.flatMap(CustomerAvatarService, (avatars) =>
        avatars.upload(
          accountId,
          uploadInput(new Uint8Array(bytesWithExif), {
            declaredMediaType: "image/jpeg",
          })
        )
      )
    );
    expect(outcome).toMatchObject({ version: 99 });

    expect(lastUploadedBytes).not.toBeNull();
    if (lastUploadedBytes) {
      const metadata = await sharp(lastUploadedBytes).metadata();
      expect(metadata.format).toBe("webp");
      expect(Object.hasOwn(metadata, "exif")).toBe(false);
      expect(Object.hasOwn(metadata, "icc")).toBe(false);
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
    storedAssets.add("avatars/test/acct-avatar-1");
    assetIdByPublicId.set("avatars/test/acct-avatar-1", "asset-old-avatar");

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
    expect(storedAssets.has("avatars/test/acct-avatar-1")).toBe(true);
    expect(assetIdByPublicId.get("avatars/test/acct-avatar-1")).toBe(
      "asset-old-avatar"
    );
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
    // The live lookup runs first; with no live asset and no retained
    // staging, two ambiguous rename attempts are followed by reconciliation.
    expect(ops).toEqual(["get", "search", "upload", "rename", "rename", "get"]);
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
    expect(calls.map(({ op }) => op)).toEqual(["destroy", "delete-prefix"]);
    const destroys = calls.filter(
      (call): call is Extract<CloudinaryCall, { op: "destroy" }> =>
        call.op === "destroy"
    );
    expect(destroys[0]!.publicId).toBe("avatars/test/acct-avatar-1");
    expect(calls[1]).toEqual({
      op: "delete-prefix",
      prefix: "avatars/test-staging/acct-avatar-1/",
    });
    expect(storedAssets.has(retainedStagedId)).toBe(false);
    // Nothing recoverable survives deletion.
    expect(storedAssets.size).toBe(0);
  });

  test("deletes staged assets when Search returns empty while an account staging asset exists", async () => {
    resetFakes();
    storedAssets.add("avatars/test/acct-avatar-1");
    const stagedId = "avatars/test-staging/acct-avatar-1/retained";
    storedAssets.add(stagedId);
    hideStagingFromSearch = true;

    const searchResult = await Effect.runPromise(
      Effect.flatMap(Cloudinary, (cloudinary) =>
        cloudinary.listFolderAssets("avatars/test-staging/acct-avatar-1", {
          maxResults: 8,
        })
      ).pipe(Effect.provide(CloudinaryLayer))
    );
    expect(searchResult).toEqual([]);
    expect(storedAssets.has(stagedId)).toBe(true);
    clearCalls();

    const outcome = await runWith(
      Effect.flatMap(CustomerAvatarService, (avatars) =>
        avatars.destroy(accountId).pipe(Effect.result)
      )
    );

    expect(outcome._tag).toBe("Success");
    expect(calls.map(({ op }) => op)).toEqual(["destroy", "delete-prefix"]);
    expect(calls[1]).toEqual({
      op: "delete-prefix",
      prefix: "avatars/test-staging/acct-avatar-1/",
    });
    expect(storedAssets.size).toBe(0);
  });

  test("keeps deletion retryable when account-prefix staging deletion fails", async () => {
    resetFakes();
    storedAssets.add("avatars/test/acct-avatar-1");
    const stagedId = "avatars/test-staging/acct-avatar-1/retained";
    storedAssets.add(stagedId);
    prefixDeleteFails = true;

    const outcome = await runWith(
      Effect.flatMap(CustomerAvatarService, (avatars) =>
        avatars.destroy(accountId).pipe(Effect.result)
      )
    );

    expect(outcome).toMatchObject({
      failure: { _tag: "CustomerAvatarProviderError" },
    });
    expect(calls.map(({ op }) => op)).toEqual(["destroy", "delete-prefix"]);
    expect(storedAssets.has(stagedId)).toBe(true);
  });

  test("uses a trailing account prefix so deletion cannot match another account ID", async () => {
    resetFakes();
    const ownStagedId = "avatars/test-staging/acct-avatar-1/own";
    const neighboringStagedId = "avatars/test-staging/acct-avatar-10/other";
    storedAssets.add(ownStagedId);
    storedAssets.add(neighboringStagedId);

    await runWith(
      Effect.flatMap(CustomerAvatarService, (avatars) =>
        avatars.destroy(accountId)
      )
    );

    expect(storedAssets.has(ownStagedId)).toBe(false);
    expect(storedAssets.has(neighboringStagedId)).toBe(true);
    expect(calls[1]).toEqual({
      op: "delete-prefix",
      prefix: "avatars/test-staging/acct-avatar-1/",
    });
  });

  test("skips staging recovery when a live avatar exists, keeps it intact, and fails the fresh upload retryably", async () => {
    resetFakes();
    // A live avatar plus an older retained staging copy.
    storedAssets.add("avatars/test/acct-avatar-1");
    assetIdByPublicId.set("avatars/test/acct-avatar-1", "asset-newer-live");
    const retainedStagedId = "avatars/test-staging/acct-avatar-1/older";
    storedAssets.add(retainedStagedId);
    assetIdByPublicId.set(retainedStagedId, "asset-older-retained");
    // The fresh staging upload stores the bytes but fails the call.
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
    const ops = calls.map(({ op }) => op);
    // Recovery never ran: the live lookup succeeded with an asset present,
    // so the older retained staging was not promoted over the newer live
    // avatar.
    expect(ops).toEqual(["get", "upload", "destroy"]);
    expect(calls.filter((call) => call.op === "rename")).toHaveLength(0);
    // The newer live avatar is unchanged, with its original identity.
    expect(storedAssets.has("avatars/test/acct-avatar-1")).toBe(true);
    expect(assetIdByPublicId.get("avatars/test/acct-avatar-1")).toBe(
      "asset-newer-live"
    );
    // The failed fresh staging upload was cleaned up; the older retained
    // staging stays as deletion cleanup material.
    expect(storedAssets.has(retainedStagedId)).toBe(true);
  });

  test("an uncertain staging destroy during deletion fails retryably", async () => {
    resetFakes();
    const retainedStagedId = await retainStaging();
    prefixDeleteFails = true;

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

    // Success is reported only against the identity-confirmed live asset:
    // the lookup's immutable asset_id matches the staged upload's.
    expect(outcome).toMatchObject({
      url: expect.stringContaining("/upload/"),
      version: 42,
    });
    const ops = calls.map(({ op }) => op);
    expect(ops).toEqual([
      "get",
      "search",
      "upload",
      "rename",
      "get",
      "destroy",
    ]);
    expect(storedAssets.has("avatars/test/acct-avatar-1")).toBe(true);
  });

  test("treats a source-missing promotion as uncertain when the live asset is the previous avatar, not the promoted upload", async () => {
    resetFakes();
    // The provider reports the staged source missing but the asset at the
    // live ID still carries the OLD avatar's identity: the rename never
    // committed and the outcome must stay uncertain, not successful.
    renameReportsSourceMissingWithoutCommit = true;
    assetIdByPublicId.set(
      "avatars/test/acct-avatar-1",
      "asset-old-live-avatar"
    );
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
    // Recovery is skipped entirely (the live asset exists), then the fresh
    // staging upload, one rename response, and identity reconciliation.
    expect(ops).toEqual(["get", "upload", "rename", "get"]);
    // The previous avatar is untouched and nothing was destroyed: the
    // staged source vanished provider-side, but no success was claimed.
    expect(storedAssets.has("avatars/test/acct-avatar-1")).toBe(true);
    expect(assetIdByPublicId.get("avatars/test/acct-avatar-1")).toBe(
      "asset-old-live-avatar"
    );
    expect(calls.some((call) => call.op === "destroy")).toBe(false);
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
      "get",
      "upload",
      "rename",
      "rename",
      "get",
      "destroy",
    ]);
    // The previous avatar stays live.
    expect(storedAssets.has("avatars/test/acct-avatar-1")).toBe(true);
  });

  test("retains staging for a 499 timeout when no live asset identity can be confirmed", async () => {
    resetFakes();
    renameFailuresRemaining = 2;
    renameFailureHttpCode = 499;
    const bytes = await pngBytes(100, 100);

    const outcome = await runWith(
      Effect.flatMap(CustomerAvatarService, (avatars) =>
        avatars.upload(accountId, uploadInput(bytes)).pipe(Effect.result)
      )
    );

    expect(outcome).toMatchObject({
      failure: { _tag: "CustomerAvatarProviderError" },
    });
    expect(calls.filter((call) => call.op === "rename")).toHaveLength(2);
    expect([...storedAssets]).toHaveLength(1);
    expect([...storedAssets][0]).toMatch(
      /^avatars\/test-staging\/acct-avatar-1\//
    );
    expect(storedAssets.has("avatars/test/acct-avatar-1")).toBe(false);
    expect(calls.some((call) => call.op === "destroy")).toBe(false);
  });

  test("reconciles a committed 499 timeout against the matching live asset identity", async () => {
    resetFakes();
    commitButLoseRenameResponse = true;
    renameFailureHttpCode = 499;
    const bytes = await pngBytes(100, 100);

    const outcome = await runWith(
      Effect.flatMap(CustomerAvatarService, (avatars) =>
        avatars.upload(accountId, uploadInput(bytes))
      )
    );

    expect(outcome).toMatchObject({
      url: expect.stringContaining("/upload/"),
      version: 42,
    });
    expect(calls.map(({ op }) => op)).toEqual([
      "get",
      "search",
      "upload",
      "rename",
      "rename",
      "get",
      "destroy",
    ]);
    expect(storedAssets).toEqual(new Set(["avatars/test/acct-avatar-1"]));
    expect(lastUploadedAssetId).not.toBeNull();
    expect(assetIdByPublicId.get("avatars/test/acct-avatar-1")).toBe(
      lastUploadedAssetId
    );
  });

  test("cleans staging after a definitive promotion rejection without changing the previous avatar", async () => {
    resetFakes();
    renameFailuresRemaining = 1;
    renameFailureHttpCode = 400;
    storedAssets.add("avatars/test/acct-avatar-1");
    assetIdByPublicId.set("avatars/test/acct-avatar-1", "asset-old-avatar");
    const bytes = await pngBytes(100, 100);

    const outcome = await runWith(
      Effect.flatMap(CustomerAvatarService, (avatars) =>
        avatars.upload(accountId, uploadInput(bytes)).pipe(Effect.result)
      )
    );

    expect(outcome).toMatchObject({
      failure: { _tag: "CustomerAvatarProviderError" },
    });
    expect(calls.map(({ op }) => op)).toEqual([
      "get",
      "upload",
      "rename",
      "destroy",
    ]);
    expect(storedAssets).toEqual(new Set(["avatars/test/acct-avatar-1"]));
    expect(assetIdByPublicId.get("avatars/test/acct-avatar-1")).toBe(
      "asset-old-avatar"
    );
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

  test("rechecks the verified session before upload after waiting for the account lock", async () => {
    resetFakes();
    const bytes = await pngBytes(50, 50);

    const outcome = await runWith(
      Effect.gen(function* () {
        const entered = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        accountLockGate = { entered, release };
        const avatars = yield* CustomerAvatarService;
        const upload = yield* Effect.forkChild(
          avatars.upload(accountId, uploadInput(bytes)).pipe(Effect.result)
        );

        yield* Deferred.await(entered);
        currentSession = null;
        yield* Deferred.succeed(release, undefined);
        const result = yield* Fiber.join(upload);
        accountLockGate = null;
        return result;
      })
    );

    expect(outcome).toMatchObject({
      _tag: "Failure",
      failure: {
        _tag: "CustomerAccountAccessError",
        reason: "unauthenticated",
      },
    });
    expect(calls).toHaveLength(0);
  });

  test("rechecks the verified session before remove after waiting for the account lock", async () => {
    resetFakes();
    const liveId = "avatars/test/acct-avatar-1";
    storedAssets.add(liveId);

    const outcome = await runWith(
      Effect.gen(function* () {
        const entered = yield* Deferred.make<void>();
        const release = yield* Deferred.make<void>();
        accountLockGate = { entered, release };
        const avatars = yield* CustomerAvatarService;
        const remove = yield* Effect.forkChild(
          avatars.remove(accountId).pipe(Effect.result)
        );

        yield* Deferred.await(entered);
        currentSession = null;
        yield* Deferred.succeed(release, undefined);
        const result = yield* Fiber.join(remove);
        accountLockGate = null;
        return result;
      })
    );

    expect(outcome).toMatchObject({
      _tag: "Failure",
      failure: {
        _tag: "CustomerAccountAccessError",
        reason: "unauthenticated",
      },
    });
    expect(calls).toHaveLength(0);
    expect(storedAssets.has(liveId)).toBe(true);
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
    expect(calls.map(({ op }) => op)).toEqual(["destroy", "delete-prefix"]);

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

  test("an interruption requested during a delayed rename cannot let deletion run past the in-flight rename", async () => {
    resetFakes();
    // The provider holds the rename response; the upload is in flight.
    renameGateMillis = 60;
    const bytes = await pngBytes(100, 100);

    const deletion = await runWith(
      Effect.gen(function* () {
        const renameSettled = yield* Deferred.make<void>();
        renameSettledDeferred = renameSettled;

        const uploadFiber = yield* Effect.forkChild(
          Effect.flatMap(CustomerAvatarService, (avatars) =>
            avatars.upload(accountId, uploadInput(bytes)).pipe(Effect.ignore)
          )
        );

        // Wait until the rename request is actually in flight.
        const waitUntilStarted = (): Effect.Effect<void> =>
          renameStarted
            ? Effect.void
            : Effect.sleep("5 millis").pipe(Effect.andThen(waitUntilStarted));
        yield* waitUntilStarted();

        // The action runtime times out and deletion starts while the rename
        // is still in flight: the interrupt is only requested (never awaited
        // first) and deletion is forked concurrently. The real advisory lock
        // serializes the two critical sections; the deferred below models
        // that ordering deterministically by releasing deletion only once
        // the uninterruptible upload section has settled its rename.
        const interruptFiber = yield* Effect.forkChild(
          Fiber.interrupt(uploadFiber).pipe(Effect.ignore)
        );
        const deletionFiber = yield* Effect.forkChild(
          Deferred.await(renameSettled).pipe(
            Effect.andThen(
              Effect.flatMap(CustomerAvatarService, (avatars) =>
                avatars.destroy(accountId).pipe(Effect.result)
              )
            ),
            Effect.orDie
          )
        );

        const result = yield* Fiber.join(deletionFiber);
        yield* Fiber.join(interruptFiber);
        yield* Fiber.await(uploadFiber);

        // No late provider mutation arrived after deletion settled.
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
