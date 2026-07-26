import { describe, expect, test } from "bun:test";
import { resourceFromAttributes } from "@opentelemetry/resources";
import {
  InMemoryLogRecordExporter,
  LoggerProvider,
  SimpleLogRecordProcessor,
} from "@opentelemetry/sdk-logs";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { EffectLogger } from "drizzle-orm/effect-postgres";
import { Cause, Effect, Layer, Logger, References } from "effect";
import { createTracingLive } from "../observability/otel-tracing";
import {
  CENSORED_LOG_VALUE,
  censorLoggerOptions,
  censorLogValue,
  createCensoredOtelLogger,
  createCensoredOtelSpanExporter,
  isSensitiveLogKey,
} from "./censorship";

class CustomValue {
  constructor(readonly secret: string) {}
}

describe("isSensitiveLogKey", () => {
  test("matches common credential key shapes", () => {
    expect(isSensitiveLogKey("password")).toBe(true);
    expect(isSensitiveLogKey("passwd")).toBe(true);
    expect(isSensitiveLogKey("pwd")).toBe(true);
    expect(isSensitiveLogKey("token")).toBe(true);
    expect(isSensitiveLogKey("access_token")).toBe(true);
    expect(isSensitiveLogKey("access token")).toBe(true);
    expect(isSensitiveLogKey("access.token")).toBe(true);
    expect(isSensitiveLogKey("refresh-token")).toBe(true);
    expect(isSensitiveLogKey("idToken")).toBe(true);
    expect(isSensitiveLogKey("secret")).toBe(true);
    expect(isSensitiveLogKey("client.secret")).toBe(true);
    expect(isSensitiveLogKey("apiKey")).toBe(true);
    expect(isSensitiveLogKey("api key")).toBe(true);
    expect(isSensitiveLogKey("api.key")).toBe(true);
    expect(isSensitiveLogKey("x-vercel-proxy-signature")).toBe(true);
    expect(isSensitiveLogKey("x-vercel-sc-headers")).toBe(true);
    expect(isSensitiveLogKey("authorization")).toBe(true);
    expect(isSensitiveLogKey("auth")).toBe(true);
    expect(isSensitiveLogKey("cookie")).toBe(true);
    expect(isSensitiveLogKey("set-cookie")).toBe(true);
    expect(isSensitiveLogKey("set cookie")).toBe(true);
    expect(isSensitiveLogKey("set_cookie")).toBe(true);
    expect(isSensitiveLogKey("set.cookie")).toBe(true);
    expect(isSensitiveLogKey("sessionCookie")).toBe(true);
    expect(isSensitiveLogKey("session_secret")).toBe(true);
    expect(isSensitiveLogKey("session-token")).toBe(true);
    expect(isSensitiveLogKey("name")).toBe(true);
    expect(isSensitiveLogKey("message")).toBe(true);
    expect(isSensitiveLogKey("errorDescription")).toBe(true);
    expect(isSensitiveLogKey("email")).toBe(true);
    expect(isSensitiveLogKey("phone")).toBe(true);
    expect(isSensitiveLogKey("firstName")).toBe(true);
    expect(isSensitiveLogKey("lastName")).toBe(true);
    expect(isSensitiveLogKey("checkoutSessionId")).toBe(true);
    expect(isSensitiveLogKey("customerId")).toBe(true);
    expect(isSensitiveLogKey("providerOrderId")).toBe(true);
    expect(isSensitiveLogKey("checkoutSessionKey")).toBe(true);
    expect(isSensitiveLogKey("idempotencyKey")).toBe(true);
    expect(isSensitiveLogKey("payloadDigest")).toBe(true);
    expect(isSensitiveLogKey("subjectHash")).toBe(true);
    expect(isSensitiveLogKey("quoteFingerprint")).toBe(true);
    expect(isSensitiveLogKey("returnState")).toBe(true);
  });

  test("matches common prefixed camelCase credential key shapes", () => {
    expect(isSensitiveLogKey("stripeApiKey")).toBe(true);
    expect(isSensitiveLogKey("githubAccessToken")).toBe(true);
    expect(isSensitiveLogKey("userRefreshToken")).toBe(true);
    expect(isSensitiveLogKey("oauthClientSecret")).toBe(true);
    expect(isSensitiveLogKey("requestAuthorization")).toBe(true);
    expect(isSensitiveLogKey("StripeApiKey")).toBe(true);
  });

  test("matches sensitive fragments inside path-like keyed shapes", () => {
    expect(isSensitiveLogKey("user[password]")).toBe(true);
    expect(isSensitiveLogKey("headers:authorization")).toBe(true);
    expect(isSensitiveLogKey("credentials/password")).toBe(true);
    expect(isSensitiveLogKey("metadata<password>")).toBe(true);
    expect(isSensitiveLogKey("payload.access.token.value")).toBe(true);
    expect(isSensitiveLogKey("secret?")).toBe(true);
  });

  test("does not match unrelated words", () => {
    expect(isSensitiveLogKey("author")).toBe(false);
    expect(isSensitiveLogKey("authentication")).toBe(false);
    expect(isSensitiveLogKey("passwordless")).toBe(false);
    expect(isSensitiveLogKey("tokenizedLabel")).toBe(false);
    expect(isSensitiveLogKey("keyboardLayout")).toBe(false);
    expect(isSensitiveLogKey("hashingAlgorithm")).toBe(false);
    expect(isSensitiveLogKey("session")).toBe(false);
    expect(isSensitiveLogKey("sessionId")).toBe(true);
    expect(isSensitiveLogKey("sessionDuration")).toBe(false);
    expect(isSensitiveLogKey("userSessionCount")).toBe(false);
    expect(isSensitiveLogKey("params")).toBe(false);
    expect(isSensitiveLogKey("apiKeyDisplayName")).toBe(true);
    expect(isSensitiveLogKey("authorizationHeaderLabel")).toBe(false);
  });
});

