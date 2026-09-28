import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import type { Locale } from "@/features/i18n";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import { customerAccountIdSchema } from "../../customer-account";
import { seedAccountCommunicationPreference } from "../customer-communication-preference.repository";

const afterCallbacks: (() => unknown)[] = [];
const resendSends: {
  readonly to: readonly string[];
  readonly subject: string;
}[] = [];

mock.module("next/server", () => ({
  after: (callback: () => unknown) => {
    afterCallbacks.push(callback);
  },
}));

mock.module("resend", () => ({
  Resend: class {
    emails = {
      send: async (payload: { to: string[]; subject: string }) => {
        resendSends.push({ to: payload.to, subject: payload.subject });
        return { data: { id: "synthetic-email-id" }, error: null };
      },
    };
  },
}));

mock.module("@/instrumentation", () => ({
  postHogLoggerProvider: {
    forceFlush: () => Promise.resolve(),
    getLogger: () => ({ emit: () => undefined }),
  },
}));

const { workspaceSendMagicLink } = await import("./auth-server");

const EN_SUBJECT = "Your Deskohub Workspace sign-in link";
const CS_SUBJECT = "Přihlašovací odkaz do Deskohub Workspace";

const testDatabase = await connectWorkspacePostgresTestDatabase();

const uniqueEmail = (label: string) =>
  `${label}-${crypto.randomUUID()}@deskohub.test`;

const insertVerifiedUser = async (email: string, verified: boolean) => {
  const id = crypto.randomUUID();
  await testDatabase!.pool.query(
    `insert into auth."user" (id, name, email, email_verified) values ($1, '', $2, $3)`,
    [id, email, verified]
  );
  return id;
};

const seedPreference = async (accountId: string, locale: Locale) => {
  await Effect.runPromise(
    seedAccountCommunicationPreference(
      customerAccountIdSchema.make(accountId),
      locale
    ).pipe(
      Effect.provide(
        Layer.succeed(
          WorkspaceDatabase,
          WorkspaceDatabase.of({ db: testDatabase!.db })
        )
      )
    )
  );
};

const requestDelivery = async (email: string, locale: string) => {
  const callbacksBefore = afterCallbacks.length;
  await workspaceSendMagicLink({
    email,
    url: `https://workspace.test/api/auth/magic-link/verify?token=synthetic-${crypto.randomUUID()}`,
    token: `synthetic-${crypto.randomUUID()}`,
    metadata: { locale },
  } as Parameters<typeof workspaceSendMagicLink>[0]);
  const queued = afterCallbacks.slice(callbacksBefore);
  for (const callback of queued) await callback();
  return queued.length;
};

const sentSubjectsFor = (email: string) =>
  resendSends
    .filter((send) => send.to.includes(email))
    .map((send) => send.subject);

describe.skipIf(!testDatabase)(
  "workspace magic-link delivery locale orchestration",
  () => {
    test("delivers with the saved preference even when the site locale differs", async () => {
      const email = uniqueEmail("precedence");
      const accountId = await insertVerifiedUser(email, true);
      await seedPreference(accountId, "cs-CZ");

      const queued = await requestDelivery(email, "en-US");

      expect(queued).toBe(1);
      expect(sentSubjectsFor(email)).toEqual([CS_SUBJECT]);
    });

    test("keeps the initiating site locale for a genuine pre-account delivery", async () => {
      const email = uniqueEmail("pre-account");

      const queued = await requestDelivery(email, "cs-CZ");

      expect(queued).toBe(1);
      expect(sentSubjectsFor(email)).toEqual([CS_SUBJECT]);
    });

    test("recovers a missing preference from the initiating locale and never overwrites a saved one", async () => {
      const email = uniqueEmail("recover-missing");
      const accountId = await insertVerifiedUser(email, true);

      const queued = await requestDelivery(email, "cs-CZ");

      expect(queued).toBe(1);
      expect(sentSubjectsFor(email)).toEqual([CS_SUBJECT]);

      const rows = await testDatabase!.pool.query(
        `select locale from customer_communication_preferences where customer_account_id = $1`,
        [accountId]
      );
      expect(rows.rows).toEqual([{ locale: "cs-CZ" }]);

      await testDatabase!.pool.query(
        `update customer_communication_preferences set locale = 'en-US' where customer_account_id = $1`,
        [accountId]
      );
      await requestDelivery(email, "cs-CZ");
      expect(sentSubjectsFor(email)).toEqual([CS_SUBJECT, EN_SUBJECT]);
    });

    test("skips delivery for an existing account when the preference read keeps failing", async () => {
      const email = uniqueEmail("read-failure");
      const accountId = await insertVerifiedUser(email, true);
      await seedPreference(accountId, "cs-CZ");

      await testDatabase!.pool.query(
        `alter table customer_communication_preferences rename to customer_communication_preferences_moved`
      );
      try {
        const queued = await requestDelivery(email, "en-US");
        expect(queued).toBe(0);
      } finally {
        await testDatabase!.pool.query(
          `alter table customer_communication_preferences_moved rename to customer_communication_preferences`
        );
      }

      expect(sentSubjectsFor(email)).toEqual([]);

      const recovered = await requestDelivery(email, "en-US");
      expect(recovered).toBe(1);
      expect(sentSubjectsFor(email)).toEqual([CS_SUBJECT]);
    });

    test("keeps the initiating site locale for an unverified pending signup", async () => {
      const email = uniqueEmail("unverified");
      await insertVerifiedUser(email, false);

      const queued = await requestDelivery(email, "cs-CZ");

      expect(queued).toBe(1);
      expect(sentSubjectsFor(email)).toEqual([CS_SUBJECT]);
    });
  }
);
