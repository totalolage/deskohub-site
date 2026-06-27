import { describe, expect, test } from "bun:test";
import {
  InMemoryLogRecordExporter,
  LoggerProvider,
  SimpleLogRecordProcessor,
} from "@opentelemetry/sdk-logs";
import { Cause, Effect, Logger, References } from "effect";
import {
  CENSORED_LOG_VALUE,
  censorLoggerOptions,
  censorLogValue,
  createCensoredOtelLogger,
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
    expect(isSensitiveLogKey("session")).toBe(false);
    expect(isSensitiveLogKey("sessionId")).toBe(false);
    expect(isSensitiveLogKey("sessionDuration")).toBe(false);
    expect(isSensitiveLogKey("userSessionCount")).toBe(false);
    expect(isSensitiveLogKey("apiKeyDisplayName")).toBe(true);
    expect(isSensitiveLogKey("authorizationHeaderLabel")).toBe(false);
  });
});

describe("censorLogValue", () => {
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
      user: "deskohub",
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
        name: CENSORED_LOG_VALUE,
        message: CENSORED_LOG_VALUE,
        errorDescription: CENSORED_LOG_VALUE,
        visible: "safe",
        email: CENSORED_LOG_VALUE,
        phone: CENSORED_LOG_VALUE,
        firstName: CENSORED_LOG_VALUE,
        lastName: CENSORED_LOG_VALUE,
        sessionDuration: 123,
        userSessionCount: 2,
      },
      credentials: [{ password: CENSORED_LOG_VALUE, name: CENSORED_LOG_VALUE }],
    });
    expect(input.nested.apiKey).toBe("secret-api-key");
    expect(input.credentials[0]?.password).toBe("secret-password");
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

  test("preserves non-plain objects", () => {
    const error = new Error("boom");
    const date = new Date("2026-05-30T00:00:00.000Z");
    const set = new Set(["secret"]);
    const custom = new CustomValue("secret");
    const promise = Promise.resolve("secret");

    const input = { thrown: error, date, set, custom, promise };
    const censored = censorLogValue(input) as typeof input;

    expect(censored).toEqual(input);
    expect(censored.thrown).toBe(error);
    expect(censored.date).toBe(date);
    expect(censored.set).toBe(set);
    expect(censored.custom).toBe(custom);
    expect(censored.promise).toBe(promise);
    expect((censorLogValue(error) as Error).message).toBe("boom");
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
    expect(censored.get("sessionDuration")).toBe(123);
    expect(censored.get("nested")).toEqual({ apiKey: CENSORED_LOG_VALUE });
    expect(censored.get(objectKey)).toBe("visible");
    expect(input.get("password")).toBe("secret-password");
    expect(input.get("headers:authorization")).toBe("Bearer secret");
    expect(input.get("payState")).toBe("pay-state-secret");
    expect(input.get("payStateRef")).toBe("pay-state-ref-secret");
    expect(input.get("checkoutToken")).toBe("checkout-token-secret");
    expect(input.get("nested")).toEqual({ apiKey: "secret-api-key" });
  });

  test("redacts sensitive relative URL query params", () => {
    expect(
      censorLogValue(
        "/en-US/checkout/pay?payState=secret&payStateRef=ref&checkoutToken=token&visible=safe#summary"
      )
    ).toBe(
      `/en-US/checkout/pay?payState=${encodeURIComponent(CENSORED_LOG_VALUE)}&payStateRef=${encodeURIComponent(CENSORED_LOG_VALUE)}&checkoutToken=${encodeURIComponent(CENSORED_LOG_VALUE)}&visible=safe#summary`
    );
  });

  test("redacts sensitive bare relative URL query params", () => {
    expect(
      censorLogValue(
        "checkout/pay?payState=secret&checkoutToken=token&visible=safe#summary"
      )
    ).toBe(
      `checkout/pay?payState=${encodeURIComponent(CENSORED_LOG_VALUE)}&checkoutToken=${encodeURIComponent(CENSORED_LOG_VALUE)}&visible=safe#summary`
    );
  });

  test("redacts bare relative URL query params case-insensitively", () => {
    expect(
      censorLogValue("checkout/pay?PayState=secret&CHECKOUTTOKEN=token")
    ).toBe(
      `checkout/pay?PayState=${encodeURIComponent(CENSORED_LOG_VALUE)}&CHECKOUTTOKEN=${encodeURIComponent(CENSORED_LOG_VALUE)}`
    );
  });

  test("redacts production-observed name and message URL query params", () => {
    expect(
      censorLogValue("contact?name=Ada&message=Private&visible=safe")
    ).toBe(
      `contact?name=${encodeURIComponent(CENSORED_LOG_VALUE)}&message=${encodeURIComponent(CENSORED_LOG_VALUE)}&visible=safe`
    );
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
    expect(censored.headers.get("x-visible")).toBe("safe");
    expect(headers.get("authorization")).toBe("Bearer secret");
    expect(censored.searchParams).not.toBe(searchParams);
    expect(censored.searchParams.get("client_secret")).toBe(CENSORED_LOG_VALUE);
    expect(censored.searchParams.get("payState")).toBe(CENSORED_LOG_VALUE);
    expect(censored.searchParams.get("PayStateRef")).toBe(CENSORED_LOG_VALUE);
    expect(censored.searchParams.get("checkoutToken")).toBe(CENSORED_LOG_VALUE);
    expect(censored.searchParams.get("sessionDuration")).toBe("123");
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
      safe: "visible",
    });
    expect(censoredAnnotations.request).toEqual({
      headers: { authorization: CENSORED_LOG_VALUE },
    });
    expect(censoredAnnotations.sessionToken).toBe(CENSORED_LOG_VALUE);
    expect(annotations.sessionToken).toBe("session-secret");
  });

  test("preserves observable session annotation keys", () => {
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

    expect(censoredAnnotations.session).toBe("public-session");
    expect(censoredAnnotations.sessionId).toBe("ph-session");
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

    expect(record?.body).toBe("safe message");
    expect(record?.severityNumber).toBe(9);
    expect(record?.severityText).toBe("info");
    expect(record?.attributes).toMatchObject({
      sessionId: "posthog-session-id",
      token: CENSORED_LOG_VALUE,
    });
    await provider.shutdown();
  });
});
