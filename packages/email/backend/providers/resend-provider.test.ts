import { beforeEach, describe, expect, mock, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { ConfigProvider, Effect, Fiber, Layer, Tracer } from "effect";
import { TestClock } from "effect/testing";

const adaAddress = testEmailAddress("ada");
const deskohubAddress = testEmailAddress("deskohub");

type SendResponse =
  | { readonly data: { readonly id: string }; readonly error?: never }
  | {
      readonly data?: never;
      readonly error: {
        readonly message: string;
        readonly statusCode?: number;
      };
    };
type SendImplementation = (
  payload?: unknown,
  options?: { readonly idempotencyKey?: string; readonly signal?: AbortSignal }
) => Promise<SendResponse>;
type BatchSendResponse =
  | {
      readonly data: { readonly data: readonly { readonly id: string }[] };
      readonly error?: never;
    }
  | {
      readonly data?: null;
      readonly error: {
        readonly message: string;
        readonly statusCode?: number;
      };
    };
type BatchSendImplementation = (
  payload?: unknown,
  options?: { readonly idempotencyKey?: string; readonly signal?: AbortSignal }
) => Promise<BatchSendResponse>;
let send = mock<SendImplementation>(async () => ({
  data: { id: "resend-id" },
}));
let batchSend = mock<BatchSendImplementation>(async () => ({
  data: { data: [] },
}));

mock.module("resend", () => ({
  Resend: class {
    emails = { send: send };
    batch = { send: batchSend };
  },
}));

const { ResendEmailProviderLive } = await import("./resend-provider");
const { EmailConfigTag, EmailProviderTag } = await import("../service");

type EmailProviderRequirement = import("../service").EmailProviderTag;

beforeEach(() => {
  send = mock<SendImplementation>(async () => ({
    data: { id: "resend-id" },
  }));
  batchSend = mock<BatchSendImplementation>(async () => ({
    data: { data: [] },
  }));
});

const config = {
  provider: "resend" as const,
  defaultFrom: { email: deskohubAddress },
  apiKey: "api-key",
};

const runProvider = <A, E>(
  effect: Effect.Effect<A, E, EmailProviderRequirement>,
  env: Record<string, string> = {}
) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(
        ResendEmailProviderLive.pipe(
          Layer.provide(Layer.succeed(EmailConfigTag, config))
        )
      ),
      Effect.provideService(
        ConfigProvider.ConfigProvider,
        ConfigProvider.fromUnknown(env)
      )
    )
  );

const message = {
  from: { email: deskohubAddress },
  to: { email: adaAddress },
  subject: "Hello",
  html: "<p>Hello</p>",
};
const batchMessages = [
  message,
  {
    ...message,
    to: { email: testEmailAddress("grace") },
    subject: "Second email",
  },
];

