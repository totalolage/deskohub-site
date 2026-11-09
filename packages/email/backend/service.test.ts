import { describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect, Layer, References } from "effect";
import {
  type EmailBatchResult,
  EmailDeliveryIdSchema,
  type EmailMessage,
  type EmailProviderConfig,
} from "../types/email.types";
import {
  type EmailDeliveryObserver as EmailDeliveryObserverShape,
  EmailDeliveryObserver,
  type EmailFallbackEvent,
  type EmailSentEvent,
} from "./email-delivery-observer";
import { makeEmailProviderFake } from "./email-provider.test-utils";
import { type EmailProviderChains, EmailProviders } from "./email-providers";
import { NetworkError } from "./network-error";
import {
  EmailConfigTag,
  type EmailProvider,
  type EmailSendError,
  EmailServiceError,
  EmailServiceTag,
} from "./service";

const config: EmailProviderConfig = {
  provider: "console",
  defaultFrom: { email: testEmailAddress("deskohub"), name: "Deskohub" },
};

const realRecipient = { email: "ada@example.com" };

const message: EmailMessage = {
  from: undefined as never,
  to: realRecipient,
  subject: "Hello",
  html: "<p>Hello</p>",
  tags: ["workspace-contact"],
};

const campaign: EmailMessage = {
  ...message,
  tags: ["email-campaign"],
  metadata: { campaignSendId: "metadata-marker" },
};

const at = new Date("2026-11-09T10:00:00Z");

const providerLevel = (provider: string) =>
  new EmailServiceError("raw quota detail", undefined, provider, {
    failureKind: "provider",
    code: "http-429",
  });

const messageLevel = (provider: string) =>
  new EmailServiceError("raw validation detail", undefined, provider, {
    failureKind: "message",
    code: "http-422",
  });

type Answer = "accept" | EmailSendError;

/**
 * A provider that answers each message on its own, as a per-message API
 * does, and records every call.
 */
const scriptedProvider = (
  name: string,
  answer: (message: EmailMessage) => Answer
) => {
  const sends: EmailMessage[] = [];
  const batches: { messages: EmailMessage[]; idempotencyKey: string }[] = [];
  let nextId = 0;
  const answerOne = (sent: EmailMessage): EmailBatchResult => {
    const outcome = answer(sent);
    return outcome === "accept"
      ? {
          id: EmailDeliveryIdSchema.make(`${name}-${++nextId}`),
          status: "sent",
          provider: name,
          timestamp: at,
        }
      : { status: "failed", provider: name, timestamp: at, error: outcome };
  };
  const provider: EmailProvider = {
    name,
    send: (sent) =>
      Effect.suspend(() => {
        sends.push(sent);
        const result = answerOne(sent);
        return result.status === "failed"
          ? Effect.fail(result.error)
          : Effect.succeed(result);
      }),
    sendBatch: (sent, options) =>
      Effect.sync(() => {
        batches.push({
          messages: [...sent],
          idempotencyKey: options.idempotencyKey,
        });
        return sent.map(answerOne);
      }),
  };
  return { provider, sends, batches };
};

/** A provider whose every request fails as a whole with `error`. */
const failingProvider = (name: string, error: EmailSendError) => {
  const batches: { messages: EmailMessage[]; idempotencyKey: string }[] = [];
  let sends = 0;
  const provider: EmailProvider = {
    name,
    send: () =>
      Effect.suspend(() => {
        sends++;
        return Effect.fail(error);
      }),
    sendBatch: (sent, options) =>
      Effect.suspend(() => {
        batches.push({
          messages: [...sent],
          idempotencyKey: options.idempotencyKey,
        });
        return Effect.fail(error);
      }),
  };
  return { provider, batches, sends: () => sends };
};

const recordingObserver = () => {
  const sent: EmailSentEvent[] = [];
  const fallbacks: EmailFallbackEvent[] = [];
  const observer: EmailDeliveryObserverShape = {
    onSent: (event) => Effect.sync(() => void sent.push(event)),
    onFallback: (event) => Effect.sync(() => void fallbacks.push(event)),
  };
  return { observer, sent, fallbacks };
};

const chains = (
  overrides: Partial<EmailProviderChains>
): EmailProviderChains => ({
  transactional: [],
  marketing: [],
  marketingCategories: new Set(["email-campaign"]),
  ...overrides,
});

