import { testEmailAddress } from "@deskohub/test-email";
import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { WorkspaceDatabaseAdvisoryLock } from "@/db/postgres-advisory-lock";
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
  captureAccountLocalePreference,
  lookupMagicLinkDeliveryLocale,
  saveAccountLocalePreference,
} from "./customer-locale-preference";

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
      email: testEmailAddress(`pref-${accountId}`),
      deletionRequested: false,
    };
  };

  return {
    layer: Layer.mergeAll(
      testDatabaseLayer,
      testLinkRepository,
      testAuthenticationLayer
    ),
    setSessionAccount,
  };
};

const insertAuthUser = async (id: string, email: string) => {
  await testDatabase!.pool.query(
    "insert into customer_accounts (id) values ($1) on conflict do nothing",
    [id]
  );
  await testDatabase!.pool.query(
    `insert into auth."user" (id, name, email) values ($1, '', $2)`,
    [id, email]
  );
};

const uniqueId = () => crypto.randomUUID();

const savedLocaleOf = async (accountId: string) =>
  (
    await testDatabase!.pool.query<{ locale: string }>(
      `select locale from auth."user" where id = $1`,
      [accountId]
    )
  ).rows[0]?.locale;

describe.skipIf(!testDatabase)(
  "customer locale preference on disposable Postgres",
  () => {
    test("saves the locale on the account and replaces it on a later save", async () => {
      const { layer, setSessionAccount } = makeRepositoryLayer();
      const account = customerAccountIdSchema.make(uniqueId());
      await insertAuthUser(account, testEmailAddress(`pref-${account}`));
      setSessionAccount(account);

      const missing = await savedLocaleOf(account);
      await Effect.runPromise(
        saveAccountLocalePreference(account, "cs-CZ").pipe(
          Effect.provide(layer)
        )
      );
      const saved = await savedLocaleOf(account);
      await Effect.runPromise(
        saveAccountLocalePreference(account, "en-US").pipe(
          Effect.provide(layer)
        )
      );

      expect(missing).toBeNull();
      expect(saved).toBe("cs-CZ");
      expect(await savedLocaleOf(account)).toBe("en-US");
    });

    test("saves only the signed-in account's locale", async () => {
      const { layer, setSessionAccount } = makeRepositoryLayer();
      const firstAccount = customerAccountIdSchema.make(uniqueId());
      const secondAccount = customerAccountIdSchema.make(uniqueId());
      await insertAuthUser(
        firstAccount,
        testEmailAddress(`pref-a-${firstAccount}`)
      );
      setSessionAccount(firstAccount);
      await insertAuthUser(
        secondAccount,
        testEmailAddress(`pref-b-${secondAccount}`)
      );

      await Effect.runPromise(
        saveAccountLocalePreference(firstAccount, "cs-CZ").pipe(
          Effect.provide(layer)
        )
      );

      expect(await savedLocaleOf(firstAccount)).toBe("cs-CZ");
      expect(await savedLocaleOf(secondAccount)).toBeNull();
    });

    test("rejects saves for a deletion-marked account under the real lock", async () => {
      const { layer, setSessionAccount } = makeRepositoryLayer();
      const account = customerAccountIdSchema.make(uniqueId());
      await insertAuthUser(account, testEmailAddress(`pref-f-${account}`));
      setSessionAccount(account);
      await testDatabase!.pool.query(
        `update auth."user" set deletion_requested_at = $2 where id = $1`,
        [account, new Date("2026-09-01T00:00:00.000Z")]
      );

      const write = await Effect.runPromise(
        saveAccountLocalePreference(account, "cs-CZ").pipe(
          Effect.result,
          Effect.provide(layer)
        )
      );

      expect(write._tag).toBe("Failure");
      if (write._tag === "Failure") {
        const failure = write.failure as CustomerAccountAccessError;
        expect(failure.reason).toBe("link-required");
        expect(failure.linkReason).toBe("deletion-requested");
      }
      expect(await savedLocaleOf(account)).toBeNull();
    });

    test("capture fills only a missing locale, and the lookup resolves the magic-link delivery locale", async () => {
      const dbLayer = Layer.succeed(
        WorkspaceDatabase,
        WorkspaceDatabase.of({ db: testDatabase!.db })
      );
      const verifiedEmail = testEmailAddress(`lookup-${crypto.randomUUID()}`);
      const unverifiedEmail = testEmailAddress(
        `unverified-${crypto.randomUUID()}`
      );
      const captureAccount = customerAccountIdSchema.make(uniqueId());
      await insertAuthUser(captureAccount, verifiedEmail);
      await testDatabase!.pool.query(
        `update auth."user" set email_verified = true where id = $1`,
        [captureAccount]
      );
      await insertAuthUser(
        customerAccountIdSchema.make(uniqueId()),
        unverifiedEmail
      );

      const outcomes = await Effect.runPromise(
        Effect.gen(function* () {
          const beforeAccount =
            yield* lookupMagicLinkDeliveryLocale(verifiedEmail);
          yield* captureAccountLocalePreference(captureAccount, "cs-CZ");
          const seeded = yield* lookupMagicLinkDeliveryLocale(verifiedEmail);
          // A later capture never overwrites the saved preference.
          yield* captureAccountLocalePreference(captureAccount, "en-US");
          const afterReseed =
            yield* lookupMagicLinkDeliveryLocale(verifiedEmail);
          const unverified =
            yield* lookupMagicLinkDeliveryLocale(unverifiedEmail);
          const unknown = yield* lookupMagicLinkDeliveryLocale(
            testEmailAddress(`nobody-${crypto.randomUUID()}`)
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
  }
);
