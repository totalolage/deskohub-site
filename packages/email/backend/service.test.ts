import { describe, expect, mock, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect, Fiber, Layer } from "effect";
import { TestClock } from "effect/testing";
import {
  EmailDeliveryIdSchema,
  type EmailMessage,
  type EmailProviderConfig,
} from "../types/email.types";
import { makeEmailProviderFake } from "./email-provider.test-utils";
import { NetworkError } from "./network-error";
import {
  EmailConfigTag,
  type EmailProvider,
  EmailProviderTag,
  EmailServiceError,
  EmailServiceTag,
} from "./service";

const config: EmailProviderConfig = {
  provider: "console",
  defaultFrom: { email: testEmailAddress("deskohub"), name: "Deskohub" },
};

const success = {
  id: EmailDeliveryIdSchema.make("email-id"),
  status: "sent" as const,
  provider: "fake",
  timestamp: new Date("2026-06-20T10:00:00Z"),
};

const makeProvider = (
  send?: EmailProvider["send"],
  sendBatch?: EmailProvider["sendBatch"]
): EmailProvider => {
  const fake = makeEmailProviderFake();
  return {
    ...fake.provider,
    send: send ?? fake.provider.send,
    sendBatch: sendBatch ?? fake.provider.sendBatch,
  };
};

const runWithEmail = <A, E>(
  effect: Effect.Effect<A, E, EmailServiceTag>,
  provider: EmailProvider
) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(
        EmailServiceTag.Default.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(EmailProviderTag, provider),
              Layer.succeed(EmailConfigTag, config)
            )
          )
        )
      )
    )
  );

/** Advances a TestClock past the whole retry backoff, so retries run instantly. */
const withInstantRetryBackoff = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const fiber = yield* Effect.forkChild(effect);
    yield* TestClock.adjust("1 minute");
    return yield* Fiber.join(fiber);
  }).pipe(Effect.provide(TestClock.layer()));

const message: EmailMessage = {
  from: undefined as never,
  to: { email: testEmailAddress("ada") },
  subject: "Hello",
  html: "<p>Hello</p>",
};

describe("EmailService", () => {
  test("retries NetworkError and not EmailServiceError", async () => {
    let attempts = 0;
    const retrySend = mock((_message: EmailMessage) =>
      Effect.suspend(() => {
        attempts += 1;
        return attempts === 1
          ? Effect.fail(
              new NetworkError({
                message: "offline",
                cause: new Error("offline"),
              })
            )
          : Effect.succeed(success);
      })
    );

    await runWithEmail(
      Effect.gen(function* () {
        const email = yield* EmailServiceTag;
        return yield* email.send(message);
      }).pipe(withInstantRetryBackoff),
      makeProvider(retrySend)
    );
    expect(attempts).toBe(2);

    const serviceErrorSend = mock((_message: EmailMessage) =>
      Effect.fail(new EmailServiceError("bad request"))
    );
    const result = await runWithEmail(
      Effect.gen(function* () {
        const email = yield* EmailServiceTag;
        return yield* email.send(message).pipe(Effect.result);
      }),
      makeProvider(serviceErrorSend)
    );

    expect(result._tag).toBe("Failure");
    expect(serviceErrorSend).toHaveBeenCalledTimes(1);
  });

  test("keeps one idempotency key across transport retries", async () => {
    const attemptKeys: (string | undefined)[] = [];
    const send = mock((sent: EmailMessage) =>
      Effect.suspend(() => {
        attemptKeys.push(sent.idempotencyKey);
        return attemptKeys.length === 1
          ? Effect.fail(new NetworkError({ message: "timed out" }))
          : Effect.succeed(success);
      })
    );

    await runWithEmail(
      Effect.gen(function* () {
        const email = yield* EmailServiceTag;
        return yield* email.send(message);
      }).pipe(withInstantRetryBackoff),
      makeProvider(send)
    );

    const [first, second] = attemptKeys;
    expect(attemptKeys).toHaveLength(2);
    expect(first).toEqual(expect.any(String));
    expect(second).toBe(first);
  });

  test("sends a batch once and leaves an unknown outcome to the caller", async () => {
    // The first request may have been accepted with its response lost; an
    // internal retry refused with 429 would then hide that it was.
    const sendBatch = mock((_messages: readonly EmailMessage[]) =>
      Effect.fail(new NetworkError({ message: "timed out" }))
    );

    const result = await runWithEmail(
      Effect.gen(function* () {
        const email = yield* EmailServiceTag;
        return yield* email
          .sendBatch([message], { idempotencyKey: "campaign-batch-key" })
          .pipe(Effect.result);
      }).pipe(withInstantRetryBackoff),
      makeProvider(undefined, sendBatch)
    );

    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") {
      expect(result.failure._tag).toBe("NetworkError");
    }
    expect(sendBatch).toHaveBeenCalledTimes(1);
  });

  test("does not retry sendBatch EmailServiceError", async () => {
    const sendBatch = mock((_messages: readonly EmailMessage[]) =>
      Effect.fail(new EmailServiceError("bad batch request"))
    );

    const result = await runWithEmail(
      Effect.gen(function* () {
        const email = yield* EmailServiceTag;
        return yield* email
          .sendBatch([message], { idempotencyKey: "campaign-batch-key" })
          .pipe(Effect.result);
      }),
      makeProvider(undefined, sendBatch)
    );

    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") {
      expect(result.failure._tag).toBe("EmailServiceError");
    }
    expect(sendBatch).toHaveBeenCalledTimes(1);
  });

  test("gives separate deliveries separate idempotency keys", async () => {
    const send = mock((_message: EmailMessage) => Effect.succeed(success));

    await runWithEmail(
      Effect.gen(function* () {
        const email = yield* EmailServiceTag;
        yield* email.send(message);
        yield* email.send(message);
      }),
      makeProvider(send)
    );

    const [first, second] = send.mock.calls.map(
      ([sent]) => sent.idempotencyKey
    );
    expect(first).toEqual(expect.any(String));
    expect(second).toEqual(expect.any(String));
    expect(second).not.toBe(first);
  });

  test("derives reservation delivery keys and prefers an explicit key", async () => {
    const send = mock((_message: EmailMessage) => Effect.succeed(success));

    await runWithEmail(
      Effect.gen(function* () {
        const email = yield* EmailServiceTag;
        for (const category of [
          "workspace-paid-reservation-access",
          "workspace-invoice-customer",
        ]) {
          yield* email.send({
            ...message,
            tags: [category],
            metadata: { workspaceReservationId: "reservation-id" },
          });
        }
        yield* email.send({
          ...message,
          idempotencyKey: "invoice-resend-attempt-2",
          tags: ["workspace-invoice-customer"],
          metadata: { workspaceReservationId: "reservation-id" },
        });
      }),
      makeProvider(send)
    );

    expect(send.mock.calls.map(([sent]) => sent.idempotencyKey)).toEqual([
      "workspace-paid-reservation-access-reservation-id",
      "workspace-invoice-customer-reservation-id",
      "invoice-resend-attempt-2",
    ]);
  });
});