const runWithEmail = <A, E>(
  effect: Effect.Effect<A, E, EmailServiceTag>,
  providerChains: EmailProviderChains,
  options: {
    readonly observer?: EmailDeliveryObserverShape;
    readonly layer?: "Default" | "RecipientRouted";
  } = {}
) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(
        EmailServiceTag[options.layer ?? "Default"].pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(EmailProviders, providerChains),
              Layer.succeed(EmailConfigTag, config),
              options.observer
                ? Layer.succeed(EmailDeliveryObserver, options.observer)
                : Layer.empty
            )
          )
        )
      )
    )
  );

const send = (sent: EmailMessage) =>
  Effect.gen(function* () {
    const email = yield* EmailServiceTag;
    return yield* email.send(sent);
  });

const sendBatch = (sent: readonly EmailMessage[], idempotencyKey = "batch-1") =>
  Effect.gen(function* () {
    const email = yield* EmailServiceTag;
    return yield* email.sendBatch(sent, { idempotencyKey });
  });

describe("provider chain selection", () => {
  test("marketing categories use the marketing chain, every other message the transactional one", async () => {
    const transactional = scriptedProvider("transactional", () => "accept");
    const marketing = scriptedProvider("marketing", () => "accept");
    const providerChains = chains({
      transactional: [transactional.provider],
      marketing: [marketing.provider],
    });

    const results = await runWithEmail(
      Effect.all([
        send(message),
        send(campaign),
        send({ ...message, tags: undefined }),
      ]),
      providerChains
    );

    expect(results.map((result) => result.provider)).toEqual([
      "transactional",
      "marketing",
      "transactional",
    ]);
  });

  test("only the first tag is the category", async () => {
    const transactional = scriptedProvider("transactional", () => "accept");
    const marketing = scriptedProvider("marketing", () => "accept");

    const result = await runWithEmail(
      send({ ...message, tags: ["workspace-contact", "email-campaign"] }),
      chains({
        transactional: [transactional.provider],
        marketing: [marketing.provider],
      })
    );

    expect(result.provider).toBe("transactional");
  });
});

describe("single-send failover", () => {
  test("moves to the next provider after a provider-level refusal and reports both events", async () => {
    const first = failingProvider("posthog", providerLevel("posthog"));
    const second = scriptedProvider("resend", () => "accept");
    const recorded = recordingObserver();

    const result = await runWithEmail(
      send({ ...campaign, idempotencyKey: "campaign-key" }),
      chains({ marketing: [first.provider, second.provider] }),
      { observer: recorded.observer }
    );

    expect(result.provider).toBe("resend");
    expect(first.sends()).toBe(1);
    expect(recorded.fallbacks).toEqual([
      {
        stream: "marketing",
        category: "email-campaign",
        failedProvider: "posthog",
        nextProvider: "resend",
        errorKind: "EmailServiceError",
        errorCode: "http-429",
        at: expect.any(Date),
      },
    ]);
    expect(recorded.sent).toEqual([
      {
        provider: "resend",
        deliveryId: result.id,
        stream: "marketing",
        category: "email-campaign",
        tags: ["email-campaign"],
        metadata: { campaignSendId: "metadata-marker" },
        idempotencyKey: "campaign-key",
        at: expect.any(Date),
      },
    ]);
  });

  test("moves on after a provider-level transport failure without retrying it", async () => {
    const first = failingProvider(
      "posthog",
      new NetworkError({ message: "timed out", code: "timeout" })
    );
    const second = scriptedProvider("resend", () => "accept");
    const recorded = recordingObserver();

    const result = await runWithEmail(
      send(campaign),
      chains({ marketing: [first.provider, second.provider] }),
      { observer: recorded.observer }
    );

    expect(result.provider).toBe("resend");
    expect(first.sends()).toBe(1);
    expect(
      recorded.fallbacks.map((event) => [event.errorKind, event.errorCode])
    ).toEqual([["NetworkError", "timeout"]]);
  });

  test.each([
    ["a message-level refusal", messageLevel("posthog")],
    [
      "an outcome a replay must settle",
      new NetworkError({
        message: "key in flight",
        code: "http-409",
        failureKind: "unknown-outcome",
      }),
    ],
  ])("stops the chain after %s", async (_label, error) => {
    const first = failingProvider("posthog", error);
    const second = scriptedProvider("resend", () => "accept");
    const recorded = recordingObserver();

    const outcome = await runWithEmail(
      send(campaign).pipe(Effect.flip),
      chains({ marketing: [first.provider, second.provider] }),
      { observer: recorded.observer }
    );

    expect(outcome).toBe(error);
    expect(second.sends).toHaveLength(0);
    expect(recorded.fallbacks).toEqual([]);
    expect(recorded.sent).toEqual([]);
  });

  test("fails with the last provider's error when every provider fails", async () => {
    const lastError = providerLevel("resend");
    const outcome = await runWithEmail(
      send(campaign).pipe(Effect.flip),
      chains({
        marketing: [
          failingProvider("posthog", providerLevel("posthog")).provider,
          failingProvider("resend", lastError).provider,
        ],
      })
    );

    expect(outcome).toBe(lastError);
  });
});

