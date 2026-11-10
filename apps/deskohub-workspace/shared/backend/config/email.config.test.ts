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
import { FetchHttpClient } from "effect/unstable/http";

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
  makeWorkspaceEmailLayer,
  workspaceEmailProviders,
  workspaceEmailSystemIdentity,
  workspaceMarketingCategories,
} = await import("./email.config");
const { campaignEmailKind } = await import(
  "@/features/email-campaigns/campaign-email-kind"
);
const { makeRecordingWorkspaceDatabase } = await import(
  "@/shared/testing/workspace-recording-database.test-utils"
);

/** Records the statements of the PostHog delivery tracking. */
let database = await makeRecordingWorkspaceDatabase();

beforeEach(async () => {
  database = await makeRecordingWorkspaceDatabase();
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

/**
 * Runs an effect on the Workspace email layer with `EMAIL_API_KEY` set or
 * not, plus any other `config`; `fetch` answers PostHog's requests.
 */
const runWorkspaceEmail = <A, E>(
  effect: Effect.Effect<A, E, EmailServiceTag>,
  apiKey: string | undefined,
  postHog: {
    readonly config?: Readonly<Record<string, string>>;
    readonly fetch?: typeof globalThis.fetch;
  } = {}
) => {
  const logMessages: unknown[] = [];
  return Effect.runPromise(
    effect.pipe(
      Effect.provide(makeWorkspaceEmailLayer(database.layer)),
      Effect.provide(
        Logger.layer([
          Logger.make((options) => {
            logMessages.push(options.message);
          }),
        ])
      ),
      Effect.provideService(
        ConfigProvider.ConfigProvider,
        ConfigProvider.fromUnknown({
          ...postHog.config,
          ...(apiKey !== undefined && { EMAIL_API_KEY: apiKey }),
        })
      ),
      Effect.provideService(
        FetchHttpClient.Fetch,
        postHog.fetch ??
          (() => Promise.reject(new Error("PostHog is not expected here")))
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

  describe("with PostHog configured", () => {
    const config = {
      POSTHOG_EMAIL_SECRET_KEY: "phs_test",
      POSTHOG_API_HOST: "https://eu.i.posthog.com",
    };
    /** PostHog's answer: an accepted message id, or a refusal code. */
    type PostHogAnswer =
      | { readonly message_id: string }
      | { readonly type: string; readonly code: string };
    /** The parts of a PostHog send request these tests read. */
    interface PostHogRequest {
      readonly url: string;
      readonly distinctId: string | undefined;
    }
    const postHogAnswering = (status: number, answer: PostHogAnswer) => {
      const requests: PostHogRequest[] = [];
      const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const sent: { readonly distinct_id?: string } = JSON.parse(
          await new Response(init?.body).text()
        );
        requests.push({
          url: input instanceof Request ? input.url : String(input),
          distinctId: sent.distinct_id,
        });
        return Response.json(answer, { status });
      }) as typeof globalThis.fetch;
      return { fetch, requests };
    };
    const postHogDeliveryInserts = () =>
      database.statements.filter(({ sql }) =>
        /insert into "posthog_email_deliveries"/i.test(sql)
      );
    const campaignMessage = {
      ...message(realRecipient),
      tags: [campaignEmailKind.category],
    };

    test("sends campaign mail through PostHog's app host under the system identity", async () => {
      const posthog = postHogAnswering(202, {
        message_id: "0197a5e1-1b52-7c4e-9f5a-2d3b4c5d6e7f",
      });
      const result = await runWorkspaceEmail(send(campaignMessage), "re_test", {
        config,
        fetch: posthog.fetch,
      });

      expect(result._tag).toBe("Success");
      if (result._tag === "Success") {
        expect(result.success.provider).toBe("posthog");
      }
      expect(posthog.requests).toHaveLength(1);
      expect(new URL(posthog.requests[0]?.url ?? "").origin).toBe(
        "https://eu.posthog.com"
      );
      expect(posthog.requests[0]?.distinctId).toBe(
        workspaceEmailSystemIdentity
      );
      expect(resendSend).not.toHaveBeenCalled();
      expect(postHogDeliveryInserts()).toHaveLength(1);
    });

    test("falls back to Resend when PostHog refuses to send", async () => {
      const posthog = postHogAnswering(401, {
        type: "authentication_error",
        code: "authentication_failed",
      });
      const result = await runWorkspaceEmail(send(campaignMessage), "re_test", {
        config,
        fetch: posthog.fetch,
      });

      expect(posthog.requests).toHaveLength(1);
      expect(result._tag).toBe("Success");
      if (result._tag === "Success") {
        expect(result.success.provider).toBe("resend");
      }
      expect(resendSend).toHaveBeenCalledTimes(1);
      expect(postHogDeliveryInserts()).toEqual([]);
    });

    test("keeps campaign mail PostHog may still send off Resend", async () => {
      const posthog = postHogAnswering(409, {
        type: "conflict",
        code: "idempotency_key_in_flight",
      });
      const result = await runWorkspaceEmail(
        send({ ...campaignMessage, idempotencyKey: "campaign-batch-1:0" }),
        "re_test",
        { config, fetch: posthog.fetch }
      );

      expect(result._tag).toBe("Failure");
      if (result._tag === "Failure") {
        expect(result.failure).toMatchObject({
          _tag: "NetworkError",
          failureKind: "unknown-outcome",
        });
      }
      expect(posthog.requests.length).toBeGreaterThan(0);
      expect(resendSend).not.toHaveBeenCalled();
    });

    test("never sends transactional mail through PostHog", async () => {
      const posthog = postHogAnswering(202, {
        message_id: "0197a5e1-1b52-7c4e-9f5a-2d3b4c5d6e7f",
      });
      const result = await runWorkspaceEmail(
        send(message(realRecipient)),
        "re_test",
        { config, fetch: posthog.fetch }
      );

      expect(result._tag).toBe("Success");
      if (result._tag === "Success") {
        expect(result.success.provider).toBe("resend");
      }
      expect(posthog.requests).toHaveLength(0);
    });
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