describe("ResendEmailProvider", () => {
  test("maps 4xx and invalid errors to EmailServiceError", async () => {
    for (const error of [
      { statusCode: 400, message: "Bad request" },
      { message: "Invalid API key" },
    ]) {
      send = mock<SendImplementation>(async () => ({ error }));
      const result = await runProvider(
        Effect.gen(function* () {
          const provider = yield* EmailProviderTag;
          return yield* provider.send(message).pipe(Effect.result);
        })
      );

      expect(result._tag).toBe("Failure");
      if (result._tag === "Failure") {
        expect(result.failure._tag).toBe("EmailServiceError");
      }
    }
  });

  test("maps 5xx and network errors to NetworkError", async () => {
    for (const failure of [
      async () => ({ error: { statusCode: 500, message: "Server error" } }),
      async () => {
        throw new Error("network down");
      },
    ]) {
      send = mock<SendImplementation>(failure);
      const result = await runProvider(
        Effect.gen(function* () {
          const provider = yield* EmailProviderTag;
          return yield* provider.send(message).pipe(Effect.result);
        })
      );

      expect(result._tag).toBe("Failure");
      if (result._tag === "Failure") {
        expect(result.failure._tag).toBe("NetworkError");
      }
    }
  });

  for (const [env, single, batch] of [
    [{ VERCEL_ENV: "production" }, "5 seconds", "10 seconds"],
    [{ VERCEL_ENV: "preview" }, "30 seconds", "30 seconds"],
    [{}, "30 seconds", "30 seconds"],
  ] as const) {
    test(`times out a stalled request after ${single} (batch ${batch}) in ${env.VERCEL_ENV ?? "an unnamed deployment"}`, async () => {
      send = mock<SendImplementation>(() => new Promise(() => {}));
      batchSend = mock<BatchSendImplementation>(() => new Promise(() => {}));

      const stalled = <A>(
        request: Effect.Effect<A, unknown>,
        timeout: string
      ) =>
        Effect.gen(function* () {
          const fiber = yield* request.pipe(Effect.result, Effect.forkChild);
          yield* TestClock.adjust(timeout);
          return yield* Fiber.join(fiber);
        });

      const [sent, sentBeforeBatchTimeout, sentBatch] = await runProvider(
        Effect.gen(function* () {
          const provider = yield* EmailProviderTag;
          const timedOut = yield* stalled(provider.send(message), single);
          const early = yield* provider
            .sendBatch(batchMessages, { idempotencyKey: "stalled" })
            .pipe(Effect.timeoutOption("1 second"), Effect.forkChild);
          yield* TestClock.adjust("1 second");
          const beforeBatchTimeout = yield* Fiber.join(early);
          const batchTimedOut = yield* stalled(
            provider.sendBatch(batchMessages, { idempotencyKey: "stalled" }),
            batch
          );
          return [timedOut, beforeBatchTimeout, batchTimedOut] as const;
        }).pipe(Effect.provide(TestClock.layer())),
        env
      );

      expect(send).toHaveBeenCalledTimes(1);
      for (const result of [sent, sentBatch]) {
        expect(result).toMatchObject({
          _tag: "Failure",
          failure: {
            _tag: "NetworkError",
            message: "Resend send timed out",
          },
        });
      }
      expect(sentBeforeBatchTimeout._tag).toBe("None");
    });
  }

  test("aborts a stalled request when its timeout releases it", async () => {
    const signals: (AbortSignal | undefined)[] = [];
    send = mock<SendImplementation>((_, options) => {
      signals.push(options?.signal);
      return new Promise(() => {});
    });
    batchSend = mock<BatchSendImplementation>((_, options) => {
      signals.push(options?.signal);
      return new Promise(() => {});
    });

    await runProvider(
      Effect.gen(function* () {
        const provider = yield* EmailProviderTag;
        const single = yield* provider
          .send(message)
          .pipe(Effect.result, Effect.forkChild);
        const batch = yield* provider
          .sendBatch(batchMessages, { idempotencyKey: "stalled" })
          .pipe(Effect.result, Effect.forkChild);
        yield* TestClock.adjust("30 seconds");
        yield* Fiber.join(single);
        yield* Fiber.join(batch);
      }).pipe(Effect.provide(TestClock.layer()))
    );

    expect(signals).toHaveLength(2);
    for (const signal of signals) {
      expect(signal?.aborted).toBe(true);
    }
  });

  test("treats an accepted response without a valid delivery ID as unconfirmed", async () => {
    send = mock<SendImplementation>(async () => ({ data: { id: "" } }));

    const result = await runProvider(
      Effect.gen(function* () {
        const provider = yield* EmailProviderTag;
        return yield* provider.send(message).pipe(Effect.result);
      })
    );

    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") {
      expect(result.failure).toMatchObject({
        _tag: "NetworkError",
        message: "Resend response did not contain a valid email delivery ID",
      });
    }
  });

  test("forwards the delivery idempotency key within Resend's limit", async () => {
    await runProvider(
      Effect.gen(function* () {
        const provider = yield* EmailProviderTag;
        yield* provider.send({
          ...message,
          idempotencyKey: "invoice-resend-attempt-2",
        });
        yield* provider.send({
          ...message,
          idempotencyKey: "k".repeat(300),
        });
        yield* provider.send(message);
      })
    );

    expect(
      send.mock.calls.map(([, options]) => ({
        idempotencyKey: options?.idempotencyKey,
      }))
    ).toEqual([
      { idempotencyKey: "invoice-resend-attempt-2" },
      { idempotencyKey: "k".repeat(256) },
      { idempotencyKey: undefined },
    ]);
  });

  test("sends a batch with its idempotency key and returns IDs in order", async () => {
    batchSend = mock<BatchSendImplementation>(async () => ({
      data: { data: [{ id: "batch-id-1" }, { id: "batch-id-2" }] },
    }));

    const results = await runProvider(
      Effect.gen(function* () {
        const provider = yield* EmailProviderTag;
        return yield* provider.sendBatch(batchMessages, {
          idempotencyKey: "campaign-batch-key",
        });
      })
    );

    expect(batchSend).toHaveBeenCalledTimes(1);
    const [payload, options] = batchSend.mock.calls[0] ?? [];
    expect(payload).toHaveLength(batchMessages.length);
    expect(options).toEqual({
      idempotencyKey: "campaign-batch-key",
      signal: expect.any(AbortSignal),
    });
    expect(results.map((result) => result.id)).toEqual([
      "batch-id-1",
      "batch-id-2",
    ]);
  });

  test("maps batch refusals to EmailServiceError and unknown outcomes to NetworkError", async () => {
    for (const [statusCode, errorMessage, expectedTag] of [
      [400, "Batch request failed", "EmailServiceError"],
      [422, "Invalid recipient", "EmailServiceError"],
      [429, "Too many requests", "EmailServiceError"],
      // A reused key: an earlier request under it may have been delivered.
      [409, "Invalid idempotent request", "NetworkError"],
      [500, "Invalid upstream response", "NetworkError"],
    ] as const) {
      batchSend = mock<BatchSendImplementation>(async () => ({
        error: { statusCode, message: errorMessage },
      }));

      const result = await runProvider(
        Effect.gen(function* () {
          const provider = yield* EmailProviderTag;
          return yield* provider
            .sendBatch(batchMessages, { idempotencyKey: "campaign-batch-key" })
            .pipe(Effect.result);
        })
      );

      expect(result._tag).toBe("Failure");
      if (result._tag === "Failure") {
        expect(result.failure._tag).toBe(expectedTag);
      }
    }
  });

  test("treats a batch response with fewer IDs than messages as unconfirmed", async () => {
    batchSend = mock<BatchSendImplementation>(async () => ({
      data: { data: [{ id: "batch-id-1" }] },
    }));

    const result = await runProvider(
      Effect.gen(function* () {
        const provider = yield* EmailProviderTag;
        return yield* provider
          .sendBatch(batchMessages, { idempotencyKey: "campaign-batch-key" })
          .pipe(Effect.result);
      })
    );

    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") {
      expect(result.failure._tag).toBe("NetworkError");
    }
  });

  test("rejects batches with attachments without calling Resend", async () => {
    const result = await runProvider(
      Effect.gen(function* () {
        const provider = yield* EmailProviderTag;
        return yield* provider
          .sendBatch(
            [
              {
                ...message,
                attachments: [
                  {
                    content: Buffer.from("location-map"),
                    filename: "location-map.jpeg",
                  },
                ],
              },
            ],
            { idempotencyKey: "campaign-batch-key" }
          )
          .pipe(Effect.result);
      })
    );

    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") {
      expect(result.failure._tag).toBe("EmailServiceError");
    }
    expect(batchSend).not.toHaveBeenCalled();
  });

  test("maps the magic-link tags and surface metadata to Resend tags", async () => {
    await runProvider(
      Effect.gen(function* () {
        const provider = yield* EmailProviderTag;
        yield* provider.send({
          ...message,
          tags: ["account-magic-link"],
          metadata: { surface: "workspace" },
        });
      })
    );

    const payload = send.mock.calls[0]?.[0] as { tags?: unknown } | undefined;
    expect(payload?.tags).toEqual([
      { name: "category", value: "account-magic-link" },
      { name: "surface", value: "workspace" },
    ]);
  });

  test("drops tags and metadata Resend cannot carry and forwards headers and attachments", async () => {
    const attachment = {
      content: Buffer.from("location-map"),
      contentId: "location-map",
      contentType: "image/jpeg",
      filename: "location-map.jpeg",
    };

    await runProvider(
      Effect.gen(function* () {
        const provider = yield* EmailProviderTag;
        yield* provider.send({
          ...message,
          attachments: [attachment],
          headers: { "X-Entity-Ref-ID": "reservation-id" },
          tags: ["reservation-access", "unsafe category"],
          metadata: {
            reservationId: "reservation-id",
            ignoredNumber: 42,
            unsafeValue: "contains spaces",
            "unsafe name": "value",
          },
        });
      })
    );

    expect(send.mock.calls[0]?.[0]).toMatchObject({
      attachments: [attachment],
      headers: { "X-Entity-Ref-ID": "reservation-id" },
      tags: [
        { name: "category", value: "reservation-access" },
        { name: "reservationId", value: "reservation-id" },
      ],
    });
  });

  test("layer fails when EMAIL_API_KEY is missing", async () => {
    const result = await Effect.runPromise(
      EmailProviderTag.pipe(
        Effect.provide(
          ResendEmailProviderLive.pipe(
            Layer.provide(
              Layer.succeed(EmailConfigTag, {
                provider: "resend" as const,
                defaultFrom: { email: deskohubAddress },
              })
            )
          )
        ),
        Effect.result
      )
    );

    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") {
      expect(result.failure._tag).toBe("EmailServiceError");
    }
  });
});

