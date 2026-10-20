import "@/shared/testing/workspace-test-env";

import { describe, expect, mock, test } from "bun:test";
import { resendSimulatorAddress } from "@deskohub/test-email";
import { Layer } from "effect";
import type { Locale } from "@/features/i18n";
import { connectWorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";

const afterCallbacks: (() => unknown)[] = [];
const resendSends: {
  readonly to: readonly string[];
  readonly subject: string;
  readonly text: string;
}[] = [];
const emitWorkspaceLog = mock(() => undefined);

mock.module("next/server", () => ({
  after: (callback: () => unknown) => {
    afterCallbacks.push(callback);
  },
}));

mock.module("resend", () => ({
  Resend: class {
    emails = {
      send: async (payload: {
        to: string[];
        subject: string;
        text: string;
      }) => {
        resendSends.push({
          to: payload.to,
          subject: payload.subject,
          text: payload.text,
        });
        return { data: { id: "synthetic-email-id" }, error: null };
      },
    };
  },
}));

mock.module("@/instrumentation", () => ({
  postHogLoggerProvider: {
    forceFlush: () => Promise.resolve(),
    getLogger: () => ({ emit: emitWorkspaceLog }),
  },
}));

// The test environment has no Resend key, so routing would log every send to
// Console; a synthetic key routes these sends to the mocked Resend client.
const { EmailConfigTag } = await import("@deskohub/email/backend/service");
const emailConfig = await import("@/shared/backend/config/email.config");
mock.module("@/shared/backend/config/email.config", () => ({
  ...emailConfig,
  EmailConfigLayer: Layer.succeed(EmailConfigTag, {
    defaultFrom: { email: emailConfig.workspaceDefaultFromAddress },
    apiKey: "re_test",
  }),
}));

const { workspaceSendMagicLink } = await import("./auth-server");

const CS_SUBJECT = "Přihlašovací odkaz do Deskohub Workspace";

const testDatabase = await connectWorkspacePostgresTestDatabase();

// Test-domain recipients always route to Console, so these use Resend
// simulator addresses.
const uniqueEmail = (label: string) =>
  resendSimulatorAddress("delivered", `${label}-${crypto.randomUUID()}`);

const insertVerifiedUser = async (email: string, verified: boolean) => {
  const id = crypto.randomUUID();
  await testDatabase!.pool.query(
    "insert into customer_accounts (id) values ($1) on conflict do nothing",
    [id]
  );
  await testDatabase!.pool.query(
    `insert into auth."user" (id, name, email, email_verified) values ($1, '', $2, $3)`,
    [id, email, verified]
  );
  return id;
};

const savePreference = async (accountId: string, locale: Locale) => {
  await testDatabase!.pool.query(
    `update auth."user" set locale = $2 where id = $1`,
    [accountId, locale]
  );
};

const requestDelivery = async (
  email: string,
  locale: string,
  signInCode?: { readonly code: string }
) => {
  const callbacksBefore = afterCallbacks.length;
  await workspaceSendMagicLink({
    email,
    url: `https://workspace.test/api/auth/magic-link/verify?token=synthetic-${crypto.randomUUID()}`,
    token: `synthetic-${crypto.randomUUID()}`,
    metadata: signInCode ? { locale, signInCode: true } : { locale },
    ...(signInCode && { code: signInCode.code }),
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
      await savePreference(accountId, "cs-CZ");

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

    test("keeps the initiating site locale beside the server's sign-in code decision", async () => {
      const email = uniqueEmail("sign-in-code");

      const queued = await requestDelivery(email, "cs-CZ", { code: "482913" });

      expect(queued).toBe(1);
      const [sent] = resendSends.filter((send) => send.to.includes(email));
      expect(sent?.subject).toBe(CS_SUBJECT);
      expect(sent?.text).toContain("Nebo zadejte tento kód:");
      expect(sent?.text.match(/^[ \t]*\d{6}[ \t]*$/gm)).toEqual(["482913"]);
    });

    test("delivers in the initiating site locale for an account without a preference, without saving it", async () => {
      const email = uniqueEmail("missing-preference");
      const accountId = await insertVerifiedUser(email, true);

      const queued = await requestDelivery(email, "cs-CZ");

      expect(queued).toBe(1);
      expect(sentSubjectsFor(email)).toEqual([CS_SUBJECT]);

      const rows = await testDatabase!.pool.query(
        `select locale from auth."user" where id = $1`,
        [accountId]
      );
      expect(rows.rows).toEqual([{ locale: null }]);
    });

    test("skips delivery for an existing account when the preference read keeps failing", async () => {
      const email = uniqueEmail("read-failure");
      const accountId = await insertVerifiedUser(email, true);
      await savePreference(accountId, "cs-CZ");

      await testDatabase!.pool.query(
        `alter table auth."user" rename column locale to locale_moved`
      );
      try {
        const queued = await requestDelivery(email, "en-US");
        expect(queued).toBe(0);
      } finally {
        await testDatabase!.pool.query(
          `alter table auth."user" rename column locale_moved to locale`
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
