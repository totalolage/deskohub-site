import { beforeEach, describe, expect, mock, test } from "bun:test";
import { continuesEmailChain } from "@deskohub/email";
import { testEmailAddress } from "@deskohub/test-email";
import { ConfigProvider, Duration, Effect, Fiber, Tracer } from "effect";
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
    }
  | { readonly data?: never; readonly error: unknown };
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

const { deploymentResendRequestTimeouts, makeResendEmailProvider } =
  await import("./resend-provider");

beforeEach(() => {
  send = mock<SendImplementation>(async () => ({
    data: { id: "resend-id" },
  }));
  batchSend = mock<BatchSendImplementation>(async () => ({
    data: { data: [] },
  }));
});

/** The Resend provider with the request timeouts of the test's deployment. */
const resendProvider = deploymentResendRequestTimeouts.pipe(
  Effect.map((timeouts) =>
    makeResendEmailProvider({ apiKey: "api-key", timeouts })
  )
);

/** Runs `effect` on the TestClock with `env` as its configuration. */
const runProvider = <A, E>(
  effect: Effect.Effect<A, E>,
  env: Record<string, string> = {}
) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(TestClock.layer()),
      Effect.provideService(
        ConfigProvider.ConfigProvider,
        ConfigProvider.fromUnknown(env)
      )
    )
  );

/**
 * Waits for a forked request, advancing the TestClock through every attempt
 * timeout and retry backoff.
 */
const finish = <A, E>(fiber: Fiber.Fiber<A, E>) =>
  Effect.gen(function* () {
    while (fiber.pollUnsafe() === undefined) {
      yield* TestClock.adjust("1 second");
    }
    return yield* Fiber.join(fiber);
  });