describe("attachments", () => {
  const withAttachment: EmailMessage = {
    ...campaign,
    attachments: [{ filename: "invoice.pdf", content: "pdf" }],
  };

  test("a provider that cannot carry attachments ends the chain before any request", async () => {
    const noAttachments = makeEmailProviderFake({
      name: "posthog",
      sendsAttachments: false,
    });
    const resend = scriptedProvider("resend", () => "accept");

    const outcome = await runWithEmail(
      send(withAttachment).pipe(Effect.flip),
      chains({ marketing: [noAttachments.provider, resend.provider] })
    );

    expect(outcome).toMatchObject({
      _tag: "EmailServiceError",
      failureKind: "message",
      code: "attachments-unsupported",
    });
    expect(noAttachments.requests()).toEqual([]);
    expect(resend.sends).toHaveLength(0);
  });

  test("never falls back to a provider that cannot carry attachments", async () => {
    const noAttachments = makeEmailProviderFake({
      name: "posthog",
      sendsAttachments: false,
    });

    const outcome = await runWithEmail(
      send(withAttachment).pipe(Effect.flip),
      chains({
        marketing: [
          failingProvider("resend", providerLevel("resend")).provider,
          noAttachments.provider,
        ],
      })
    );

    expect(outcome).toMatchObject({ code: "attachments-unsupported" });
    expect(noAttachments.requests()).toEqual([]);
    expect(noAttachments.mailed()).toEqual([]);
  });
});

describe("batch failover", () => {
  const recipients = ["accepted", "throttled", "invalid", "in-flight"].map(
    (name): EmailMessage => ({
      ...campaign,
      to: { email: `${name}@example.com` },
    })
  );
  const firstAnswer = (sent: EmailMessage): Answer => {
    const [recipient] = [sent.to].flat();
    switch (recipient?.email) {
      case "throttled@example.com":
        return providerLevel("posthog");
      case "invalid@example.com":
        return messageLevel("posthog");
      case "in-flight@example.com":
        return new NetworkError({
          message: "key in flight",
          code: "http-409",
          failureKind: "unknown-outcome",
        });
      default:
        return "accept";
    }
  };

  test("sends only provider-level failures to the next provider and keeps message order", async () => {
    const first = scriptedProvider("posthog", firstAnswer);
    const second = scriptedProvider("resend", () => "accept");
    const recorded = recordingObserver();

    const results = await runWithEmail(
      sendBatch(recipients),
      chains({ marketing: [first.provider, second.provider] }),
      { observer: recorded.observer }
    );

    expect(results.map((result) => [result.status, result.provider])).toEqual([
      ["sent", "posthog"],
      ["sent", "resend"],
      ["failed", "posthog"],
      ["failed", "posthog"],
    ]);
    expect(results[2]).toMatchObject({ error: { code: "http-422" } });
    expect(results[3]).toMatchObject({
      error: { _tag: "NetworkError", failureKind: "unknown-outcome" },
    });
    expect(first.batches.map((batch) => batch.idempotencyKey)).toEqual([
      "batch-1",
    ]);
    expect(second.batches).toHaveLength(1);
    expect(second.batches[0]!.messages.map((sent) => sent.to)).toEqual([
      { email: "throttled@example.com" },
    ]);
    expect(second.batches[0]!.idempotencyKey).toMatch(
      /^batch-1:fallback:[0-9a-f]{16}$/
    );
    expect(recorded.sent.map((event) => event.provider)).toEqual([
      "posthog",
      "resend",
    ]);
    expect(recorded.fallbacks).toEqual([
      {
        stream: "marketing",
        category: "email-campaign",
        failedProvider: "posthog",
        nextProvider: "resend",
        errorKind: "EmailServiceError",
        errorCode: "http-429",
        at: expect.any(Date),
      },
    ]);
  });

  test("derives the same fallback key for the same subset", async () => {
    const keys: string[] = [];
    for (const _attempt of [1, 2]) {
      const second = scriptedProvider("resend", () => "accept");
      await runWithEmail(
        sendBatch(recipients),
        chains({
          marketing: [
            scriptedProvider("posthog", firstAnswer).provider,
            second.provider,
          ],
        })
      );
      keys.push(second.batches[0]!.idempotencyKey);
    }

    expect(keys[0]).toBe(keys[1]);
  });

  test("a whole-batch provider-level failure moves the whole batch on under the caller's key", async () => {
    const second = scriptedProvider("resend", () => "accept");

    const results = await runWithEmail(
      sendBatch(recipients),
      chains({
        marketing: [
          failingProvider("posthog", providerLevel("posthog")).provider,
          second.provider,
        ],
      })
    );

    expect(results.every((result) => result.status === "sent")).toBe(true);
    expect(second.batches.map((batch) => batch.idempotencyKey)).toEqual([
      "batch-1",
    ]);
  });

  test("without a fallback, a whole-batch failure fails the call as before", async () => {
    const error = new NetworkError({ message: "timed out", code: "timeout" });

    const outcome = await runWithEmail(
      sendBatch(recipients).pipe(Effect.flip),
      chains({ marketing: [failingProvider("resend", error).provider] })
    );

    expect(outcome).toBe(error);
  });

  test("after a fallback, a whole-batch failure comes back per message", async () => {
    const error = new NetworkError({ message: "timed out", code: "timeout" });

    const results = await runWithEmail(
      sendBatch(recipients),
      chains({
        marketing: [
          failingProvider("posthog", providerLevel("posthog")).provider,
          failingProvider("resend", error).provider,
        ],
      })
    );

    expect(results).toHaveLength(recipients.length);
    for (const result of results) {
      expect(result).toMatchObject({
        status: "failed",
        provider: "resend",
        error,
      });
    }
  });

  test("an empty batch sends nothing", async () => {
    const provider = scriptedProvider("resend", () => "accept");

    const results = await runWithEmail(
      sendBatch([]),
      chains({ transactional: [provider.provider] })
    );

    expect(results).toEqual([]);
    expect(provider.batches).toEqual([]);
  });
});

