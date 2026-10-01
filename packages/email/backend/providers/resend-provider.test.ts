import { beforeEach, describe, expect, mock, test } from "bun:test";
import { Effect, Fiber, Layer, Tracer } from "effect";
import { TestClock } from "effect/testing";
import { EmailDeliveryIdSchema } from "../../types/email.types";

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
  options?: { readonly idempotencyKey?: string }
) => Promise<SendResponse>;
type ListDomainsResponse =
  | { readonly data: readonly unknown[]; readonly error?: never }
  | { readonly data?: never; readonly error: { readonly message: string } };
type ListDomainsImplementation = () => Promise<ListDomainsResponse>;

let send = mock<SendImplementation>(async () => ({
  data: { id: "resend-id" },
}));
let listDomains = mock<ListDomainsImplementation>(async () => ({ data: [] }));

mock.module("resend", () => ({
  Resend: class {
    emails = { send: send };
    domains = { list: listDomains };
  },
}));

const { ResendEmailProviderLive } = await import("./resend-provider");
const { EmailConfigTag, EmailProviderTag } = await import("../service");

type EmailProviderRequirement = import("../service").EmailProviderTag;

beforeEach(() => {
  send = mock<SendImplementation>(async () => ({
    data: { id: "resend-id" },
  }));
  listDomains = mock<ListDomainsImplementation>(async () => ({ data: [] }));
});

const config = {
  provider: "resend" as const,
  defaultFrom: { email: "deskohub@example.test" },
  apiKey: "api-key",
};

const runProvider = <A, E>(
  effect: Effect.Effect<A, E, EmailProviderRequirement>
) =>
  Effect.runPromise(
    effect.pipe(
      Effect.provide(
        ResendEmailProviderLive.pipe(
          Layer.provide(Layer.succeed(EmailConfigTag, config))
        )
      )
    )
  );

const message = {
  from: { email: "deskohub@example.test" },
  to: { email: "ada@example.test" },
  subject: "Hello",
  html: "<p>Hello</p>",
};

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

  test("maps a stalled request to NetworkError", async () => {
    send = mock<SendImplementation>(() => new Promise(() => {}));

    const result = await runProvider(
      Effect.gen(function* () {
        const provider = yield* EmailProviderTag;
        const fiber = yield* provider
          .send(message)
          .pipe(Effect.result, Effect.forkChild);
        yield* TestClock.adjust("5 seconds");
        return yield* Fiber.join(fiber);
      }).pipe(Effect.provide(TestClock.layer()))
    );

    expect(send).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      _tag: "Failure",
      failure: {
        _tag: "NetworkError",
        message: "Resend send timed out",
      },
    });
  });

  test("send result includes status", async () => {
    const result = await runProvider(
      Effect.gen(function* () {
        const provider = yield* EmailProviderTag;
        return yield* provider.send(message);
      })
    );

    expect(result).toMatchObject({
      id: EmailDeliveryIdSchema.make("resend-id"),
      provider: "resend",
      status: "sent",
    });
  });

  test("rejects a Resend response without a valid delivery ID", async () => {
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
        _tag: "EmailServiceError",
        message: "Resend response did not contain a valid email delivery ID",
        provider: "resend",
      });
    }
  });

  test("uses stable access and invoice delivery idempotency keys", async () => {
    await runProvider(
      Effect.gen(function* () {
        const provider = yield* EmailProviderTag;
        for (const category of [
          "workspace-paid-reservation-access",
          "workspace-invoice-customer",
          "workspace-invoice-internal",
        ]) {
          yield* provider.send({
            ...message,
            tags: [category],
            metadata: { workspaceReservationId: "reservation-id" },
          });
        }
      })
    );

    expect(send.mock.calls.map(([, options]) => options)).toEqual([
      {
        idempotencyKey: "workspace-paid-reservation-access-reservation-id",
      },
      { idempotencyKey: "workspace-invoice-customer-reservation-id" },
      { idempotencyKey: "workspace-invoice-internal-reservation-id" },
    ]);
  });

  test("prefers an explicit idempotency key", async () => {
    await runProvider(
      Effect.gen(function* () {
        const provider = yield* EmailProviderTag;
        yield* provider.send({
          ...message,
          idempotencyKey: "invoice-resend-attempt-2",
          tags: ["workspace-invoice-customer"],
          metadata: { workspaceReservationId: "reservation-id" },
        });
      })
    );

    expect(send.mock.calls[0]?.[1]).toEqual({
      idempotencyKey: "invoice-resend-attempt-2",
    });
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

  test("verify fails when Resend returns an error", async () => {
    listDomains = mock<ListDomainsImplementation>(async () => ({
      error: { message: "Invalid API key" },
    }));

    const result = await runProvider(
      Effect.gen(function* () {
        const provider = yield* EmailProviderTag;
        return yield* provider.verify.pipe(Effect.result);
      })
    );

    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") {
      expect(result.failure._tag).toBe("EmailServiceError");
    }
  });

  test("layer fails when EMAIL_API_KEY is missing", async () => {
    const result = await Effect.runPromise(
      EmailProviderTag.pipe(
        Effect.provide(
          ResendEmailProviderLive.pipe(
            Layer.provide(
              Layer.succeed(EmailConfigTag, {
                provider: "resend" as const,
                defaultFrom: { email: "deskohub@example.test" },
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
    expect(traced).not.toContain("ada@example.test");
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
    expect(traced).not.toContain("ada@example.test");
    expect(traced).not.toContain("secret-token");
    if (result._tag === "Failure") {
      expect(result.failure._tag).toBe("NetworkError");
    }
  });

  test("verification failure carries only the fixed message", async () => {
    listDomains = mock<ListDomainsImplementation>(async () => ({
      error: { message: rawProviderDetail },
    }));

    const result = await runProvider(
      Effect.gen(function* () {
        const provider = yield* EmailProviderTag;
        return yield* provider.verify.pipe(Effect.result);
      })
    );

    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") {
      expect(result.failure).toMatchObject({
        _tag: "EmailServiceError",
        message: "Failed to verify Resend API key",
      });
      expect(JSON.stringify(result.failure)).not.toContain(rawProviderDetail);
    }
  });

  test("a rejected domains.list keeps only the fixed message in failure and spans", async () => {
    const rawRejectDetail =
      "raw rejection detail: fetch failed with ECONNRESET for key rk_123";
    listDomains = mock<ListDomainsImplementation>(async () => {
      throw new Error(rawRejectDetail);
    });
    const { ended, tracer } = captureSpans();

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const provider = yield* EmailProviderTag;
        return yield* provider.verify.pipe(
          Effect.withSpan("resend.verify.test"),
          Effect.result
        );
      }).pipe(
        Effect.provide(
          ResendEmailProviderLive.pipe(
            Layer.provide(Layer.succeed(EmailConfigTag, config))
          )
        ),
        Effect.provide(Layer.succeed(Tracer.Tracer, tracer))
      )
    );

    expect(result._tag).toBe("Failure");
    if (result._tag === "Failure") {
      expect(result.failure).toMatchObject({
        _tag: "EmailServiceError",
        message: "Failed to verify Resend API key",
      });
      const serialized = JSON.stringify(result.failure);
      expect(serialized).not.toContain(rawRejectDetail);
      expect(serialized).not.toContain("ECONNRESET");
    }

    expect(ended.length).toBeGreaterThan(0);
    const traced = JSON.stringify(ended);
    expect(traced).not.toContain(rawRejectDetail);
    expect(traced).not.toContain("ECONNRESET");
    expect(traced).not.toContain("rk_123");
  });
});
