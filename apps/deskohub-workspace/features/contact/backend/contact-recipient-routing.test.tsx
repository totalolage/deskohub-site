import "@/shared/testing/workspace-test-env";

import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { resendSimulatorAddress, testEmailAddress } from "@deskohub/test-email";
import { ConfigProvider, Effect, Layer, Logger } from "effect";
import * as envModule from "@/env";
import { m } from "@/features/i18n";
import { WorkspaceEmailLayer } from "@/shared/backend/config/email.config";
import { workspaceSiteConstants } from "@/shared/utils";

type ResendPayload = {
  readonly to?: readonly string[];
  readonly subject?: string;
};

const resendPayloads: ResendPayload[] = [];

mock.module("resend", () => ({
  Resend: class {
    emails = {
      send: async (payload: ResendPayload) => {
        resendPayloads.push(payload);
        return { data: { id: `resend-${resendPayloads.length}` } };
      },
    };
    domains = { list: async () => ({ data: [] }) };
  },
}));

// The workspace env object is read once at import; route VERCEL_ENV through a
// switchable override so one file covers Preview and Production.
let vercelEnv: string | undefined;
mock.module("@/env", () => ({
  ...envModule,
  env: new Proxy(envModule.env, {
    get: (target, key) =>
      key === "VERCEL_ENV" && vercelEnv !== undefined
        ? vercelEnv
        : Reflect.get(target, key),
  }),
}));

const { ContactService } = await import("./contact.service");

afterAll(() => {
  vercelEnv = undefined;
});

beforeEach(() => {
  resendPayloads.length = 0;
});

const consoleRecipients = (records: unknown[][]) =>
  records
    .filter(([message]) => message === "Console Email Provider - Sending Email")
    .map(([, facts]) => (facts as { readonly to: readonly string[] }).to);

const submit = (email: string) => {
  const consoleLogs: unknown[][] = [];
  return Effect.gen(function* () {
    const service = yield* ContactService;
    return yield* service.submit(
      {
        name: "Ada Lovelace",
        email,
        phone: "+420 123 456 789",
        message: "Please help with a workspace reservation.",
      },
      "en-US"
    );
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        ContactService.Default.pipe(Layer.provide(WorkspaceEmailLayer)),
        Logger.layer([
          Logger.make((options) => {
            consoleLogs.push([...options.message]);
          }),
        ])
      )
    ),
    Effect.provideService(
      ConfigProvider.ConfigProvider,
      ConfigProvider.fromUnknown({ EMAIL_API_KEY: "re_test" })
    ),
    Effect.runPromise,
    (promise) => promise.then(() => consoleRecipients(consoleLogs))
  );
};

describe.each([
  { environment: "development", subjectTag: "[TESTING] " },
  { environment: "preview", subjectTag: "[TESTING] " },
  { environment: "production", subjectTag: "" },
])(
  "contact staff notification on $environment",
  ({ environment, subjectTag }) => {
    beforeEach(() => {
      vercelEnv = environment;
    });

    test("a real submitter reaches the real mailbox through Resend", async () => {
      // Resend's simulator is a real destination, not a test recipient.
      const submitter = resendSimulatorAddress("delivered", "ada");
      const consoleSends = await submit(submitter);

      expect(resendPayloads.map((payload) => payload.to)).toEqual([
        [workspaceSiteConstants.contact.infoEmail],
        [submitter],
      ]);
      // Only Production staff copies are untagged.
      expect(resendPayloads[0]?.subject).toBe(
        `${subjectTag}${m.contactEmailBusinessSubject(
          { name: "Ada Lovelace" },
          { locale: "cs-CZ" }
        )}`
      );
      expect(consoleSends).toEqual([]);
    });

    test("a synthetic submitter reaches only the synthetic mailbox through Console", async () => {
      const submitter = testEmailAddress("workspace-e2e-contact-1");
      const consoleSends = await submit(submitter);

      expect(resendPayloads).toEqual([]);
      expect(consoleSends).toEqual([
        [testEmailAddress("workspace-internal")],
        [submitter],
      ]);
    });
  }
);