describe("censorLogValue", () => {
  test("never exposes dynamic values behind benign keys or custom containers", () => {
    const sentinel = "SyntheticValidLookingTelemetryValue";
    class BenignContainer {
      readonly detail = sentinel;
    }

    const projected = censorLogValue({
      category: sentinel,
      detail: sentinel,
      visible: sentinel,
      response: { payload: sentinel },
      custom: new BenignContainer(),
      set: new Set([sentinel]),
      map: new Map([["display", sentinel]]),
      primitive: sentinel,
      aggregate: new AggregateError(
        [sentinel, 42, false, { cause: new Error(sentinel), detail: sentinel }],
        sentinel
      ),
    });

    expect(JSON.stringify(projected)).not.toContain(sentinel);
  });

  test("redacts nested sensitive object keys without mutating input", () => {
    const input = {
      user: "deskohub",
      nested: {
        apiKey: "secret-api-key",
        "x-vercel-sc-headers": JSON.stringify({
          authorization: "Bearer secret",
        }),
        stripeApiKey: "secret-stripe-api-key",
        githubAccessToken: "secret-github-access-token",
        userRefreshToken: "secret-user-refresh-token",
        customerAccessCode: "123456",
        accessCode: "654321",
        oauthClientSecret: "secret-oauth-client-secret",
        requestAuthorization: "Bearer secret",
        discountCode: "SUMMER50",
        submittedCode: "SUMMER50",
        params: '["SUMMER50"]',
        query: "select * from discount_codes where code = $1",
        discountCodeId: "synthetic-discount-code-id",
        name: "Ada Lovelace",
        message: "private form message",
        errorDescription: "provider echoed private payload",
        visible: "safe",
        email: "ada@example.com",
        phone: "+420777123456",
        firstName: "Ada",
        lastName: "Lovelace",
        sessionDuration: 123,
        userSessionCount: 2,
      },
      credentials: [{ password: "secret-password", name: "Ada" }],
    };

    const censored = censorLogValue(input);

    expect(censored).toEqual({
      user: CENSORED_LOG_VALUE,
      nested: {
        apiKey: CENSORED_LOG_VALUE,
        "x-vercel-sc-headers": CENSORED_LOG_VALUE,
        stripeApiKey: CENSORED_LOG_VALUE,
        githubAccessToken: CENSORED_LOG_VALUE,
        userRefreshToken: CENSORED_LOG_VALUE,
        customerAccessCode: CENSORED_LOG_VALUE,
        accessCode: CENSORED_LOG_VALUE,
        oauthClientSecret: CENSORED_LOG_VALUE,
        requestAuthorization: CENSORED_LOG_VALUE,
        discountCode: CENSORED_LOG_VALUE,
        submittedCode: CENSORED_LOG_VALUE,
        params: CENSORED_LOG_VALUE,
        query: CENSORED_LOG_VALUE,
        discountCodeId: CENSORED_LOG_VALUE,
        name: CENSORED_LOG_VALUE,
        message: CENSORED_LOG_VALUE,
        errorDescription: CENSORED_LOG_VALUE,
        visible: CENSORED_LOG_VALUE,
        email: CENSORED_LOG_VALUE,
        phone: CENSORED_LOG_VALUE,
        firstName: CENSORED_LOG_VALUE,
        lastName: CENSORED_LOG_VALUE,
        sessionDuration: CENSORED_LOG_VALUE,
        userSessionCount: CENSORED_LOG_VALUE,
      },
      credentials: [{ password: CENSORED_LOG_VALUE, name: CENSORED_LOG_VALUE }],
    });
    expect(input.nested.apiKey).toBe("secret-api-key");
    expect(input.credentials[0]?.password).toBe("secret-password");
  });

  test("redacts telemetry-shaped name keys in ordinary payloads", () => {
    expect(
      censorLogValue({
        "service.name": "private customer value",
        "telemetry.sdk.name": "private provider value",
      })
    ).toEqual({
      "service.name": CENSORED_LOG_VALUE,
      "telemetry.sdk.name": CENSORED_LOG_VALUE,
    });
  });

  test("handles cycles while preserving the censored cycle shape", () => {
    const input: { name: string; self?: unknown; token?: string } = {
      name: "cycle",
      token: "secret-token",
    };
    input.self = input;

    const censored = censorLogValue(input) as typeof input;

    expect(censored).not.toBe(input);
    expect(censored.token).toBe(CENSORED_LOG_VALUE);
    expect(censored.self).toBe(censored);
  });

  test("projects every query parameter closed", () => {
    const input = {
      params: [
        "visible",
        { email: "private@example.com", sessionDuration: 123 },
      ],
    };

    expect(censorLogValue(input)).toEqual({
      params: [
        CENSORED_LOG_VALUE,
        {
          email: CENSORED_LOG_VALUE,
          sessionDuration: CENSORED_LOG_VALUE,
        },
      ],
    });
  });

  test("projects Drizzle query errors without exposing their dynamic message", () => {
    const error = new EffectDrizzleQueryError({
      query: "select * from customers where email = $1",
      params: [
        "visible",
        { email: "private@example.com", sessionDuration: 123 },
      ],
      cause: new Error("driver echoed private@example.com"),
    });

    const censored = censorLogValue({ cause: error });
    const serialized = JSON.stringify(censored);

    expect(censored).toEqual({
      cause: {
        kind: "error",
        category: "custom",
        cause: {
          kind: "error",
          category: "native",
        },
      },
    });
    expect(serialized).not.toContain("private@example.com");
    expect(serialized).not.toContain("Failed query");
  });

  test("projects errors and arbitrary non-plain objects", () => {
    const error = new Error("boom");
    const date = new Date("2026-05-30T00:00:00.000Z");
    const set = new Set(["secret"]);
    const custom = new CustomValue("secret");
    const promise = Promise.resolve("secret");

    const input = { thrown: error, date, set, custom, promise };
    const censored = censorLogValue(input) as typeof input;

    expect(censored).toEqual({
      thrown: { kind: "error", category: "native" },
      date: { kind: "object" },
      set: { kind: "object" },
      custom: { kind: "object" },
      promise: { kind: "object" },
    });
    expect(censored.thrown).toEqual({ kind: "error", category: "native" });
    expect(censorLogValue(error)).toEqual({
      kind: "error",
      category: "native",
    });
  });

  test("redacts Map entries by sensitive string keys without mutating input", () => {
    const objectKey = { secret: "key-secret" };
    const input = new Map<unknown, unknown>([
      ["password", "secret-password"],
      ["headers:authorization", "Bearer secret"],
      ["payState", "pay-state-secret"],
      ["payStateRef", "pay-state-ref-secret"],
      ["checkoutToken", "checkout-token-secret"],
      ["sessionDuration", 123],
      ["nested", { apiKey: "secret-api-key" }],
      [objectKey, "visible"],
    ]);

    const censored = censorLogValue(input) as Map<unknown, unknown>;

    expect(censored).not.toBe(input);
    expect(censored.get("password")).toBe(CENSORED_LOG_VALUE);
    expect(censored.get("headers:authorization")).toBe(CENSORED_LOG_VALUE);
    expect(censored.get("payState")).toBe(CENSORED_LOG_VALUE);
    expect(censored.get("payStateRef")).toBe(CENSORED_LOG_VALUE);
    expect(censored.get("checkoutToken")).toBe(CENSORED_LOG_VALUE);
    expect(censored.get("sessionDuration")).toBe(CENSORED_LOG_VALUE);
    expect(censored.get("nested")).toEqual({ apiKey: CENSORED_LOG_VALUE });
    expect(censored.get(objectKey)).toBe(CENSORED_LOG_VALUE);
    expect(input.get("password")).toBe("secret-password");
    expect(input.get("headers:authorization")).toBe("Bearer secret");
    expect(input.get("payState")).toBe("pay-state-secret");
    expect(input.get("payStateRef")).toBe("pay-state-ref-secret");
    expect(input.get("checkoutToken")).toBe("checkout-token-secret");
    expect(input.get("nested")).toEqual({ apiKey: "secret-api-key" });
  });

  test("drops dynamic relative URLs", () => {
    expect(
      censorLogValue(
        "/en-US/checkout/pay?payState=secret&payStateRef=ref&checkoutToken=token&discountCode=SUMMER50&submittedCode=SUMMER50&visible=safe#summary"
      )
    ).toBe(CENSORED_LOG_VALUE);
  });

  test("drops dynamic bare relative URLs", () => {
    expect(
      censorLogValue(
        "checkout/pay?payState=secret&checkoutToken=token&visible=safe#summary"
      )
    ).toBe(CENSORED_LOG_VALUE);
  });

  test("drops dynamic mixed-case relative URLs", () => {
    expect(
      censorLogValue("checkout/pay?PayState=secret&CHECKOUTTOKEN=token")
    ).toBe(CENSORED_LOG_VALUE);
  });

  test("drops dynamic contact URLs", () => {
    expect(
      censorLogValue("contact?name=Ada&message=Private&visible=safe")
    ).toBe(CENSORED_LOG_VALUE);
  });

  test("redacts Headers and URLSearchParams by key without mutating input", () => {
    const headers = new Headers([
      ["authorization", "Bearer secret"],
      ["x-vercel-proxy-signature", "secret-signature"],
      [
        "x-vercel-sc-headers",
        JSON.stringify({ authorization: "Bearer secret" }),
      ],
      ["x-visible", "safe"],
    ]);
    const searchParams = new URLSearchParams([
      ["client_secret", "secret-client"],
      ["payState", "dhp1.secret"],
      ["PayStateRef", "opaque-secret"],
      ["checkoutToken", "checkout-secret"],
      ["sessionDuration", "123"],
    ]);
    const input = {
      headers,
      searchParams,
      plain: { payStateRef: "opaque-secret", nested: { checkoutToken: "x" } },
    };

    const censored = censorLogValue(input) as {
      headers: Headers;
      searchParams: URLSearchParams;
      plain: { payStateRef: string; nested: { checkoutToken: string } };
    };

    expect(censored.headers).not.toBe(headers);
    expect(censored.headers.get("authorization")).toBe(CENSORED_LOG_VALUE);
    expect(censored.headers.get("x-vercel-proxy-signature")).toBe(
      CENSORED_LOG_VALUE
    );
    expect(censored.headers.get("x-vercel-sc-headers")).toBe(
      CENSORED_LOG_VALUE
    );
    expect(censored.headers.get("x-visible")).toBe(CENSORED_LOG_VALUE);
    expect(headers.get("authorization")).toBe("Bearer secret");
    expect(censored.searchParams).not.toBe(searchParams);
    expect(censored.searchParams.get("client_secret")).toBe(CENSORED_LOG_VALUE);
    expect(censored.searchParams.get("payState")).toBe(CENSORED_LOG_VALUE);
    expect(censored.searchParams.get("PayStateRef")).toBe(CENSORED_LOG_VALUE);
    expect(censored.searchParams.get("checkoutToken")).toBe(CENSORED_LOG_VALUE);
    expect(censored.searchParams.get("sessionDuration")).toBe(
      CENSORED_LOG_VALUE
    );
    expect(searchParams.get("client_secret")).toBe("secret-client");
    expect(censored.plain.payStateRef).toBe(CENSORED_LOG_VALUE);
    expect(censored.plain.nested.checkoutToken).toBe(CENSORED_LOG_VALUE);
  });
});

