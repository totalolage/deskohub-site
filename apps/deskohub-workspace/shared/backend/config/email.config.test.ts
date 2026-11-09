import "@/shared/testing/workspace-test-environment";

import { beforeEach, describe, expect, mock, test } from "bun:test";
import {
  type EmailBatchResult,
  type EmailMessage,
  type EmailProvider,
  EmailServiceTag,
  staffEmailSubject,
} from "@deskohub/email";
import { makeEmailProviderFake } from "@deskohub/email/testing";
import { resendSimulatorAddress, testEmailAddress } from "@deskohub/test-email";
import { ConfigProvider, Effect, Logger } from "effect";

type SendImplementation = (payload?: {
  readonly subject?: string;
}) => Promise<{ readonly data: { id: string } }>;
type BatchSendImplementation = (
  payload?: readonly unknown[],
  options?: { readonly idempotencyKey?: string }
) => Promise<{ readonly data: { readonly data: readonly { id: string }[] } }>;

let resendSend = mock<SendImplementation>(async () => ({
  data: { id: "resend-id" },
}));
let resendBatchSend = mock<BatchSendImplementation>(async (payload = []) => ({
  data: {
    data: payload.map((_, index) => ({ id: `resend-batch-${index}` })),
  },
}));

mock.module("server-only", () => ({}));
mock.module("resend", () => ({
  Resend: class {
    emails = {
      send: (payload?: { readonly subject?: string }) => resendSend(payload),
    };
    batch = {
      send: (
        payload?: readonly unknown[],
        options?: { idempotencyKey?: string }
      ) => resendBatchSend(payload, options),
    };
  },
}));

const {
  WorkspaceEmailLayer,
  workspaceEmailProviders,
  workspaceMarketingCategories,
} = await import("./email.config");
const { campaignEmailKind } = await import(
  "@/features/email-campaigns/campaign-email"
);

beforeEach(() => {
  resendSend = mock<SendImplementation>(async () => ({
    data: { id: "resend-id" },
  }));
  resendBatchSend = mock<BatchSendImplementation>(async (payload = []) => ({
    data: {
      data: payload.map((_, index) => ({ id: `resend-batch-${index}` })),
    },
  }));
});

const testRecipient = { email: testEmailAddress("ada") };
// Resend's simulator is a real destination, never a test recipient.
const realRecipient = { email: resendSimulatorAddress("delivered", "ada") };

const message = (to: EmailMessage["to"], subject = "Hello"): EmailMessage => ({
  from: { email: testEmailAddress("deskohub") },
  to,
  subject,
  text: "Hello",
});

/** Runs an effect on the Workspace email layer with `EMAIL_API_KEY` set or not. */
const runWorkspaceEmail = <A, E>(
  effect: Effect.Effect<A, E, EmailServiceTag>,
  apiKey: string | undefined
) => {
  const logMessages: unknown[] = [];
  return Effect.runPromise(
    effect.pipe(
      Effect.provide(WorkspaceEmailLayer),
      Effect.provide(
        Logger.layer([
          Logger.make((options) => {
            logMessages.push(options.message);
          }),
        ])
      ),
      Effect.provideService(
        ConfigProvider.ConfigProvider,
        ConfigProvider.fromUnknown(
          apiKey === undefined ? {} : { EMAIL_API_KEY: apiKey }
        )
      ),
      Effect.result
    )
  ).then((result) =>
    Object.assign(result, { logged: JSON.stringify(logMessages) })
  );
};

const send = (sent: EmailMessage) =>
  Effect.gen(function* () {
    const email = yield* EmailServiceTag;
    return yield* email.send(sent);
  });

const sendBatch = (sent: readonly EmailMessage[], idempotencyKey: string) =>
  Effect.gen(function* () {
    const email = yield* EmailServiceTag;
    return yield* email.sendBatch(sent, { idempotencyKey });
  });

const deliveryIdOf = (result: EmailBatchResult | undefined) =>
  result?.status === "failed" ? undefined : result?.id;

