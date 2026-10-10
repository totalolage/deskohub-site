import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import type { CloudinaryPublicId } from "@deskohub/cloudinary/schema";
import {
  Context,
  Deferred,
  Effect,
  Fiber,
  Layer,
  Option,
  Schema,
} from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { WorkspaceDatabaseAdvisoryLock } from "@/db/postgres-advisory-lock";
import { reservationCustomerEmailSchema } from "@/features/reservation/reservation-contact";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { customerAccountIdSchema } from "../customer-account";
import { CustomerAccountLinkRepository } from "./customer-account-link.repository";
import {
  type CustomerAccountSession,
  CustomerAuthentication,
} from "./customer-authentication.service";

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
    readonly deleteResourcesByPublicIdPrefix: (
      prefix: CloudinaryPublicId
    ) => Effect.Effect<void, { _tag: string }>;
    readonly renameAsset: (
      from: CloudinaryPublicId,
      to: CloudinaryPublicId,
      options?: { readonly overwrite?: boolean }
    ) => Effect.Effect<unknown, { _tag: string }>;
  }
>()("@deskohub/cloudinary/CloudinaryService");

/** Stored media: public ID → immutable provider asset identity. */
let stored: Map<string, string> = new Map();
let providerCalls: string[] = [];
let uploadEntered: Deferred.Deferred<never, void> | null = null;
let releaseUpload: Deferred.Deferred<never, void> | null = null;
let currentSession: CustomerAccountSession | null = null;