/** Runs a request to its result on the TestClock. */
const settle = <A, E>(request: Effect.Effect<A, E>) =>
  Effect.gen(function* () {
    return yield* finish(yield* request.pipe(Effect.result, Effect.forkChild));
  });

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
  const refusal =
    (statusCode: number, errorMessage = "Refused"): SendImplementation =>
    async () => ({ error: { statusCode, message: errorMessage } });
  const unclassifiedRefusal =
    (error: unknown): SendImplementation =>
    async () => ({ error });

  for (const row of [
    {
      name: "429 quota or rate limit",
      respond: refusal(429),
      tag: "EmailServiceError",
      failureKind: "provider",
      code: "http-429",
      attempts: 1,
      continuesChain: true,
    },
    {
      name: "401 key refusal",
      respond: refusal(401),
      tag: "EmailServiceError",
      failureKind: "provider",
      code: "http-401",
      attempts: 1,
      continuesChain: true,
    },
    {
      name: "403 scope refusal",
      respond: refusal(403),
      tag: "EmailServiceError",
      failureKind: "provider",
      code: "http-403",
      attempts: 1,
      continuesChain: true,
    },
    {
      name: "404 missing resource",
      respond: refusal(404),
      tag: "EmailServiceError",
      failureKind: "provider",
      code: "http-404",
      attempts: 1,
      continuesChain: true,
    },
    {
      name: "409 idempotency key in use",
      respond: refusal(409),
      tag: "NetworkError",
      failureKind: "unknown-outcome",
      code: "http-409",
      attempts: 4,
      continuesChain: false,
    },
    {
      name: "400 validation refusal",
      respond: refusal(400),
      tag: "EmailServiceError",
      failureKind: "message",
      code: "http-400",
      attempts: 1,
      continuesChain: false,
    },
    {
      name: "422 validation refusal",
      respond: refusal(422),
      tag: "EmailServiceError",
      failureKind: "message",
      code: "http-422",
      attempts: 1,
      continuesChain: false,
    },
    {
      name: "5xx server failure",
      respond: refusal(503),
      tag: "NetworkError",
      failureKind: undefined,
      code: "http-503",
      attempts: 4,
      continuesChain: true,
    },
    {
      name: "unauthorized refusal without a status",
      respond: unclassifiedRefusal({ message: "Invalid API key" }),
      tag: "EmailServiceError",
      failureKind: "provider",
      code: "resend-unauthorized",
      attempts: 1,
      continuesChain: true,
    },
    {
      name: "invalid request without a status",
      respond: unclassifiedRefusal({ message: "Invalid recipient" }),
      tag: "EmailServiceError",
      failureKind: "message",
      code: "resend-invalid",
      attempts: 1,
      continuesChain: false,
    },
    {
      name: "server failure without a status",
      respond: unclassifiedRefusal({ message: "Upstream unavailable" }),
      tag: "NetworkError",
      failureKind: undefined,
      code: "resend-server",
      attempts: 4,
      continuesChain: true,
    },
    {
      name: "transport failure",
      respond: async () => {
        throw new Error("network down");
      },
      tag: "NetworkError",
      failureKind: undefined,
      code: "transport",
      attempts: 4,
      continuesChain: true,
    },
    {
      name: "stalled request",
      respond: () => new Promise(() => {}),
      tag: "NetworkError",
      failureKind: undefined,
      code: "timeout",
      attempts: 4,
      continuesChain: true,
    },
    {
      name: "accepted response without a valid delivery ID",
      respond: async () => ({ data: { id: "" } }),
      tag: "NetworkError",
      failureKind: "unknown-outcome",
      code: "invalid-response",
      attempts: 4,
      continuesChain: false,
    },
  ] as const satisfies readonly {
    readonly name: string;
    readonly respond: SendImplementation;
    readonly tag: "EmailServiceError" | "NetworkError";
    readonly failureKind:
      | "provider"
      | "message"
      | "unknown-outcome"
      | undefined;
    readonly code: string;
    readonly attempts: 1 | 4;
    readonly continuesChain: boolean;
  }[]) {
    test(`classifies a ${row.name} and sends it ${row.attempts} time(s) under one key`, async () => {
      send = mock<SendImplementation>(row.respond);

      const result = await runProvider(
        Effect.gen(function* () {
          const provider = yield* resendProvider;
          return yield* settle(
            provider.send({ ...message, idempotencyKey: "delivery-key" })
          );
        })
      );

      expect(result).toMatchObject({
        _tag: "Failure",
        failure: { _tag: row.tag, code: row.code },
      });
      if (result._tag === "Failure") {
        expect(result.failure.failureKind).toBe(row.failureKind);
        expect(continuesEmailChain(result.failure)).toBe(row.continuesChain);
      }
      expect(send).toHaveBeenCalledTimes(row.attempts);
      expect(
        send.mock.calls.map(([, options]) => options?.idempotencyKey)
      ).toEqual(Array(row.attempts).fill("delivery-key"));
    });
  }

  test("classifies an error without a status code by its message, then its error code", async () => {
    for (const [error, expected] of [
      [
        { error: "invalid_api_key" },
        { _tag: "EmailServiceError", code: "resend-invalid" },
      ],
      [
        { message: 42, error: "restricted_api_key forbidden" },
        { _tag: "EmailServiceError", code: "resend-unauthorized" },
      ],
      [
        { message: "Rate limited", error: "invalid_request" },
        { _tag: "NetworkError", code: "resend-server" },
      ],
      [{ error: 42 }, { _tag: "NetworkError", code: "resend-server" }],
      ["Forbidden", { _tag: "NetworkError", code: "resend-server" }],
    ] as const) {
      send = mock<SendImplementation>(unclassifiedRefusal(error));
      const result = await runProvider(
        Effect.gen(function* () {
          const provider = yield* resendProvider;
          return yield* settle(provider.send(message));
        })
      );

      expect(result).toMatchObject({ _tag: "Failure", failure: expected });
    }
  });

  test("sends no Resend tags for a message without categories or string metadata", async () => {
    await runProvider(
      Effect.gen(function* () {
        const provider = yield* resendProvider;
        yield* provider.send({ ...message, metadata: { attempt: 1 } });
      })
    );

    const payload = send.mock.calls[0]?.[0] as { tags?: unknown } | undefined;
    expect(payload?.tags).toBeUndefined();
  });

  for (const [env, single, batch] of [
    [{ VERCEL_ENV: "production" }, "5 seconds", "10 seconds"],
    [{ VERCEL_ENV: "preview" }, "30 seconds", "30 seconds"],
    [{}, "30 seconds", "30 seconds"],
  ] as const) {
    test(`times out each stalled attempt after ${single} (batch ${batch}) in ${env.VERCEL_ENV ?? "an unnamed deployment"}`, async () => {
      const sendSignals: AbortSignal[] = [];
      const batchSignals: AbortSignal[] = [];
      send = mock<SendImplementation>((_, options) => {
        if (options?.signal) sendSignals.push(options.signal);
        return new Promise(() => {});
      });
      batchSend = mock<BatchSendImplementation>((_, options) => {
        if (options?.signal) batchSignals.push(options.signal);
        return new Promise(() => {});
      });

      /** Whether the first attempt is aborted just before and at `timeout`. */
      const abortsAround = (signals: AbortSignal[], timeout: Duration.Input) =>
        Effect.gen(function* () {
          yield* TestClock.adjust(
            Duration.subtract(
              Duration.fromInputUnsafe(timeout),
              Duration.millis(1)
            )
          );
          const before = signals[0]?.aborted;
          yield* TestClock.adjust("1 millis");
          return { before, at: signals[0]?.aborted };
        });

      const outcome = await runProvider(
        Effect.gen(function* () {
          const provider = yield* resendProvider;
          const sending = yield* provider
            .send(message)
            .pipe(Effect.result, Effect.forkChild);
          const sendAborts = yield* abortsAround(sendSignals, single);
          const sent = yield* finish(sending);
          const batching = yield* provider
            .sendBatch(batchMessages, { idempotencyKey: "stalled" })
            .pipe(Effect.result, Effect.forkChild);
          const batchAborts = yield* abortsAround(batchSignals, batch);
          const sentBatch = yield* finish(batching);
          return { sent, sendAborts, sentBatch, batchAborts };
        }),
        env
      );

      expect(outcome.sendAborts).toEqual({ before: false, at: true });
      expect(outcome.batchAborts).toEqual({ before: false, at: true });
      expect(send).toHaveBeenCalledTimes(4);
      expect(batchSend).toHaveBeenCalledTimes(1);
      for (const result of [outcome.sent, outcome.sentBatch]) {
        expect(result).toMatchObject({
          _tag: "Failure",
          failure: { _tag: "NetworkError", code: "timeout" },
        });
      }
    });
  }

  test("aborts every stalled attempt when its timeout releases it", async () => {
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
        const provider = yield* resendProvider;
        yield* settle(provider.send(message));
        yield* settle(
          provider.sendBatch(batchMessages, { idempotencyKey: "stalled" })
        );
      })
    );

    expect(signals).toHaveLength(5);
    for (const signal of signals) {
      expect(signal?.aborted).toBe(true);
    }
  });

  test("forwards the delivery idempotency key within Resend's limit", async () => {
    await runProvider(
      Effect.gen(function* () {
        const provider = yield* resendProvider;
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
        const provider = yield* resendProvider;
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
    expect(results).toMatchObject([
      { id: "batch-id-1", status: "sent", provider: "resend" },
      { id: "batch-id-2", status: "sent", provider: "resend" },
    ]);
  });

  test("classifies batch refusals and sends each batch once", async () => {
    for (const [statusCode, errorMessage, expected] of [
      [
        400,
        "Batch request failed",
        { _tag: "EmailServiceError", failureKind: "message", code: "http-400" },
      ],
      [
        422,
        "Invalid recipient",
        { _tag: "EmailServiceError", failureKind: "message", code: "http-422" },
      ],
      [
        429,
        "Too many requests",
        {
          _tag: "EmailServiceError",
          failureKind: "provider",
          code: "http-429",
        },
      ],
      // A reused key: an earlier request under it may have been delivered.
      [
        409,
        "Invalid idempotent request",
        {
          _tag: "NetworkError",
          failureKind: "unknown-outcome",
          code: "http-409",
        },
      ],
      [
        500,
        "Invalid upstream response",
        { _tag: "NetworkError", code: "http-500" },
      ],
    ] as const) {
      batchSend = mock<BatchSendImplementation>(async () => ({
        error: { statusCode, message: errorMessage },
      }));

      const result = await runProvider(
        Effect.gen(function* () {
          const provider = yield* resendProvider;
          return yield* settle(
            provider.sendBatch(batchMessages, {
              idempotencyKey: "campaign-batch-key",
            })
          );
        })
      );

      expect(result).toMatchObject({ _tag: "Failure", failure: expected });
      expect(batchSend).toHaveBeenCalledTimes(1);
    }
  });

  test("treats a batch response with fewer IDs than messages as unconfirmed", async () => {
    batchSend = mock<BatchSendImplementation>(async () => ({
      data: { data: [{ id: "batch-id-1" }] },
    }));

    const result = await runProvider(
      Effect.gen(function* () {
        const provider = yield* resendProvider;
        return yield* settle(
          provider.sendBatch(batchMessages, {
            idempotencyKey: "campaign-batch-key",
          })
        );
      })
    );

    expect(result).toMatchObject({
      _tag: "Failure",
      failure: {
        _tag: "NetworkError",
        failureKind: "unknown-outcome",
        code: "batch-size-mismatch",
      },
    });
    expect(batchSend).toHaveBeenCalledTimes(1);
  });

  test("rejects batches with attachments without calling Resend", async () => {
    const result = await runProvider(
      Effect.gen(function* () {
        const provider = yield* resendProvider;
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

    expect(result).toMatchObject({
      _tag: "Failure",
      failure: {
        _tag: "EmailServiceError",
        failureKind: "message",
        code: "attachments-unsupported",
      },
    });
    expect(batchSend).not.toHaveBeenCalled();
  });

  test("maps the magic-link tags and surface metadata to Resend tags", async () => {
    await runProvider(
      Effect.gen(function* () {
        const provider = yield* resendProvider;
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
        const provider = yield* resendProvider;
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
  runProvider(
    Effect.gen(function* () {
      const provider = yield* resendProvider;
      return yield* settle(
        provider
          .send({
            ...message,
            text: "bearer text with secret-token",
          })
          .pipe(Effect.withSpan("resend.send.test"))
      );
    }).pipe(Effect.provideService(Tracer.Tracer, tracer))
  );

describe("ResendEmailProvider span censorship", () => {
  test("provider rejection leaves no raw provider message, recipient, or body in traced spans", async () => {
    send = mock<SendImplementation>(async () => ({
      error: { message: rawProviderDetail, statusCode: 429 },
    }));
    const { ended, tracer } = captureSpans();

    const result = await runTracedSend(tracer);

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

    const result = await runTracedSend(tracer);

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