describe("censorLoggerOptions", () => {
  test("redacts message values and annotation values or sensitive annotation keys", () => {
    const annotations = {
      request: { headers: { authorization: "Bearer secret" } },
      sessionToken: "session-secret",
    };
    const options = {
      message: { password: "secret", safe: "visible" },
      logLevel: "Info",
      cause: Cause.empty,
      date: new Date(0),
      fiber: {
        id: 1,
        getRef: (ref: unknown) =>
          ref === References.CurrentLogAnnotations ? annotations : [],
      },
    } as Logger.Options<unknown>;

    const censored = censorLoggerOptions(options);
    const censoredAnnotations = censored.fiber.getRef(
      References.CurrentLogAnnotations
    );

    expect(censored.message).toEqual({
      password: CENSORED_LOG_VALUE,
      safe: CENSORED_LOG_VALUE,
    });
    expect(censoredAnnotations.request).toEqual({
      headers: { authorization: CENSORED_LOG_VALUE },
    });
    expect(censoredAnnotations.sessionToken).toBe(CENSORED_LOG_VALUE);
    expect(annotations.sessionToken).toBe("session-secret");
  });

  test("redacts identifier annotation keys", () => {
    const annotations = {
      session: "public-session",
      sessionId: "ph-session",
    };
    const options = {
      message: "safe",
      logLevel: "Info",
      cause: Cause.empty,
      date: new Date(0),
      fiber: {
        id: 1,
        getRef: (ref: unknown) =>
          ref === References.CurrentLogAnnotations ? annotations : [],
      },
    } as Logger.Options<unknown>;

    const censored = censorLoggerOptions(options);
    const censoredAnnotations = censored.fiber.getRef(
      References.CurrentLogAnnotations
    );

    expect(censoredAnnotations.session).toBe(CENSORED_LOG_VALUE);
    expect(censoredAnnotations.sessionId).toBe(CENSORED_LOG_VALUE);
  });

  test("recursively censors params emitted by Drizzle EffectLogger", async () => {
    let capturedParams: unknown;
    const captureLogger = Logger.make((options) => {
      capturedParams = censorLoggerOptions(options).fiber.getRef(
        References.CurrentLogAnnotations
      ).params;
    });

    await Effect.runPromise(
      Effect.gen(function* () {
        const logger = yield* EffectLogger;
        yield* logger.logQuery("select $1, $2, $3", [
          "visible",
          { email: "private@example.com", sessionDuration: 123 },
          42,
        ]);
      }).pipe(
        Effect.provide(
          Layer.merge(EffectLogger.layer, Logger.layer([captureLogger]))
        )
      )
    );

    expect(capturedParams).toEqual([
      `"${CENSORED_LOG_VALUE}"`,
      `{"email":"${CENSORED_LOG_VALUE}","sessionDuration":"${CENSORED_LOG_VALUE}"}`,
      `"${CENSORED_LOG_VALUE}"`,
    ]);
  });
});

