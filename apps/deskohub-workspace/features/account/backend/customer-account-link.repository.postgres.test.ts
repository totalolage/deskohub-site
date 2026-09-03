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
import { CustomerAccountLinkRepository } from "./customer-account-link.repository";

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

      await insertAuthUser(firstAccount, `a-${firstAccount}@deskohub.test`);
      await insertAuthUser(secondAccount, `b-${secondAccount}@deskohub.test`);

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
      });
      expect(outcomes.secondClaim).toEqual({
        kind: "linked",
        customerId: dotyposCustomerId,
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
      await insertAuthUser(account, `c-${account}@deskohub.test`);

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

    test("persists and exposes the deletion marker, then removes everything on user deletion", async () => {
      const layer = makeRepositoryLayer();
      const account = customerAccountIdSchema.make(uniqueId());
      await insertAuthUser(account, `d-${account}@deskohub.test`);
      await linkRow(account, uniqueDotyposId());

      const marker = new Date("2026-09-02T10:00:00.000Z");
      const requestedAt = await Effect.runPromise(
        Effect.gen(function* () {
          const links = yield* CustomerAccountLinkRepository;
          expect(yield* links.findDeletionRequestedAt(account)).toBeNull();
          yield* links.markDeletionRequested(account, marker);
          return yield* links.findDeletionRequestedAt(account);
        }).pipe(Effect.provide(layer))
      );

      expect(requestedAt?.toISOString()).toBe(marker.toISOString());

      await testDatabase!.pool.query(`delete from auth."user" where id = $1`, [
        account,
      ]);

      const link = await testDatabase!.pool.query(
        `select * from customer_account_links where customer_account_id = $1`,
        [account]
      );
      expect(link.rows).toHaveLength(0);
    });

    test("serializes resolution against an outer account lock holder", async () => {
      const layer = makeRepositoryLayer();
      const account = customerAccountIdSchema.make(uniqueId());
      await insertAuthUser(account, `e-${account}@deskohub.test`);

      let innerCompleted = false;

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
                  innerCompleted = true;
                })
              )
              .pipe(Effect.orDie)
          );

          yield* Effect.sleep("300 millis");
          expect(innerCompleted).toBe(false);

          yield* Deferred.succeed(gate, undefined);
          yield* Fiber.join(outer);
          yield* Fiber.join(inner);

          expect(innerCompleted).toBe(true);
        }).pipe(Effect.provide(layer))
      );
    });
  }
);

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
