import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import type { CloudinaryPublicId } from "@deskohub/cloudinary/schema";
import { Context, Deferred, Effect, Fiber, Layer, Option } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { WorkspaceDatabaseAdvisoryLock } from "@/db/postgres-advisory-lock";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { customerAccountIdSchema } from "../customer-account";
import { CustomerAccountLinkRepository } from "./customer-account-link.repository";

const testDatabase = await connectWorkspacePostgresTestDatabase();

/**
 * Provider-independent avatar concurrency coverage: the real advisory-lock
 * adapter serializes real `CustomerAvatarService` critical sections against
 * a controllable fake media provider whose stored media is directly
 * observable. The fake Cloudinary tag mirrors the real service tag, which
 * the module mock below substitutes wholesale.
 */
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
    readonly renameAsset: (
      from: CloudinaryPublicId,
      to: CloudinaryPublicId,
      options?: { readonly overwrite?: boolean }
    ) => Effect.Effect<unknown, { _tag: string }>;
  }
>()("@deskohub/cloudinary/CloudinaryService");

/** Stored media: public ID → immutable provider asset identity. */
let stored: Map<string, string> = new Map();
let uploadEntered: Deferred.Deferred<never, void> | null = null;
let releaseUpload: Deferred.Deferred<never, void> | null = null;

const makeAsset = (publicId: string, assetId?: string) => ({
  public_id: publicId,
  asset_id: assetId ?? `asset-${publicId}`,
  secure_url: `https://res.cloudinary.test/upload/${publicId}`,
  url: `http://res.cloudinary.test/${publicId}`,
  width: 512,
  height: 512,
  format: "webp",
  resource_type: "image",
  version: 7,
  created_at: "2026-09-01T00:00:00Z",
});

const CloudinaryLayer = Layer.succeed(Cloudinary, {
  getByPublicId: (publicId) =>
    Effect.suspend(() =>
      stored.has(publicId)
        ? Effect.succeed(makeAsset(publicId, stored.get(publicId)))
        : Effect.fail({ _tag: "CloudinarySearchError", httpCode: 404 })
    ),
  listFolderAssets: (folder, options) =>
    Effect.succeed(
      [...stored.keys()]
        .filter((id) => id.startsWith(`${folder}/`))
        .slice(0, options?.maxResults ?? 100)
        .map((id) => makeAsset(id, stored.get(id)))
    ),
  uploadImage: (input) =>
    Effect.suspend(() => {
      const fullId = `${input.folder}/${input.publicId}`;
      const entered = uploadEntered;
      const release = releaseUpload;
      return (
        entered ? Deferred.succeed(entered, undefined) : Effect.void
      ).pipe(
        Effect.andThen(release ? Deferred.await(release) : Effect.void),
        Effect.andThen(
          Effect.sync(() => {
            stored.set(fullId, `asset-upload-${crypto.randomUUID()}`);
            return makeAsset(fullId, stored.get(fullId));
          })
        )
      );
    }),
  destroyAsset: (publicId) =>
    Effect.sync(() => {
      stored.delete(publicId);
      return "destroyed";
    }),
  renameAsset: (from, to) =>
    Effect.suspend(() => {
      const assetId = stored.get(from);
      stored.delete(from);
      if (assetId !== undefined) {
        stored.set(to, assetId);
      } else {
        return Effect.fail({
          _tag: "CloudinaryRenameError",
          reason: "source-missing",
        });
      }
      return Effect.succeed(makeAsset(to, assetId));
    }),
});

Object.assign(Cloudinary, { Default: CloudinaryLayer });

const cloudinaryServerModule = "@deskohub/cloudinary" + "/server";
mock.module(cloudinaryServerModule, () => ({
  CloudinaryService: Cloudinary,
  makeCloudinaryRuntimeConfigLayer: () => Layer.mergeAll(CloudinaryLayer),
}));

const { CustomerAvatarService, CustomerAvatarSettings } = await import(
  "./customer-avatar.service"
);

const uniqueId = () => crypto.randomUUID();
let dotyposCustomerSequence = 0;
const uniqueDotyposCustomerId = () =>
  `${Date.now()}${dotyposCustomerSequence++}`;

const insertAuthUser = async (id: string, email: string) => {
  await testDatabase!.pool.query(
    `insert into auth."user" (id, name, email) values ($1, '', $2)`,
    [id, email]
  );
};

const insertLink = async (account: string, dotyposCustomerId: string) => {
  await testDatabase!.pool.query(
    `insert into customer_account_links (customer_account_id, dotypos_customer_id) values ($1, $2) on conflict do nothing`,
    [account, dotyposCustomerId]
  );
};

const makeLayer = () =>
  testDatabase &&
  Layer.mergeAll(
    CustomerAvatarService.Default.pipe(
      Layer.provide(
        Layer.mergeAll(
          CloudinaryLayer,
          CustomerAccountLinkRepository.Default.pipe(
            Layer.provide(
              Layer.mergeAll(
                Layer.succeed(
                  WorkspaceDatabase,
                  WorkspaceDatabase.of({ db: testDatabase.db })
                ),
                WorkspaceDatabaseAdvisoryLock.makeLayer(testDatabase.pool)
              )
            )
          ),
          Layer.succeed(CustomerAvatarSettings, {
            namespace: Option.some("avatars/test"),
          })
        )
      )
    ),
    CustomerAccountLinkRepository.Default.pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(
            WorkspaceDatabase,
            WorkspaceDatabase.of({ db: testDatabase.db })
          ),
          WorkspaceDatabaseAdvisoryLock.makeLayer(testDatabase.pool)
        )
      )
    )
  );

