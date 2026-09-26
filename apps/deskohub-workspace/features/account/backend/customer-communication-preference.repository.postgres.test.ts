import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import {
  WorkspaceDatabaseAdvisoryLock,
  withPostgresAdvisoryLock,
} from "@/db/postgres-advisory-lock";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { customerAccountIdSchema } from "../customer-account";
import { CustomerAccountLinkRepository } from "./customer-account-link.repository";
import { CustomerCommunicationPreferenceRepository } from "./customer-communication-preference.repository";

const testDatabase = await connectWorkspacePostgresTestDatabase();

const makeRepositoryLayer = () =>
  CustomerCommunicationPreferenceRepository.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        Layer.succeed(
          WorkspaceDatabase,
          WorkspaceDatabase.of({ db: testDatabase!.db })
        ),
        CustomerAccountLinkRepository.Live,
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
  "CustomerCommunicationPreferenceRepository on disposable Postgres",
  () => {
    test("round-trips a saved preference and upserts on re-save", async () => {
      const layer = makeRepositoryLayer();
      const account = customerAccountIdSchema.make(uniqueId());
      await insertAuthUser(account, `pref-${account}@deskohub.test`);

      const outcomes = await Effect.runPromise(
        Effect.gen(function* () {
          const preferences = yield* CustomerCommunicationPreferenceRepository;
          const missing = yield* preferences.load(account);
          yield* preferences.save(account, "cs-CZ");
          const saved = yield* preferences.load(account);
          yield* preferences.save(account, "en-US");
          const resaved = yield* preferences.load(account);
          return { missing, saved, resaved };
        }).pipe(Effect.provide(layer))
      );

      expect(outcomes.missing).toBeUndefined();
      expect(outcomes.saved).toBe("cs-CZ");
      expect(outcomes.resaved).toBe("en-US");

      const rows = await testDatabase!.pool.query(
        `select locale from customer_communication_preferences where customer_account_id = $1`,
        [account]
      );
      expect(rows.rows).toHaveLength(1);
      expect(rows.rows[0]!.locale).toBe("en-US");
    });

    test("scopes preferences by account so a second account never sees the first row", async () => {
      const layer = makeRepositoryLayer();
      const firstAccount = customerAccountIdSchema.make(uniqueId());
      const secondAccount = customerAccountIdSchema.make(uniqueId());
      await insertAuthUser(
        firstAccount,
        `pref-a-${firstAccount}@deskohub.test`
      );
      await insertAuthUser(
        secondAccount,
        `pref-b-${secondAccount}@deskohub.test`
      );

      const outcomes = await Effect.runPromise(
        Effect.gen(function* () {
          const preferences = yield* CustomerCommunicationPreferenceRepository;
          yield* preferences.save(firstAccount, "cs-CZ");
          const secondView = yield* preferences.load(secondAccount);
          return secondView;
        }).pipe(Effect.provide(layer))
      );

      expect(outcomes).toBeUndefined();
    });

    test("rejects a locale outside the inlang locale list with the CHECK constraint", async () => {
      const account = customerAccountIdSchema.make(uniqueId());
      await insertAuthUser(account, `pref-c-${account}@deskohub.test`);

      const outcome = await Effect.runPromise(
        Effect.tryPromise({
          catch: (cause) => cause,
          try: () =>
            testDatabase!.pool.query(
              `insert into customer_communication_preferences (customer_account_id, locale) values ($1, $2)`,
              [account, "de-DE"]
            ),
        }).pipe(Effect.result)
      );

      expect(outcome._tag).toBe("Failure");
      const rows = await testDatabase!.pool.query(
        `select locale from customer_communication_preferences where customer_account_id = $1`,
        [account]
      );
      expect(rows.rows).toHaveLength(0);
    });

    test("cascades the preference row away with the auth user", async () => {
      const layer = makeRepositoryLayer();
      const account = customerAccountIdSchema.make(uniqueId());
      await insertAuthUser(account, `pref-d-${account}@deskohub.test`);

      await Effect.runPromise(
        Effect.gen(function* () {
          const preferences = yield* CustomerCommunicationPreferenceRepository;
          yield* preferences.save(account, "en-US");
        }).pipe(Effect.provide(layer))
      );

      const before = await testDatabase!.pool.query(
        `select locale from customer_communication_preferences where customer_account_id = $1`,
        [account]
      );
      expect(before.rows).toHaveLength(1);

      await testDatabase!.pool.query(`delete from auth."user" where id = $1`, [
        account,
      ]);

      const after = await testDatabase!.pool.query(
        `select locale from customer_communication_preferences where customer_account_id = $1`,
        [account]
      );
      expect(after.rows).toHaveLength(0);
    });

    test("serializes saves against an outer account lock holder", async () => {
      const { Fiber } = await import("effect");
      const { Deferred } = await import("effect");
      const layer = makeRepositoryLayer();
      const account = customerAccountIdSchema.make(uniqueId());
      await insertAuthUser(account, `pref-e-${account}@deskohub.test`);

      let innerCompleted = false;

      await Effect.runPromise(
        Effect.gen(function* () {
          const preferences = yield* CustomerCommunicationPreferenceRepository;
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
            preferences
              .save(account, "cs-CZ")
              .pipe(Effect.orDie)
              .pipe(
                Effect.tap(() =>
                  Effect.sync(() => {
                    innerCompleted = true;
                  })
                )
              )
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