/**
 * Captures terminal span errors, including non-enumerable messages, for leak
 * assertions.
 */
const serializeExitValue = (value: unknown, depth = 0): unknown => {
  if (depth > 8 || value === null || typeof value !== "object") return value;
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: typeof value.stack === "string" ? value.stack : undefined,
      cause:
        "cause" in value && value.cause !== undefined
          ? serializeExitValue(value.cause, depth + 1)
          : undefined,
    };
  }
  if (Array.isArray(value)) {
    return value.map((item) => serializeExitValue(item, depth + 1));
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      serializeExitValue(item, depth + 1),
    ])
  );
};

const captureSpans = () => {
  const ended: Array<{ exit?: unknown; name: string }> = [];
  const tracer = Tracer.make({
    span: (options) => ({
      _tag: "Span" as const,
      name: options.name,
      spanId: "test-span-id",
      traceId: "test-trace-id",
      parent: options.parent,
      annotations: options.annotations,
      attributes: new Map<string, unknown>(),
      links: options.links,
      sampled: true,
      kind: options.kind,
      status: { _tag: "Started", startTime: 0n } as Tracer.SpanStatus,
      end: (_endTime: bigint, exit: unknown) => {
        ended.push({
          exit: serializeExitValue(exit),
          name: options.name,
        });
      },
      attribute: () => {},
      event: () => {},
      addLinks: () => {},
    }),
  });
  return { ended, tracer };
};

