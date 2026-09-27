import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import {
  WorkspaceDatabaseAdvisoryLock,
  withPostgresAdvisoryLock,
} from "@/db/postgres-advisory-lock";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import {
  type CustomerAccountAccessError,
  customerAccountIdSchema,
} from "../customer-account";
import { CustomerAccountLinkRepository } from "./customer-account-link.repository";
import {
  type CustomerAccountSession,
  CustomerAuthentication,
} from "./customer-authentication.service";
import {
  CustomerCommunicationPreferenceRepository,
  lookupMagicLinkDeliveryLocale,
  seedAccountCommunicationPreference,
} from "./customer-communication-preference.repository";

const testDatabase = await connectWorkspacePostgresTestDatabase();

/**
 * The under-lock session recheck sees this mutable holder, so each test
 * points the authoritative session at the account it saves for.
 */
let currentTestSession: CustomerAccountSession | null = null;

const makeRepositoryLayer = () => {
  const testDatabaseLayer = Layer.succeed(
    WorkspaceDatabase,
    WorkspaceDatabase.of({ db: testDatabase!.db })
  );

  // The link repository must see the disposable test database and the test
  // advisory-lock pool too: `CustomerAccountLinkRepository.Live` would drag
  // in the application `WorkspaceDatabase.Default`/lock defaults instead.
  const testLinkRepository = CustomerAccountLinkRepository.Default.pipe(
    Layer.provide(
      Layer.mergeAll(
        testDatabaseLayer,
        WorkspaceDatabaseAdvisoryLock.makeLayer(testDatabase!.pool)
      )
    )
  );

  const testAuthenticationLayer = Layer.succeed(
    CustomerAuthentication,
    CustomerAuthentication.of({
      currentUser: Effect.suspend(
        (): Effect.Effect<CustomerAccountSession | null, never> =>
          Effect.succeed(currentTestSession)
      ),
    })
  );

  const setSessionAccount = (accountId: string) => {
    currentTestSession = {
      accountId: customerAccountIdSchema.make(accountId),
      email: `pref-${accountId}@deskohub.test`,
      deletionRequested: false,
    };
  };

  return {
    layer: CustomerCommunicationPreferenceRepository.Default.pipe(
      Layer.provide(
        Layer.mergeAll(
          testDatabaseLayer,
          testLinkRepository,
          testAuthenticationLayer
        )
      )
    ),
    setSessionAccount,
  };
};

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
      const { layer, setSessionAccount } = makeRepositoryLayer();
      const account = customerAccountIdSchema.make(uniqueId());
      await insertAuthUser(account, `pref-${account}@deskohub.test`);
      setSessionAccount(account);

      const outcomes = await Effect.runPromise(
        Effect.gen(function* () {
          const preferences = yield* CustomerCommunicationPreferenceRepository;
          const missing = yield* Effect.result(preferences.load(account));
          yield* preferences.save(account, "cs-CZ");
          const saved = yield* preferences.load(account);
          yield* preferences.save(account, "en-US");
          const resaved = yield* preferences.load(account);
          return { missing, saved, resaved };
        }).pipe(Effect.provide(layer))
      );

      expect(outcomes.missing._tag).toBe("Failure");
      if (outcomes.missing._tag === "Failure") {
        expect(
          (outcomes.missing.failure as { readonly code?: string }).code
        ).toBe("account-communication-preference.missing");
      }
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
      const { layer, setSessionAccount } = makeRepositoryLayer();
      const firstAccount = customerAccountIdSchema.make(uniqueId());
      const secondAccount = customerAccountIdSchema.make(uniqueId());
      await insertAuthUser(
        firstAccount,
        `pref-a-${firstAccount}@deskohub.test`
      );
      setSessionAccount(firstAccount);
      await insertAuthUser(
        secondAccount,
        `pref-b-${secondAccount}@deskohub.test`
      );

      const outcomes = await Effect.runPromise(
        Effect.gen(function* () {
          const preferences = yield* CustomerCommunicationPreferenceRepository;
          yield* preferences.save(firstAccount, "cs-CZ");
          const secondView = yield* Effect.result(
            preferences.load(secondAccount)
          );
          return secondView;
        }).pipe(Effect.provide(layer))
      );

      expect(outcomes._tag).toBe("Failure");
      if (outcomes._tag === "Failure") {
        expect((outcomes.failure as { readonly code?: string }).code).toBe(
          "account-communication-preference.missing"
        );
      }
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
      const { layer, setSessionAccount } = makeRepositoryLayer();
      const account = customerAccountIdSchema.make(uniqueId());
      await insertAuthUser(account, `pref-d-${account}@deskohub.test`);
      setSessionAccount(account);

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

    test("rejects reads and saves for a deletion-marked account under the real lock", async () => {
      const { layer, setSessionAccount } = makeRepositoryLayer();
      const account = customerAccountIdSchema.make(uniqueId());
      await insertAuthUser(account, `pref-f-${account}@deskohub.test`);
      setSessionAccount(account);
      await testDatabase!.pool.query(
        `update auth."user" set deletion_requested_at = $2 where id = $1`,
        [account, new Date("2026-09-01T00:00:00.000Z")]
      );

      const outcomes = await Effect.runPromise(
        Effect.gen(function* () {
          const preferences = yield* CustomerCommunicationPreferenceRepository;
          const read = yield* Effect.result(preferences.load(account));
          const write = yield* Effect.result(
            preferences.save(account, "cs-CZ")
          );
          return { read, write };
        }).pipe(Effect.provide(layer))
      );

      expect(outcomes.read._tag).toBe("Failure");
      if (outcomes.read._tag === "Failure") {
        const failure = outcomes.read.failure as CustomerAccountAccessError;
        expect(failure.reason).toBe("link-required");
        expect(failure.linkReason).toBe("deletion-requested");
      }
      expect(outcomes.write._tag).toBe("Failure");

      const rows = await testDatabase!.pool.query(
        `select locale from customer_communication_preferences where customer_account_id = $1`,
        [account]
      );
      expect(rows.rows).toHaveLength(0);
    });

    test("seed and lookup helpers resolve the magic-link delivery locale", async () => {
      const dbLayer = Layer.succeed(
        WorkspaceDatabase,
        WorkspaceDatabase.of({ db: testDatabase!.db })
      );
      const verifiedEmail = `lookup-${crypto.randomUUID()}@deskohub.test`;
      const unverifiedEmail = `unverified-${crypto.randomUUID()}@deskohub.test`;
      const seedAccount = customerAccountIdSchema.make(uniqueId());
      await insertAuthUser(seedAccount, verifiedEmail);
      await testDatabase!.pool.query(
        `update auth."user" set email_verified = true where id = $1`,
        [seedAccount]
      );
      await insertAuthUser(
        customerAccountIdSchema.make(uniqueId()),
        unverifiedEmail
      );

      const outcomes = await Effect.runPromise(
        Effect.gen(function* () {
          const beforeAccount =
            yield* lookupMagicLinkDeliveryLocale(verifiedEmail);
          yield* seedAccountCommunicationPreference(seedAccount, "cs-CZ");
          const seeded = yield* lookupMagicLinkDeliveryLocale(verifiedEmail);
          // Re-seeding never overwrites the saved preference.
          yield* seedAccountCommunicationPreference(seedAccount, "en-US");
          const afterReseed =
            yield* lookupMagicLinkDeliveryLocale(verifiedEmail);
          const unverified =
            yield* lookupMagicLinkDeliveryLocale(unverifiedEmail);
          const unknown = yield* lookupMagicLinkDeliveryLocale(
            `nobody-${crypto.randomUUID()}@deskohub.test`
          );
          return {
            beforeAccount,
            seeded,
            afterReseed,
            unverified,
            unknown,
          };
        }).pipe(Effect.provide(dbLayer))
      );

      expect(outcomes.beforeAccount).toEqual({
        kind: "account-locale-missing",
      });
      expect(outcomes.seeded).toEqual({ kind: "account", locale: "cs-CZ" });
      expect(outcomes.afterReseed).toEqual({
        kind: "account",
        locale: "cs-CZ",
      });
      expect(outcomes.unverified).toEqual({ kind: "unverified-email" });
      expect(outcomes.unknown).toEqual({ kind: "pre-account" });
    });

    test("serializes saves against an outer account lock holder", async () => {
      const { Fiber } = await import("effect");
      const { Deferred } = await import("effect");
      const { layer, setSessionAccount } = makeRepositoryLayer();
      const account = customerAccountIdSchema.make(uniqueId());
      await insertAuthUser(account, `pref-e-${account}@deskohub.test`);
      setSessionAccount(account);

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