describe("createCensoredOtelLogger", () => {
  test("redacts Effect log options before emitting OTel logs", async () => {
    const exporter = new InMemoryLogRecordExporter();
    const provider = new LoggerProvider({
      processors: [new SimpleLogRecordProcessor(exporter)],
    });

    await Effect.runPromise(
      Effect.logInfo("safe message").pipe(
        Effect.annotateLogs({
          sessionId: "posthog-session-id",
          token: "secret-token",
        }),
        Effect.provide(Logger.layer([createCensoredOtelLogger(provider)]))
      )
    );
    await provider.forceFlush();

    const record = exporter.getFinishedLogRecords()[0];

    expect(record?.body).toBe(CENSORED_LOG_VALUE);
    expect(record?.severityNumber).toBe(9);
    expect(record?.severityText).toBe("info");
    expect(record?.attributes).toMatchObject({
      sessionId: CENSORED_LOG_VALUE,
      token: CENSORED_LOG_VALUE,
    });
    await provider.shutdown();
  });

  test("does not emit sensitive fields from Drizzle query errors", async () => {
    const exporter = new InMemoryLogRecordExporter();
    const provider = new LoggerProvider({
      processors: [new SimpleLogRecordProcessor(exporter)],
    });
    const error = new EffectDrizzleQueryError({
      query: "select * from customers where email = $1",
      params: [{ email: "private@example.com", sessionDuration: 123 }],
      cause: new Error("driver echoed private@example.com"),
    });

    await Effect.runPromise(
      Effect.logError("query failed", { cause: error }).pipe(
        Effect.provide(Logger.layer([createCensoredOtelLogger(provider)]))
      )
    );
    await provider.forceFlush();

    const serialized = JSON.stringify(exporter.getFinishedLogRecords()[0]);
    expect(serialized).toContain("category");
    expect(serialized).not.toContain("private@example.com");
    expect(serialized).not.toContain("Failed query");
    await provider.shutdown();
  });
});

