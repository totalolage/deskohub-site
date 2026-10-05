import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { Deferred, Effect, Fiber, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import {
  WorkspaceDatabaseAdvisoryLock,
  withPostgresAdvisoryLock,
} from "@/db/postgres-advisory-lock";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { customerAccountIdSchema } from "../customer-account";
import { expireLinkedDotyposProfile } from "./customer-account-deletion";
import { CustomerAccountLinkRepository } from "./customer-account-link.repository";

const testDatabase = await connectWorkspacePostgresTestDatabase();

const uniqueId = () => crypto.randomUUID();
const uniqueDotyposId = () => String(60000 + Math.floor(Math.random() * 999));

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

const makeRepositoryLayer = () =>
  CustomerAccountLinkRepository.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(
          WorkspaceDatabase,
          WorkspaceDatabase.of({ db: testDatabase!.db })
        ),
        WorkspaceDatabaseAdvisoryLock.makeLayer(testDatabase!.pool)
      )
    )
  );

describe.skipIf(!testDatabase)(
  "Customer account deletion on disposable Postgres",
  () => {
    test("marks, expires, and destroys the avatar under the real account advisory lock", async () => {
      const layer = makeRepositoryLayer();
      const account = customerAccountIdSchema.make(uniqueId());
      const dotyposCustomerId = uniqueDotyposId();
      await insertAuthUser(account, `del-${account}@deskohub.test`);
      await insertLink(account, dotyposCustomerId);

      const order: string[] = [];

      await Effect.runPromise(
        Effect.gen(function* () {
          const links = yield* CustomerAccountLinkRepository;
          const requestDeletion = expireLinkedDotyposProfile({
            markDeletionRequested: links.markDeletionRequested,
            findLink: links.find,
            expireCustomer: (customerId) => {
              order.push(`expire:${customerId}`);
              return Effect.void;
            },
            destroyAvatar: (destroyAccountId) => {
              order.push(`destroy-avatar:${destroyAccountId}`);
              return Effect.void;
            },
            withAccountLock: links.withAccountLock,
          });
          return yield* requestDeletion(account);
        }).pipe(Effect.provide(layer))
      );

      expect(order).toEqual([
        `expire:${dotyposCustomerId}`,
        `destroy-avatar:${account}`,
      ]);

      const marker = await testDatabase!.pool.query(
        `select deletion_requested_at from auth."user" where id = $1`,
        [account]
      );
      expect(marker.rows[0]?.deletion_requested_at).not.toBeNull();
    });

    test("keeps the durable marker and the link row when the avatar destroy fails retryably", async () => {
      const layer = makeRepositoryLayer();
      const account = customerAccountIdSchema.make(uniqueId());
      const dotyposCustomerId = uniqueDotyposId();
      await insertAuthUser(account, `del-${account}@deskohub.test`);
      await insertLink(account, dotyposCustomerId);

      const outcome = await Effect.runPromise(
        Effect.gen(function* () {
          const links = yield* CustomerAccountLinkRepository;
          const requestDeletion = expireLinkedDotyposProfile({
            markDeletionRequested: links.markDeletionRequested,
            findLink: links.find,
            expireCustomer: () => Effect.void,
            destroyAvatar: () =>
              Effect.fail({ _tag: "CustomerAvatarProviderError" }),
            withAccountLock: links.withAccountLock,
          });
          return yield* Effect.result(requestDeletion(account));
        }).pipe(Effect.provide(layer))
      );

      expect(outcome._tag).toBe("Failure");

      const marker = await testDatabase!.pool.query(
        `select deletion_requested_at from auth."user" where id = $1`,
        [account]
      );
      expect(marker.rows[0]?.deletion_requested_at).not.toBeNull();

      const link = await testDatabase!.pool.query(
        `select dotypos_customer_id from customer_account_links where customer_account_id = $1`,
        [account]
      );
      expect(link.rows).toHaveLength(1);
      expect(link.rows[0]?.dotypos_customer_id).toBe(dotyposCustomerId);
    });

    test("serializes deletion against an outer account lock holder", async () => {
      const layer = makeRepositoryLayer();
      const account = customerAccountIdSchema.make(uniqueId());
      await insertAuthUser(account, `del-${account}@deskohub.test`);

      let deletionCompleted = false;

      await Effect.runPromise(
        Effect.gen(function* () {
          const links = yield* CustomerAccountLinkRepository;
          const gate = yield* Deferred.make<never, void>();

          const outer = yield* Effect.forkChild(
            withPostgresAdvisoryLock(
              testDatabase!.pool,
              ["customer-account", account],
              Deferred.await(gate).pipe(Effect.orDie)
            ).pipe(Effect.orDie)
          );

          yield* Effect.sleep("150 millis");

          const inner = yield* Effect.forkChild(
            links
              .withAccountLock(
                account,
                Effect.sync(() => {
                  deletionCompleted = true;
                })
              )
              .pipe(Effect.provide(layer), Effect.orDie)
          );

          yield* Effect.sleep("300 millis");
          expect(deletionCompleted).toBe(false);

          yield* Deferred.succeed(gate, undefined);
          yield* Fiber.join(outer);
          yield* Fiber.join(inner);

          expect(deletionCompleted).toBe(true);
        }).pipe(Effect.provide(layer))
      );
    });
  }
);