const rawProviderDetail = "raw provider detail: quota exceeded for key rk_123";

const runTracedSend = (tracer: Tracer.Tracer) =>
  Effect.gen(function* () {
    const provider = yield* EmailProviderTag;
    return yield* provider
      .send({
        ...message,
        text: "bearer text with secret-token",
      })
      .pipe(Effect.withSpan("resend.send.test"), Effect.result);
  }).pipe(
    Effect.provide(
      ResendEmailProviderLive.pipe(
        Layer.provide(Layer.succeed(EmailConfigTag, config))
      )
    ),
    Effect.provide(Layer.succeed(Tracer.Tracer, tracer))
  );

describe("ResendEmailProvider span censorship", () => {
  test("provider rejection leaves no raw provider message, recipient, or body in traced spans", async () => {
    send = mock<SendImplementation>(async () => ({
      error: { message: rawProviderDetail, statusCode: 429 },
    }));
    const { ended, tracer } = captureSpans();

    const result = await Effect.runPromise(runTracedSend(tracer));

    expect(result._tag).toBe("Failure");
    expect(ended.length).toBeGreaterThan(0);
    const traced = JSON.stringify(ended);
    expect(traced).not.toContain(rawProviderDetail);
    expect(traced).not.toContain("quota");
    expect(traced).not.toContain("rk_123");
    expect(traced).not.toContain(adaAddress);
    expect(traced).not.toContain("secret-token");
    expect(traced).not.toContain("bearer text");
    if (result._tag === "Failure") {
      expect(result.failure._tag).toBe("EmailServiceError");
    }
  });

  test("transport failure leaves no raw error message, recipient, or body in traced spans", async () => {
    const rawTransportDetail =
      "raw transport failure: getaddrinfo ENOTFOUND api.resend.com";
    send = mock<SendImplementation>(async () => {
      throw new Error(rawTransportDetail);
    });
    const { ended, tracer } = captureSpans();

    const result = await Effect.runPromise(runTracedSend(tracer));

    expect(result._tag).toBe("Failure");
    expect(ended.length).toBeGreaterThan(0);
    const traced = JSON.stringify(ended);
    expect(traced).not.toContain(rawTransportDetail);
    expect(traced).not.toContain("getaddrinfo");
    expect(traced).not.toContain("ENOTFOUND");
    expect(traced).not.toContain(adaAddress);
    expect(traced).not.toContain("secret-token");
    if (result._tag === "Failure") {
      expect(result.failure._tag).toBe("NetworkError");
    }
  });
});