describe("delivery observer", () => {
  const captureConsole = (): string[] & { restore: () => void } => {
    const lines: string[] = [];
    // biome-ignore lint/suspicious/noConsole: The test captures log output.
    const original = console.log;
    console.log = (...args: unknown[]) => {
      lines.push(
        args
          .map((arg) =>
            typeof arg === "string" ? arg : (JSON.stringify(arg) ?? "")
          )
          .join(" ")
      );
    };
    const captured = lines as string[] & { restore: () => void };
    captured.restore = () => {
      console.log = original;
    };
    return captured;
  };

  test("EmailDeliveryObserver.none is the default and logs each event's non-personal facts", async () => {
    const consoleLines = captureConsole();
    try {
      await runWithEmail(
        send(campaign).pipe(
          Effect.provideService(References.MinimumLogLevel, "Debug")
        ),
        chains({
          marketing: [
            failingProvider("posthog", providerLevel("posthog")).provider,
            scriptedProvider("resend", () => "accept").provider,
          ],
        })
      );
    } finally {
      consoleLines.restore();
    }

    const logged = consoleLines.join("\n");
    expect(logged).toContain("Email provider fallback observed");
    expect(logged).toContain("Email delivery observed");
    expect(logged).not.toContain("ada@example.com");
    expect(logged).not.toContain("metadata-marker");
  });

  test("observer failures and defects never fail a send, and all() still reaches every observer", async () => {
    const recorded = recordingObserver();
    const failing: EmailDeliveryObserverShape = {
      onSent: () => Effect.die("observer defect"),
      onFallback: () => Effect.die("observer defect"),
    };

    const result = await runWithEmail(
      send(campaign),
      chains({
        marketing: [
          failingProvider("posthog", providerLevel("posthog")).provider,
          scriptedProvider("resend", () => "accept").provider,
        ],
      }),
      {
        observer: EmailDeliveryObserver.all([failing, recorded.observer]),
      }
    );

    expect(result.provider).toBe("resend");
    expect(recorded.sent).toHaveLength(1);
    expect(recorded.fallbacks).toHaveLength(1);
  });
});