describe("WorkspaceEmailLayer", () => {
  test("delivers real-recipient mail through Resend", async () => {
    const result = await runWorkspaceEmail(
      send(message(realRecipient)),
      "re_test"
    );

    expect(result._tag).toBe("Success");
    if (result._tag === "Success") {
      expect(result.success.provider).toBe("resend");
    }
    expect(resendSend).toHaveBeenCalledTimes(1);
  });

  test("routes only real recipients through Resend and restores batch result order", async () => {
    const result = await runWorkspaceEmail(
      sendBatch(
        [
          message(testRecipient, "Console one"),
          message(realRecipient, "Resend one"),
          message(testRecipient, "Console two"),
          message(realRecipient, "Resend two"),
        ],
        "campaign-batch-key"
      ),
      "re_test"
    );

    expect(result._tag).toBe("Success");
    if (result._tag !== "Success") return;
    const results = result.success;
    expect(resendBatchSend).toHaveBeenCalledTimes(1);
    const [payload, options] = resendBatchSend.mock.calls[0] ?? [];
    expect(
      (
        payload as readonly {
          readonly subject?: string;
          readonly to: readonly string[];
        }[]
      ).map((sent) => ({ subject: sent.subject, to: sent.to }))
    ).toEqual([
      { subject: "Resend one", to: [realRecipient.email] },
      { subject: "Resend two", to: [realRecipient.email] },
    ]);
    expect(options).toMatchObject({ idempotencyKey: "campaign-batch-key" });
    expect(results.map((sent) => sent.provider)).toEqual([
      "console",
      "resend",
      "console",
      "resend",
    ]);
    expect(deliveryIdOf(results[0])?.startsWith("console-")).toBe(true);
    expect(deliveryIdOf(results[1])).toBe("resend-batch-0");
    expect(deliveryIdOf(results[2])?.startsWith("console-")).toBe(true);
    expect(deliveryIdOf(results[3])).toBe("resend-batch-1");
  });

  test("routes every batch message through Console without a Resend key", async () => {
    const result = await runWorkspaceEmail(
      sendBatch(
        [
          message(testRecipient, "Console one"),
          message(realRecipient, "Console two"),
        ],
        "campaign-batch-key"
      ),
      undefined
    );

    expect(resendBatchSend).not.toHaveBeenCalled();
    expect(result._tag).toBe("Success");
    if (result._tag === "Success") {
      expect(result.success.map((sent) => sent.provider)).toEqual([
        "console",
        "console",
      ]);
    }
  });

  test("keeps test-recipient mail on Console when a Resend key exists", async () => {
    const result = await runWorkspaceEmail(
      send(message(testRecipient)),
      "re_test"
    );

    expect(result._tag).toBe("Success");
    if (result._tag === "Success") {
      expect(result.success.provider).toBe("console");
    }
    expect(resendSend).not.toHaveBeenCalled();
  });

  test("logs every message through Console without a Resend key", async () => {
    for (const apiKey of [undefined, "", "   "]) {
      for (const to of [realRecipient, [testRecipient, realRecipient]]) {
        const result = await runWorkspaceEmail(send(message(to)), apiKey);

        expect(result._tag).toBe("Success");
        if (result._tag === "Success") {
          expect(result.success.provider).toBe("console");
        }
      }
    }
    expect(resendSend).not.toHaveBeenCalled();
  });

  test("sends campaign mail through Resend while no other marketing provider is composed", async () => {
    const result = await runWorkspaceEmail(
      send({ ...message(realRecipient), tags: [campaignEmailKind.category] }),
      "re_test"
    );

    expect(result._tag).toBe("Success");
    if (result._tag === "Success") {
      expect(result.success.provider).toBe("resend");
    }
  });

  test("keeps the test tag on staff copies outside production on both providers", async () => {
    const subject = staffEmailSubject("New request", { isProduction: false });

    const routedToConsole = await runWorkspaceEmail(
      send(message(realRecipient, subject)),
      undefined
    );
    expect(routedToConsole._tag).toBe("Success");
    expect(routedToConsole.logged).toContain("[TESTING] New request");

    const routedToResend = await runWorkspaceEmail(
      send(message(realRecipient, subject)),
      "re_test"
    );
    expect(routedToResend._tag).toBe("Success");
    expect(resendSend).toHaveBeenCalledTimes(1);
    expect(resendSend.mock.calls[0]?.[0]?.subject).toBe(
      "[TESTING] New request"
    );
  });
});

describe("workspaceEmailProviders", () => {
  const providerNamed = (name: string): EmailProvider =>
    makeEmailProviderFake({ name }).provider;
  const names = (chain: ReadonlyArray<EmailProvider>) =>
    chain.map((provider) => provider.name);

  test("campaign deliveries are the marketing stream", () => {
    expect(workspaceMarketingCategories.has(campaignEmailKind.category)).toBe(
      true
    );
  });

  test("transactional mail only ever goes through Resend; marketing tries PostHog first", () => {
    const resend = providerNamed("resend");
    const posthog = providerNamed("posthog");

    const withPostHog = workspaceEmailProviders({ resend, posthog });
    expect(names(withPostHog.transactional)).toEqual(["resend"]);
    expect(names(withPostHog.marketing)).toEqual(["posthog", "resend"]);

    const resendOnly = workspaceEmailProviders({ resend });
    expect(names(resendOnly.transactional)).toEqual(["resend"]);
    expect(names(resendOnly.marketing)).toEqual(["resend"]);
  });

  test("without Resend every chain is empty, so every message goes to Console", () => {
    const chains = workspaceEmailProviders({
      resend: undefined,
      posthog: providerNamed("posthog"),
    });

    expect(chains.transactional).toEqual([]);
    expect(chains.marketing).toEqual([]);
  });
});