describe("EmailService censorship", () => {
  const captureConsoleLog = (): string[] & { restore: () => void } => {
    const lines: string[] = [];
    // biome-ignore lint/suspicious/noConsole: The test captures log output to assert censorship.
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

  test("success logs carry no recipient, subject, or rendered body", async () => {
    const consoleLines = captureConsoleLog();
    try {
      await runWithEmail(
        Effect.gen(function* () {
          const email = yield* EmailServiceTag;
          return yield* email.send(message);
        }),
        makeProvider()
      );
    } finally {
      consoleLines.restore();
    }

    const logged = consoleLines.join("\n");
    expect(logged).not.toContain(testEmailAddress("ada"));
    expect(logged).not.toContain("Hello");
    expect(logged).not.toContain("<p>Hello</p>");
  });

  test("provider failures log only the error tag and a censored code", async () => {
    const consoleLines = captureConsoleLog();
    const outcome = await runWithEmail(
      Effect.gen(function* () {
        const email = yield* EmailServiceTag;
        return yield* email.send(message).pipe(Effect.result);
      }),
      makeProvider(
        mock((_message: EmailMessage) =>
          Effect.fail(new EmailServiceError("raw provider detail: quota 429"))
        )
      )
    ).finally(consoleLines.restore);

    expect(outcome._tag).toBe("Failure");
    const logged = consoleLines.join("\n");
    expect(logged).toContain("EmailServiceError");
    expect(logged).toContain("email.send.rejected");
    expect(logged).not.toContain("raw provider detail");
    expect(logged).not.toContain("quota");
    expect(logged).not.toContain(testEmailAddress("ada"));
    expect(logged).not.toContain("Hello");
  });
});

describe("EmailServiceTag layers", () => {
  const materialize = <A>(
    layer: typeof EmailServiceTag.Live,
    effect: Effect.Effect<A, unknown, EmailServiceTag>
  ) => Effect.runPromise(effect.pipe(Effect.provide(layer)));

  test("RecipientRouted logs test-recipient mail through Console without a Resend key", async () => {
    const result = await materialize(
      EmailServiceTag.RecipientRouted.pipe(
        Layer.provide(
          Layer.succeed(EmailConfigTag, {
            defaultFrom: { email: testEmailAddress("deskohub") },
          })
        )
      ),
      Effect.gen(function* () {
        const email = yield* EmailServiceTag;
        const sent = yield* email.send({
          from: { email: testEmailAddress("deskohub") },
          to: { email: testEmailAddress("delivered") },
          subject: "Hello",
          text: "Hello",
        });
        return sent;
      })
    );

    expect(result.provider).toBe("console");
  });
});
