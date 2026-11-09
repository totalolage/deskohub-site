import { DotyposCustomerIdSchema } from "@deskohub/dotypos";
import { testEmailAddress } from "@deskohub/test-email";
import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { Deferred, Effect, Fiber, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import {
  WorkspaceDatabaseAdvisoryLock,
  withPostgresAdvisoryLock,
} from "@/db/postgres-advisory-lock";
import { rejectCustomerEventInserts } from "@/shared/backend/customer-events/customer-event-outbox.test-utils";
import { workspaceFixtures } from "@/shared/testing/workspace-fixtures.test-utils";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import {
  type CustomerAccountId,
  customerAccountIdSchema,
} from "../customer-account";
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
          WorkspaceDatabase.make(testDatabase!.db)
        ),
        WorkspaceDatabaseAdvisoryLock.makeLayer(testDatabase!.pool)
      )
    )
  );

const insertAuthUser = (id: CustomerAccountId, email: string) =>
  Effect.runPromise(
    workspaceFixtures(testDatabase!.db).account("account-link", {
      id,
      email,
      verified: false,
    })
  );

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
            uniqueDotyposId()
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
      expect(await accountDotyposCustomerId(firstAccount)).toBe(
        dotyposCustomerId
      );
    });

    test("converges concurrent claims of one account on its link", async () => {
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

      expect(
        claims.filter((claim) => claim.kind === "linked" && claim.created)
      ).toHaveLength(1);
      expect(await accountDotyposCustomerId(account)).toBe(dotyposCustomerId);
      expect(await accountCreatedEvents(account)).toHaveLength(1);
    });

    test("exposes the activity state and stops it once the auth account row is gone", async () => {
      const layer = makeRepositoryLayer();
      const account = customerAccountIdSchema.make(uniqueId());
      await insertAuthUser(account, testEmailAddress(`d-${account}`));
      await accountColumn(account, uniqueDotyposId());

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
                  WorkspaceDatabase.make(testDatabase!.db)
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

    test("rolls the first account-link claim back with a failed event write", async () => {
      const account = customerAccountIdSchema.make(uniqueId());
      const dotyposCustomerId = uniqueDotyposId();
      await insertAuthUser(account, testEmailAddress(`r-${account}`));
      const cleanup = await rejectCustomerEventInserts(
        testDatabase!.pool,
        `new.dotypos_customer_id = '${dotyposCustomerId}'`
      );
      const result = await Effect.runPromise(
        Effect.gen(function* () {
          const links = yield* CustomerAccountLinkRepository;
          return yield* Effect.result(links.claim(account, dotyposCustomerId));
        }).pipe(Effect.provide(makeRepositoryLayer()))
      ).finally(cleanup);

      expect(result._tag).toBe("Failure");
      expect(await accountDotyposCustomerId(account)).toBeNull();
      expect(await accountCreatedEvents(account)).toEqual([]);

      const retry = await Effect.runPromise(
        Effect.gen(function* () {
          const links = yield* CustomerAccountLinkRepository;
          return yield* links.claim(account, dotyposCustomerId);
        }).pipe(Effect.provide(makeRepositoryLayer()))
      );
      expect(retry).toEqual({
        kind: "linked",
        customerId: dotyposCustomerId,
        created: true,
      });
    });

    test("keeps an account's link without recording it again", async () => {
      const layer = makeRepositoryLayer();
      const account = customerAccountIdSchema.make(uniqueId());
      const linkedCustomer = uniqueDotyposId();
      await insertAuthUser(account, testEmailAddress(`j-${account}`));
      await accountColumn(account, linkedCustomer);

      const outcome = await Effect.runPromise(
        Effect.gen(function* () {
          const links = yield* CustomerAccountLinkRepository;
          return {
            found: yield* links.find(account),
            claims: [
              yield* links.claim(account, linkedCustomer),
              yield* links.claim(account, uniqueDotyposId()),
            ],
          };
        }).pipe(Effect.provide(layer))
      );

      expect(outcome.found).toBe(linkedCustomer);
      for (const claim of outcome.claims) {
        expect(claim).toEqual({
          kind: "linked",
          customerId: linkedCustomer,
          created: false,
        });
      }
      expect(await accountCreatedEvents(account)).toHaveLength(0);
    });

    test("records no account creation when an existing customer first signs in", async () => {
      const account = customerAccountIdSchema.make(uniqueId());
      const customer = uniqueDotyposId();
      // #764 linked the silent login to its customer; its owner then
      // verifies it and completes the profile.
      await Effect.runPromise(
        workspaceFixtures(testDatabase!.db).account("account-link", {
          id: account,
          email: testEmailAddress(`l-${account}`),
          legacy: true,
          linkedCustomer: DotyposCustomerIdSchema.make(customer),
        })
      );

      const claimed = await Effect.runPromise(
        Effect.gen(function* () {
          const links = yield* CustomerAccountLinkRepository;
          return yield* links.claim(account, customer);
        }).pipe(Effect.provide(makeRepositoryLayer()))
      );

      expect(claimed).toEqual({
        kind: "linked",
        customerId: customer,
        created: false,
      });
      expect(await accountCreatedEvents(account)).toEqual([]);
    });

    test("links an unlinked existing customer's account without recording its creation", async () => {
      const account = customerAccountIdSchema.make(uniqueId());
      const customer = uniqueDotyposId();
      // #764 made the silent login but lost the link to a conflict; once the
      // customer is free, its owner signs in and claims it.
      await insertAuthUser(account, testEmailAddress(`u-${account}`));
      await testDatabase!.pool.query(
        `update customer_accounts set legacy = true where id = $1`,
        [account]
      );

      const claimed = await Effect.runPromise(
        Effect.gen(function* () {
          const links = yield* CustomerAccountLinkRepository;
          return yield* links.claim(account, customer);
        }).pipe(Effect.provide(makeRepositoryLayer()))
      );

      expect(claimed).toEqual({
        kind: "linked",
        customerId: customer,
        created: true,
      });
      expect(await accountDotyposCustomerId(account)).toBe(customer);
      expect(await accountCreatedEvents(account)).toEqual([]);
    });

    test("lets exactly one of two accounts racing for a customer link it", async () => {
      const layer = makeRepositoryLayer();
      const first = customerAccountIdSchema.make(uniqueId());
      const second = customerAccountIdSchema.make(uniqueId());
      const dotyposCustomerId = uniqueDotyposId();
      await insertAuthUser(first, testEmailAddress(`k-${first}`));
      await insertAuthUser(second, testEmailAddress(`l-${second}`));

      const claims = await Effect.runPromise(
        Effect.gen(function* () {
          const links = yield* CustomerAccountLinkRepository;
          return yield* Effect.all(
            [
              links.claim(first, dotyposCustomerId),
              links.claim(second, dotyposCustomerId),
            ],
            { concurrency: "unbounded" }
          );
        }).pipe(Effect.provide(layer))
      );

      expect(claims.map((claim) => claim.kind).sort()).toEqual([
        "claimed",
        "linked",
      ]);
      const winner = claims[0]?.kind === "linked" ? first : second;
      const loser = winner === first ? second : first;
      expect(await accountDotyposCustomerId(winner)).toBe(dotyposCustomerId);
      expect(await accountDotyposCustomerId(loser)).toBeNull();
      expect(await accountCreatedEvents(loser)).toHaveLength(0);
    });

    test("frees a deleted account's customer for another account", async () => {
      const layer = makeRepositoryLayer();
      const deleted = customerAccountIdSchema.make(uniqueId());
      const claimant = customerAccountIdSchema.make(uniqueId());
      const dotyposCustomerId = uniqueDotyposId();
      await insertAuthUser(deleted, testEmailAddress(`m-${deleted}`));
      await insertAuthUser(claimant, testEmailAddress(`n-${claimant}`));

      const claim = await Effect.runPromise(
        Effect.gen(function* () {
          const links = yield* CustomerAccountLinkRepository;
          const accounts = yield* CustomerAccountRepository;
          yield* links.claim(deleted, dotyposCustomerId);
          const whileLinked = yield* links.claim(claimant, dotyposCustomerId);
          expect(whileLinked).toEqual({ kind: "claimed" });
          yield* accounts.tombstone(deleted, Temporal.Now.instant());
          return yield* links.claim(claimant, dotyposCustomerId);
        }).pipe(
          Effect.provide(
            Layer.mergeAll(
              layer,
              CustomerAccountRepository.Default.pipe(
                Layer.provide(testDatabase!.layer)
              )
            )
          )
        )
      );

      expect(claim).toEqual({
        kind: "linked",
        customerId: dotyposCustomerId,
        created: true,
      });
      expect(await accountDotyposCustomerId(deleted)).toBeNull();
      expect(await accountDotyposCustomerId(claimant)).toBe(dotyposCustomerId);
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

async function accountDotyposCustomerId(accountId: string) {
  const { rows } = await testDatabase!.pool.query<{
    dotypos_customer_id: string | null;
  }>("select dotypos_customer_id from customer_accounts where id = $1", [
    accountId,
  ]);
  return rows[0]?.dotypos_customer_id;
}

function uniqueDotyposId() {
  return `${Math.floor(Math.random() * 900000) + 100000}${Math.floor(
    Math.random() * 900
  )}`;
}

async function accountColumn(accountId: string, dotyposCustomerId: string) {
  await testDatabase!.pool.query(
    "update customer_accounts set dotypos_customer_id = $2 where id = $1",
    [accountId, dotyposCustomerId]
  );
}