describe("Console routing", () => {
  const testRecipientMessage: EmailMessage = {
    ...message,
    to: { email: testEmailAddress("delivered") },
  };

  test("RecipientRouted sends mail for test recipients only through Console", async () => {
    const resend = scriptedProvider("resend", () => "accept");

    const results = await runWithEmail(
      Effect.all([
        send(testRecipientMessage),
        send({
          ...testRecipientMessage,
          cc: realRecipient,
        }),
      ]),
      chains({ transactional: [resend.provider] }),
      { layer: "RecipientRouted" }
    );

    expect(results.map((result) => result.provider)).toEqual([
      "console",
      "resend",
    ]);
  });

  test("RecipientRouted restores batch order across Console and the chain", async () => {
    const resend = scriptedProvider("resend", () => "accept");

    const results = await runWithEmail(
      sendBatch([testRecipientMessage, message, testRecipientMessage]),
      chains({ transactional: [resend.provider] }),
      { layer: "RecipientRouted" }
    );

    expect(results.map((result) => result.provider)).toEqual([
      "console",
      "resend",
      "console",
    ]);
    expect(resend.batches.map((batch) => batch.messages.length)).toEqual([1]);
  });

  test("an empty chain sends every message through Console", async () => {
    const results = await runWithEmail(
      Effect.all([send(message), sendBatch([campaign, message])]),
      chains({}),
      { layer: "RecipientRouted" }
    );

    expect(
      [results[0], ...results[1]].map((result) => result.provider)
    ).toEqual(["console", "console", "console"]);
  });

  test("Default keeps test-recipient mail on the chain", async () => {
    const resend = scriptedProvider("resend", () => "accept");

    const result = await runWithEmail(
      send(testRecipientMessage),
      chains({ transactional: [resend.provider] })
    );

    expect(result.provider).toBe("resend");
  });
});

describe("idempotency keys", () => {
  test("gives separate deliveries separate keys", async () => {
    const provider = scriptedProvider("resend", () => "accept");

    await runWithEmail(
      Effect.all([send(message), send(message)]),
      chains({ transactional: [provider.provider] })
    );

    const [first, second] = provider.sends.map((sent) => sent.idempotencyKey);
    expect(first).toEqual(expect.any(String));
    expect(second).not.toBe(first);
  });

  test("derives reservation delivery keys, prefers an explicit key, and keeps it across providers", async () => {
    const first = failingProvider("posthog", providerLevel("posthog"));
    const provider = scriptedProvider("resend", () => "accept");

    await runWithEmail(
      Effect.all(
        ["workspace-paid-reservation-access", "workspace-invoice-customer"].map(
          (category) =>
            send({
              ...message,
              tags: [category],
              metadata: { workspaceReservationId: "reservation-id" },
            })
        )
      ).pipe(
        Effect.andThen(
          send({
            ...campaign,
            idempotencyKey: "campaign-attempt-2",
          })
        )
      ),
      chains({
        transactional: [provider.provider],
        marketing: [first.provider, provider.provider],
      })
    );

    expect(provider.sends.map((sent) => sent.idempotencyKey)).toEqual([
      "workspace-paid-reservation-access-reservation-id",
      "workspace-invoice-customer-reservation-id",
      "campaign-attempt-2",
    ]);
  });

  test("fills the default sender", async () => {
    const provider = scriptedProvider("resend", () => "accept");

    await runWithEmail(
      send(message),
      chains({ transactional: [provider.provider] })
    );

    expect(provider.sends[0]!.from).toEqual(config.defaultFrom);
  });
});

describe("censorship", () => {
  test("failure logs carry only the error tag, codes, and provider names", async () => {
    const lines: string[] = [];
    // biome-ignore lint/suspicious/noConsole: The test captures log output to assert censorship.
    const original = console.log;
    console.log = (...args: unknown[]) => {
      lines.push(args.map((arg) => JSON.stringify(arg) ?? "").join(" "));
    };
    try {
      await runWithEmail(
        send(campaign).pipe(Effect.result),
        chains({
          marketing: [
            failingProvider("posthog", providerLevel("posthog")).provider,
            failingProvider("resend", messageLevel("resend")).provider,
          ],
        })
      );
    } finally {
      console.log = original;
    }

    const logged = lines.join("\n");
    expect(logged).toContain("EmailServiceError");
    expect(logged).toContain("http-429");
    expect(logged).not.toContain("raw quota detail");
    expect(logged).not.toContain("raw validation detail");
    expect(logged).not.toContain("ada@example.com");
    expect(logged).not.toContain("Hello");
  });
});
