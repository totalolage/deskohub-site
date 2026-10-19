import { testEmailAddress } from "@deskohub/test-email";
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
import { CustomerAccountRepository } from "./customer-account.repository";
import { CustomerAccountLinkRepository } from "./customer-account-link.repository";
import { waitForAccountAdvisoryLockWait } from "./customer-account-lock.test-utils";

const testDatabase = await connectWorkspacePostgresTestDatabase();

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

const insertAuthUser = async (id: string, email: string) => {
  await testDatabase!.pool.query(
    `insert into auth."user" (id, name, email) values ($1, '', $2)`,
    [id, email]
  );
};

const uniqueId = () => crypto.randomUUID();

describe.skipIf(!testDatabase)(
  "CustomerAccountLinkRepository on disposable Postgres",
  () => {
    test("claims idempotently for the same account and rejects a second account", async () => {
      const layer = makeRepositoryLayer();
      const firstAccount = customerAccountIdSchema.make(uniqueId());
      const secondAccount = customerAccountIdSchema.make(uniqueId());
      const dotyposCustomerId = uniqueDotyposId();

      await insertAuthUser(firstAccount, testEmailAddress(`a-${firstAccount}`));
      await insertAuthUser(
        secondAccount,
        testEmailAddress(`b-${secondAccount}`)
      );

      const outcomes = await Effect.runPromise(
        Effect.gen(function* () {
          const links = yield* CustomerAccountLinkRepository;
          const firstClaim = yield* links.claim(
            firstAccount,
            dotyposCustomerId
          );
          const secondClaim = yield* links.claim(
            firstAccount,
            dotyposCustomerId
          );
          const rivalClaim = yield* Effect.result(
            links.claim(secondAccount, dotyposCustomerId)
          );
          return { firstClaim, secondClaim, rivalClaim };
        }).pipe(Effect.provide(layer))
      );

      expect(outcomes.firstClaim).toEqual({
        kind: "linked",
        customerId: dotyposCustomerId,
        created: true,
      });
      expect(outcomes.secondClaim).toEqual({
        kind: "linked",
        customerId: dotyposCustomerId,
        created: false,
      });
      expect(outcomes.rivalClaim._tag).toBe("Success");
      if (outcomes.rivalClaim._tag === "Success") {
        expect(outcomes.rivalClaim.success.kind).toBe("claimed");
      }
    });

    test("converges concurrent claims so exactly one link exists per account", async () => {
      const layer = makeRepositoryLayer();
      const account = customerAccountIdSchema.make(uniqueId());
      const dotyposCustomerId = uniqueDotyposId();
      await insertAuthUser(account, testEmailAddress(`c-${account}`));

      const claims = await Effect.runPromise(
        Effect.gen(function* () {
          const links = yield* CustomerAccountLinkRepository;
          const [first, second] = yield* Effect.all([
            links.claim(account, dotyposCustomerId),
            links.claim(account, dotyposCustomerId),
          ]);
          return [first, second];
        }).pipe(Effect.provide(layer))
      );

      for (const claim of claims) {
        expect(claim.kind).toBe("linked");
        if (claim.kind === "linked") {
          expect(claim.customerId).toBe(dotyposCustomerId);
        }
      }

      const rows = await testDatabase!.pool.query(
        `select dotypos_customer_id from customer_account_links where customer_account_id = $1`,
        [account]
      );
      expect(rows.rows).toHaveLength(1);
    });

    test("exposes the activity state and stops it once the auth account row is gone", async () => {
      const layer = makeRepositoryLayer();
      const account = customerAccountIdSchema.make(uniqueId());
      await insertAuthUser(account, testEmailAddress(`d-${account}`));
      await linkRow(account, uniqueDotyposId());

      const marker = new Date("2026-09-02T10:00:00.000Z");
      const states = await Effect.runPromise(
        Effect.gen(function* () {
          const links = yield* CustomerAccountLinkRepository;
          const initial = yield* links.findActivityState(account);
          yield* links.markDeletionRequested(account, marker);
          const marked = yield* links.findActivityState(account);
          return { initial, marked };
        }).pipe(Effect.provide(layer))
      );

      expect(states.initial).toEqual({
        kind: "active",
        deletionRequestedAt: null,
      });
      expect(states.marked.kind).toBe("active");
      if (states.marked.kind === "active") {
        expect(states.marked.deletionRequestedAt?.toISOString()).toBe(
          marker.toISOString()
        );
      }

      await testDatabase!.pool.query(`delete from auth."user" where id = $1`, [
        account,
      ]);

      const afterDeletion = await Effect.runPromise(
        Effect.gen(function* () {
          const links = yield* CustomerAccountLinkRepository;
          return yield* links.findActivityState(account);
        }).pipe(Effect.provide(layer))
      );
      expect(afterDeletion).toEqual({ kind: "missing" });

      const link = await testDatabase!.pool.query(
        `select * from customer_account_links where customer_account_id = $1`,
        [account]
      );
      expect(link.rows).toHaveLength(0);
    });

    test("serializes resolution against an outer account lock holder", async () => {
      const layer = makeRepositoryLayer();
      const account = customerAccountIdSchema.make(uniqueId());
      await insertAuthUser(account, testEmailAddress(`e-${account}`));

      let innerCompleted = false;

      await Effect.runPromise(
        Effect.gen(function* () {
          const links = yield* CustomerAccountLinkRepository;
          const held = yield* Deferred.make<void>();
          const gate = yield* Deferred.make<never, void>();

          const outer = yield* Effect.forkChild(
            withPostgresAdvisoryLock(
              testDatabase!.pool,
              ["customer-account", account],
              Deferred.succeed(held, undefined).pipe(
                Effect.andThen(Deferred.await(gate)),
                Effect.orDie
              )
            ).pipe(Effect.orDie)
          );
          yield* Deferred.await(held);

          const inner = yield* Effect.forkChild(
            links
              .withAccountLock(
                account,
                Effect.sync(() => {
                  innerCompleted = true;
                })
              )
              .pipe(Effect.orDie)
          );

          yield* Effect.promise(() =>
            waitForAccountAdvisoryLockWait(testDatabase!.pool, account)
          );
          expect(innerCompleted).toBe(false);

          yield* Deferred.succeed(gate, undefined);
          yield* Fiber.join(outer);
          yield* Fiber.join(inner);

          expect(innerCompleted).toBe(true);
        }).pipe(Effect.provide(layer))
      );
    });

    test("records account creation only for the claim that inserts the link and keeps it past deletion", async () => {
      const account = customerAccountIdSchema.make(uniqueId());
      const dotyposCustomerId = uniqueDotyposId();
      await insertAuthUser(account, testEmailAddress(`e-${account}`));

      await Effect.runPromise(
        Effect.gen(function* () {
          const links = yield* CustomerAccountLinkRepository;
          yield* links.claim(account, dotyposCustomerId);
          yield* links.claim(account, dotyposCustomerId);
        }).pipe(Effect.provide(makeRepositoryLayer()))
      );

      const recorded = await accountCreatedEvents(account);
      expect(recorded).toEqual([
        {
          dotypos_customer_id: dotyposCustomerId,
          occurred_at: await accountCreatedAt(account),
        },
      ]);

      await Effect.runPromise(
        Effect.gen(function* () {
          const accounts = yield* CustomerAccountRepository;
          yield* accounts.tombstone(account, Temporal.Now.instant());
        }).pipe(
          Effect.provide(
            CustomerAccountRepository.Default.pipe(
              Layer.provide(
                Layer.succeed(
                  WorkspaceDatabase,
                  WorkspaceDatabase.of({ db: testDatabase!.db })
                )
              )
            )
          )
        )
      );
      await testDatabase!.pool.query(`delete from auth."user" where id = $1`, [
        account,
      ]);

      expect(await accountCreatedEvents(account)).toEqual(recorded);
    });
  }
);

async function accountCreatedEvents(accountId: string) {
  const { rows } = await testDatabase!.pool.query<{
    dotypos_customer_id: string;
    occurred_at: string;
  }>(
    `select dotypos_customer_id, occurred_at from customer_events
      where kind = 'account-created' and customer_account_id = $1`,
    [accountId]
  );
  return rows;
}

async function accountCreatedAt(accountId: string) {
  const { rows } = await testDatabase!.pool.query<{ created_at: string }>(
    "select created_at from customer_accounts where id = $1",
    [accountId]
  );
  return rows[0]?.created_at;
}

function uniqueDotyposId() {
  return `${Math.floor(Math.random() * 900000) + 100000}${Math.floor(
    Math.random() * 900
  )}`;
}

async function linkRow(accountId: string, dotyposCustomerId: string) {
  await testDatabase!.pool.query(
    `insert into customer_account_links (customer_account_id, dotypos_customer_id) values ($1, $2)`,
    [accountId, dotyposCustomerId]
  );
}