const pngBytes = () =>
  import("sharp").then(({ default: sharp }) =>
    sharp({
      create: {
        width: 80,
        height: 80,
        channels: 3,
        background: { r: 10, g: 20, b: 30 },
      },
    })
      .png()
      .toBuffer()
      .then((buffer: Buffer) => new Uint8Array(buffer))
  );

describe.skipIf(!testDatabase)(
  "CustomerAvatarService against the real advisory lock on disposable Postgres",
  () => {
    test("serializes upload racing upload into exactly one live avatar with no staging left", async () => {
      stored = new Map();
      const account = customerAccountIdSchema.make(uniqueId());
      await insertAuthUser(account, `race-${account}@deskohub.test`);
      await insertLink(account, uniqueDotyposCustomerId());
      const bytes = await pngBytes();

      await Effect.runPromise(
        Effect.gen(function* () {
          const avatars = yield* CustomerAvatarService;
          const outcomes = yield* Effect.all([
            avatars.upload(account, {
              bytes,
              declaredSize: bytes.byteLength,
              declaredMediaType: "image/png",
            }),
            avatars.upload(account, {
              bytes,
              declaredSize: bytes.byteLength,
              declaredMediaType: "image/png",
            }),
          ]);
          expect(outcomes).toHaveLength(2);
          for (const outcome of outcomes) {
            expect(outcome.url).toContain(`avatars/test/${account}`);
          }
        }).pipe(Effect.provide(makeLayer()))
      );

      expect([...stored.keys()]).toEqual([`avatars/test/${account}`]);
      const authImage = await testDatabase!.pool.query(
        `select image from auth."user" where id = $1`,
        [account]
      );
      expect(authImage.rows[0]?.image).toBeNull();
    });

    test("serializes upload racing remove so no staging survives and remove lands last", async () => {
      stored = new Map();
      const account = customerAccountIdSchema.make(uniqueId());
      await insertAuthUser(account, `race-${account}@deskohub.test`);
      await insertLink(account, uniqueDotyposCustomerId());
      const bytes = await pngBytes();

      await Effect.runPromise(
        Effect.gen(function* () {
          const avatars = yield* CustomerAvatarService;

          // Hold the upload mid-flight while it owns the account lock.
          uploadEntered = yield* Deferred.make<void>();
          releaseUpload = yield* Deferred.make<void>();

          const uploadFiber = yield* Effect.forkChild(
            avatars
              .upload(account, {
                bytes,
                declaredSize: bytes.byteLength,
                declaredMediaType: "image/png",
              })
              .pipe(Effect.orDie)
          );

          // Wait until the upload is inside its locked critical section.
          yield* Deferred.await(uploadEntered);
          const removeFiber = yield* Effect.forkChild(
            avatars.remove(account).pipe(Effect.orDie)
          );
          yield* Effect.sleep("150 millis");

          yield* Deferred.succeed(releaseUpload, undefined);
          yield* Fiber.join(uploadFiber);
          yield* Fiber.join(removeFiber);
        }).pipe(Effect.provide(makeLayer()))
      );

      // The remove ran after the upload and destroyed everything.
      expect(stored.size).toBe(0);
      expect(
        [...stored.keys()].filter((id) => id.includes("-staging/"))
      ).toEqual([]);
    });

    test("serializes upload racing account deletion so deletion ends with no media and the marker set", async () => {
      stored = new Map();
      const account = customerAccountIdSchema.make(uniqueId());
      await insertAuthUser(account, `race-${account}@deskohub.test`);
      await insertLink(account, uniqueDotyposCustomerId());
      const bytes = await pngBytes();

      await Effect.runPromise(
        Effect.gen(function* () {
          const avatars = yield* CustomerAvatarService;
          const links = yield* CustomerAccountLinkRepository;

          uploadEntered = yield* Deferred.make<void>();
          releaseUpload = yield* Deferred.make<void>();

          const uploadFiber = yield* Effect.forkChild(
            avatars
              .upload(account, {
                bytes,
                declaredSize: bytes.byteLength,
                declaredMediaType: "image/png",
              })
              .pipe(Effect.orDie)
          );
          yield* Deferred.await(uploadEntered);

          // Account deletion mirrors the real lifecycle: the marker is
          // written under the account lock, then the avatar is destroyed
          // before identity removal.
          const deletionFiber = yield* Effect.forkChild(
            links
              .withAccountLock(
                account,
                links
                  .markDeletionRequested(account, new Date())
                  .pipe(Effect.andThen(avatars.destroy(account)))
              )
              .pipe(Effect.orDie)
          );
          yield* Effect.sleep("150 millis");

          yield* Deferred.succeed(releaseUpload, undefined);
          yield* Fiber.join(uploadFiber);
          yield* Fiber.join(deletionFiber);
        }).pipe(Effect.provide(makeLayer()))
      );

      // Deletion finished last: no media of any kind survives and the
      // durable marker is in place.
      expect(stored.size).toBe(0);
      expect(
        [...stored.keys()].filter((id) => id.includes("-staging/"))
      ).toEqual([]);
      const marker = await testDatabase!.pool.query(
        `select deletion_requested_at from auth."user" where id = $1`,
        [account]
      );
      expect(marker.rows[0]?.deletion_requested_at).not.toBeNull();
    });
  }
);