const makeSession = (account: string): CustomerAccountSession => ({
  accountId: customerAccountIdSchema.make(account),
  email: Schema.decodeSync(reservationCustomerEmailSchema)(
    "avatar@example.test"
  ),
  deletionRequested: false,
});

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
    Effect.suspend(() => {
      providerCalls.push("get");
      return stored.has(publicId)
        ? Effect.succeed(makeAsset(publicId, stored.get(publicId)))
        : Effect.fail({ _tag: "CloudinarySearchError", httpCode: 404 });
    }),
  listFolderAssets: (folder, options) =>
    Effect.sync(() => {
      providerCalls.push("search");
      return [...stored.keys()]
        .filter((id) => id.startsWith(`${folder}/`))
        .slice(0, options?.maxResults ?? 100)
        .map((id) => makeAsset(id, stored.get(id)));
    }),
  uploadImage: (input) =>
    Effect.suspend(() => {
      providerCalls.push("upload");
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
      providerCalls.push("destroy");
      stored.delete(publicId);
      return "destroyed";
    }),
  deleteResourcesByPublicIdPrefix: (prefix) =>
    Effect.sync(() => {
      providerCalls.push("delete-prefix");
      for (const publicId of stored.keys()) {
        if (publicId.startsWith(prefix)) stored.delete(publicId);
      }
    }),
  renameAsset: (from, to) =>
    Effect.suspend(() => {
      providerCalls.push("rename");
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

Object.assign(Cloudinary, { Live: CloudinaryLayer });

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

const waitForAccountAdvisoryLockWait = async (account: string) => {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const waiting = await testDatabase!.pool.query(
      `
        select 1
        from pg_locks
        where locktype = 'advisory'
          and not granted
          and classid::bigint = (hashtext($1)::bigint & 4294967295)
          and objid::bigint = (hashtext($2)::bigint & 4294967295)
          and objsubid = 2
      `,
      ["customer-account", account]
    );
    if (waiting.rows.length > 0) return;
    await Bun.sleep(10);
  }
  throw new Error("Timed out waiting for the account advisory lock waiter.");
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
          Layer.succeed(CustomerAuthentication, {
            currentUser: Effect.suspend(() =>
              currentSession === null
                ? Effect.succeed(null)
                : Effect.succeed(currentSession)
            ),
          }),
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
      providerCalls = [];
      uploadEntered = null;
      releaseUpload = null;
      const account = customerAccountIdSchema.make(uniqueId());
      currentSession = makeSession(account);
      await insertAuthUser(account, `race-${account}@deskohub.test`);
      await insertLink(account, uniqueDotyposCustomerId());
      const bytes = await pngBytes();

      await Effect.runPromise(
        Effect.gen(function* () {
          const avatars = yield* CustomerAvatarService;
          uploadEntered = yield* Deferred.make<void>();
          releaseUpload = yield* Deferred.make<void>();
          const uploadFiber = yield* Effect.forkChild(
            Effect.all(
              [
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
              ],
              { concurrency: "unbounded" }
            )
          );

          // The first provider upload holds the account lock while the other
          // upload reaches Postgres and waits for that same advisory lock.
          yield* Deferred.await(uploadEntered);
          yield* Effect.promise(() => waitForAccountAdvisoryLockWait(account));
          expect(
            providerCalls.filter((call) => call === "upload")
          ).toHaveLength(1);
          yield* Deferred.succeed(releaseUpload, undefined);
          const outcomes = yield* Fiber.join(uploadFiber);
          expect(outcomes).toHaveLength(2);
          for (const outcome of outcomes) {
            expect(outcome.url).toContain(`avatars/test/${account}`);
          }
        }).pipe(Effect.provide(makeLayer()))
      );

      const uploads = providerCalls.flatMap((call, index) =>
        call === "upload" ? [index] : []
      );
      const renames = providerCalls.flatMap((call, index) =>
        call === "rename" ? [index] : []
      );
      expect(uploads).toHaveLength(2);
      expect(renames).toHaveLength(2);
      expect(uploads[0]).toBeLessThan(renames[0]!);
      expect(renames[0]).toBeLessThan(uploads[1]!);
      expect(uploads[1]).toBeLessThan(renames[1]!);
      expect([...stored.keys()]).toEqual([`avatars/test/${account}`]);
      const authImage = await testDatabase!.pool.query(
        `select image from auth."user" where id = $1`,
        [account]
      );
      expect(authImage.rows[0]?.image).toBeNull();
    });

    test("rejects upload when the verified session is revoked while it waits for the account lock", async () => {
      stored = new Map();
      providerCalls = [];
      const account = customerAccountIdSchema.make(uniqueId());
      currentSession = makeSession(account);
      await insertAuthUser(account, `race-${account}@deskohub.test`);
      await insertLink(account, uniqueDotyposCustomerId());
      const bytes = await pngBytes();

      const outcome = await Effect.runPromise(
        Effect.gen(function* () {
          const avatars = yield* CustomerAvatarService;
          const links = yield* CustomerAccountLinkRepository;
          const lockAcquired = yield* Deferred.make<void>();
          const releaseLock = yield* Deferred.make<void>();
          const lockOwner = yield* Effect.forkChild(
            links
              .withAccountLock(
                account,
                Deferred.succeed(lockAcquired, undefined).pipe(
                  Effect.andThen(Deferred.await(releaseLock))
                )
              )
              .pipe(Effect.orDie)
          );
          yield* Deferred.await(lockAcquired);

          const upload = yield* Effect.forkChild(
            avatars
              .upload(account, {
                bytes,
                declaredSize: bytes.byteLength,
                declaredMediaType: "image/png",
              })
              .pipe(Effect.result)
          );
          yield* Effect.promise(() => waitForAccountAdvisoryLockWait(account));

          currentSession = null;
          yield* Deferred.succeed(releaseLock, undefined);
          const result = yield* Fiber.join(upload);
          yield* Fiber.join(lockOwner);
          return result;
        }).pipe(Effect.provide(makeLayer()))
      );

      expect(outcome).toMatchObject({
        _tag: "Failure",
        failure: {
          _tag: "CustomerAccountAccessError",
          reason: "unauthenticated",
        },
      });
      expect(providerCalls).toEqual([]);
    });

    test("rejects remove when the verified session is revoked while it waits for the account lock", async () => {
      stored = new Map();
      providerCalls = [];
      const account = customerAccountIdSchema.make(uniqueId());
      currentSession = makeSession(account);
      await insertAuthUser(account, `race-${account}@deskohub.test`);
      await insertLink(account, uniqueDotyposCustomerId());
      stored.set(`avatars/test/${account}`, "asset-before-remove");

      const outcome = await Effect.runPromise(
        Effect.gen(function* () {
          const avatars = yield* CustomerAvatarService;
          const links = yield* CustomerAccountLinkRepository;
          const lockAcquired = yield* Deferred.make<void>();
          const releaseLock = yield* Deferred.make<void>();
          const lockOwner = yield* Effect.forkChild(
            links
              .withAccountLock(
                account,
                Deferred.succeed(lockAcquired, undefined).pipe(
                  Effect.andThen(Deferred.await(releaseLock))
                )
              )
              .pipe(Effect.orDie)
          );
          yield* Deferred.await(lockAcquired);

          const remove = yield* Effect.forkChild(
            avatars.remove(account).pipe(Effect.result)
          );
          yield* Effect.promise(() => waitForAccountAdvisoryLockWait(account));

          currentSession = null;
          yield* Deferred.succeed(releaseLock, undefined);
          const result = yield* Fiber.join(remove);
          yield* Fiber.join(lockOwner);
          return result;
        }).pipe(Effect.provide(makeLayer()))
      );

      expect(outcome).toMatchObject({
        _tag: "Failure",
        failure: {
          _tag: "CustomerAccountAccessError",
          reason: "unauthenticated",
        },
      });
      expect(providerCalls).toEqual([]);
      expect(stored.has(`avatars/test/${account}`)).toBe(true);
    });

    test("serializes upload racing remove so no staging survives and remove lands last", async () => {
      stored = new Map();
      providerCalls = [];
      const account = customerAccountIdSchema.make(uniqueId());
      currentSession = makeSession(account);
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
          yield* Effect.promise(() => waitForAccountAdvisoryLockWait(account));

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
      providerCalls = [];
      const account = customerAccountIdSchema.make(uniqueId());
      currentSession = makeSession(account);
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
          yield* Effect.promise(() => waitForAccountAdvisoryLockWait(account));

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