describe("createCensoredOtelSpanExporter", () => {
  test("rejects valid-format dynamic names and benign attributes everywhere", async () => {
    const exporter = new InMemorySpanExporter();
    const provider = new BasicTracerProvider({
      resource: resourceFromAttributes({
        "service.name": "SyntheticValidServiceName",
        "telemetry.sdk.name": "SyntheticValidSdkName",
        detail: "SyntheticValidResourceValue",
      }),
      spanProcessors: [
        new SimpleSpanProcessor(createCensoredOtelSpanExporter(exporter)),
      ],
    });
    const tracer = provider.getTracer("closed-projection-test");
    const span = tracer.startSpan("SyntheticValidSpanName", {
      attributes: { detail: "SyntheticValidSpanValue" },
      links: [
        {
          context: {
            traceId: "1".repeat(32),
            spanId: "2".repeat(16),
            traceFlags: 1,
          },
          attributes: { visible: "SyntheticValidLinkValue" },
        },
      ],
    });
    span.addEvent("SyntheticValidEventName", {
      response: "SyntheticValidEventValue",
    });
    span.end();

    const [exported] = exporter.getFinishedSpans();
    const serialized = JSON.stringify({
      name: exported?.name,
      attributes: exported?.attributes,
      events: exported?.events,
      links: exported?.links,
      resource: exported?.resource.attributes,
    });

    expect(serialized).not.toContain("SyntheticValid");
    expect(exported?.name).toBe("operation");
    await provider.shutdown();
  });

  test("applies the shared telemetry censorship policy to span data", async () => {
    const exporter = new InMemorySpanExporter();
    const privateValue = "private@example.com";
    const provider = new BasicTracerProvider({
      resource: resourceFromAttributes({
        email: privateValue,
        "service.name": "censorship-test",
        sessionDuration: 456,
      }),
      spanProcessors: [
        new SimpleSpanProcessor(createCensoredOtelSpanExporter(exporter)),
      ],
    });

    await Effect.runPromise(
      Effect.fail(new Error(privateValue)).pipe(
        Effect.withSpan("safe.operation", {
          attributes: {
            email: privateValue,
            sessionDuration: 123,
          },
        }),
        Effect.exit,
        Effect.provide(
          createTracingLive({
            provider,
            serviceName: "censorship-test",
          })
        )
      )
    );

    const [span] = exporter.getFinishedSpans();
    expect(span?.attributes).toMatchObject({
      email: CENSORED_LOG_VALUE,
      sessionDuration: CENSORED_LOG_VALUE,
    });
    expect(span?.events[0]?.name).toBe("exception");
    expect(span?.resource.attributes).toMatchObject({
      email: CENSORED_LOG_VALUE,
      "service.name": CENSORED_LOG_VALUE,
      sessionDuration: CENSORED_LOG_VALUE,
    });
    const serialized = JSON.stringify({
      attributes: span?.attributes,
      events: span?.events,
      resource: span?.resource.attributes,
      status: span?.status,
    });
    expect(serialized).toContain(CENSORED_LOG_VALUE);
    expect(serialized).not.toContain(privateValue);
    await provider.shutdown();
  });
});
