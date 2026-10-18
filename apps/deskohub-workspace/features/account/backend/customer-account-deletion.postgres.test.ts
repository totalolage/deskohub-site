import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { eq } from "drizzle-orm";
import { Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { WorkspaceDatabaseAdvisoryLock } from "@/db/postgres-advisory-lock";
import { customerAccounts } from "@/db/schema";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import {
  type CustomerAccountId,
  customerAccountIdSchema,
} from "../customer-account";
import { CustomerAccountRepository } from "./customer-account.repository";
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

/** The tombstone's deletion instant, null while active, undefined when absent. */
const readDeletedAt = async (account: CustomerAccountId) => {
  const [row] = await testDatabase!.db
    .select({ deletedAt: customerAccounts.deletedAt })
    .from(customerAccounts)
    .where(eq(customerAccounts.id, account))
    .pipe(Effect.runPromise);
  return row === undefined ? undefined : (row.deletedAt?.toString() ?? null);
};

const makeRepositoryLayer = () =>
  Layer.mergeAll(
    CustomerAccountLinkRepository.Default,
    CustomerAccountRepository.Default
  ).pipe(
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
      await insertAuthUser(account, testEmailAddress(`del-${account}`));
      await insertLink(account, dotyposCustomerId);

      const order: string[] = [];

      await Effect.runPromise(
        Effect.gen(function* () {
          const links = yield* CustomerAccountLinkRepository;
          const accounts = yield* CustomerAccountRepository;
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
            tombstone: accounts.tombstone,
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
      expect(await readDeletedAt(account)).not.toBeNull();
    });

    test("keeps the durable marker and the link row when the avatar destroy fails retryably", async () => {
      const layer = makeRepositoryLayer();
      const account = customerAccountIdSchema.make(uniqueId());
      const dotyposCustomerId = uniqueDotyposId();
      await insertAuthUser(account, testEmailAddress(`del-${account}`));
      await insertLink(account, dotyposCustomerId);

      const outcome = await Effect.runPromise(
        Effect.gen(function* () {
          const links = yield* CustomerAccountLinkRepository;
          const accounts = yield* CustomerAccountRepository;
          const requestDeletion = expireLinkedDotyposProfile({
            markDeletionRequested: links.markDeletionRequested,
            findLink: links.find,
            expireCustomer: () => Effect.void,
            destroyAvatar: () =>
              Effect.fail({ _tag: "CustomerAvatarProviderError" }),
            tombstone: accounts.tombstone,
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
      expect(await readDeletedAt(account)).toBeUndefined();
    });

    test("keeps an authored reservation and its author tombstone after the identity is removed", async () => {
      const layer = makeRepositoryLayer();
      const account = customerAccountIdSchema.make(uniqueId());
      const dotyposCustomerId = uniqueDotyposId();
      await insertAuthUser(account, testEmailAddress(`del-${account}`));
      await insertLink(account, dotyposCustomerId);
      await testDatabase!.pool.query(
        `insert into customer_accounts (id) values ($1)`,
        [account]
      );
      const reservation = await testDatabase!.pool.query<{ id: string }>(
        `insert into workspace_reservations
           (checkout_attempt_key, dotypos_customer_id, author_account_id,
            reservation_state, payment_state, fulfillment_state,
            reservation_details, locale)
         values ($1, $2, $3, 'draft', 'not_started', 'not_started',
           '{"kind":"cowork","entryTier":"basic","coffee":false}', 'en-US')
         returning id`,
        [`attempt:${uniqueId()}`, dotyposCustomerId, account]
      );
      const reservationId = reservation.rows[0]!.id;

      try {
        await Effect.runPromise(
          Effect.gen(function* () {
            const links = yield* CustomerAccountLinkRepository;
            const accounts = yield* CustomerAccountRepository;
            return yield* expireLinkedDotyposProfile({
              markDeletionRequested: links.markDeletionRequested,
              findLink: links.find,
              expireCustomer: () => Effect.void,
              destroyAvatar: () => Effect.void,
              tombstone: accounts.tombstone,
              withAccountLock: links.withAccountLock,
            })(account);
          }).pipe(Effect.provide(layer))
        );
        const deletedAt = await readDeletedAt(account);
        // Better Auth removes the identity rows once the hook succeeds.
        await testDatabase!.pool.query(
          `delete from auth."user" where id = $1`,
          [account]
        );

        const kept = await testDatabase!.pool.query(
          `select author_account_id from workspace_reservations where id = $1`,
          [reservationId]
        );
        expect(kept.rows).toEqual([{ author_account_id: account }]);
        expect(deletedAt).not.toBeNull();
        expect(await readDeletedAt(account)).toEqual(deletedAt);
        const link = await testDatabase!.pool.query(
          `select 1 from customer_account_links where customer_account_id = $1`,
          [account]
        );
        expect(link.rows).toHaveLength(0);
        await expect(
          testDatabase!.pool.query(
            `delete from customer_accounts where id = $1`,
            [account]
          )
        ).rejects.toMatchObject({ code: "23001" });
      } finally {
        await testDatabase!.pool.query(
          `delete from workspace_reservations where id = $1`,
          [reservationId]
        );
        await testDatabase!.pool.query(
          `delete from customer_accounts where id = $1`,
          [account]
        );
      }
    });

    test("a repeated deletion keeps the first tombstone instant", async () => {
      const layer = makeRepositoryLayer();
      const account = customerAccountIdSchema.make(uniqueId());

      const tombstoneAt = (deletedAt: string) =>
        Effect.runPromise(
          Effect.gen(function* () {
            const accounts = yield* CustomerAccountRepository;
            yield* accounts.tombstone(
              account,
              Temporal.Instant.from(deletedAt)
            );
          }).pipe(Effect.provide(layer))
        );

      await tombstoneAt("2026-10-17T10:00:00Z");
      await tombstoneAt("2026-10-17T11:00:00Z");

      expect(await readDeletedAt(account)).toBe("2026-10-17T10:00:00Z");
    });
  }
);
