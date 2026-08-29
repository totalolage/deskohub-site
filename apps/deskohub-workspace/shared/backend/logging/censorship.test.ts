import { describe, expect, test } from "bun:test";
import { runInNewContext } from "node:vm";
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
import { Cause, type Context, Effect, Layer, Logger, References } from "effect";
import * as SqlError from "effect/unstable/sql/SqlError";
import { createTracingLive } from "../observability/otel-tracing";

type LogAnnotations = Context.Service.Shape<
  typeof References.CurrentLogAnnotations
>;

import {
  CENSORED_LOG_VALUE,
  censorDatabaseQueryParams,
  censorLoggerOptions,
  censorLogValue,
  createCensoredOtelLogger,
  createCensoredOtelSpanExporter,
  isSensitiveLogKey,
} from "./censorship";
import { DatabaseQueryLoggerLive } from "./database-query-logger";

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
    expect(isSensitiveLogKey("recipient")).toBe(true);
    expect(isSensitiveLogKey("subject")).toBe(true);
    expect(isSensitiveLogKey("db.namespace")).toBe(true);
    expect(isSensitiveLogKey("server.address")).toBe(true);
    expect(isSensitiveLogKey("billingDetails")).toBe(true);
    expect(isSensitiveLogKey("addressLine1")).toBe(true);
    expect(isSensitiveLogKey("addressLine2")).toBe(true);
    expect(isSensitiveLogKey("companyId")).toBe(true);
    expect(isSensitiveLogKey("vatId")).toBe(true);
    expect(isSensitiveLogKey("postalCode")).toBe(true);
    expect(isSensitiveLogKey("city")).toBe(true);
    expect(isSensitiveLogKey("zip")).toBe(true);
    expect(isSensitiveLogKey("country")).toBe(true);
    expect(isSensitiveLogKey("description")).toBe(true);
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
    expect(isSensitiveLogKey("params")).toBe(false);
    expect(isSensitiveLogKey("apiKeyDisplayName")).toBe(true);
    expect(isSensitiveLogKey("authorizationHeaderLabel")).toBe(false);
  });
});

describe("censorLogValue", () => {
  test("censors billing identities without hiding operational metadata", () => {
    const value = censorLogValue({
      operation: "updateCustomerBillingDetails",
      customerId: "safe-customer-id",
      request: {
        body: {
          addressLine1: "Private street 1",
          addressLine2: "Private unit",
          city: "Private city",
          zip: "12345",
          country: "CZ",
          companyName: "Private company",
          companyId: "12345678",
          vatId: "CZ12345678",
        },
      },
      cause: {
        billingDetails: {
          address: {
            line1: "Private street 1",
            city: "Private city",
            postalCode: "12345",
            country: "CZ",
          },
        },
        safeStatus: 412,
      },
    });

    expect(value).toEqual({
      operation: "updateCustomerBillingDetails",
      customerId: "safe-customer-id",
      request: {
        body: {
          addressLine1: CENSORED_LOG_VALUE,
          addressLine2: CENSORED_LOG_VALUE,
          city: CENSORED_LOG_VALUE,
          zip: CENSORED_LOG_VALUE,
          country: CENSORED_LOG_VALUE,
          companyName: CENSORED_LOG_VALUE,
          companyId: CENSORED_LOG_VALUE,
          vatId: CENSORED_LOG_VALUE,
        },
      },
      cause: { billingDetails: CENSORED_LOG_VALUE, safeStatus: 412 },
    });
  });

  test("censors email attachment payloads without hiding safe metadata", () => {
    const value = censorLogValue({
      attachments: [
        {
          filename: "WS-FV-2026-000001.pdf",
          content: Buffer.from("private invoice bytes"),
        },
      ],
      recipient: "synthetic@example.test",
      subject: "Invoice for Synthetic Customer",
      invoiceId: "safe-invoice-id",
    });

    expect(value).toEqual({
      attachments: CENSORED_LOG_VALUE,
      recipient: CENSORED_LOG_VALUE,
      subject: CENSORED_LOG_VALUE,
      invoiceId: "safe-invoice-id",
    });
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
        accessCode: "654321",
        pin: "987654321",
        oauthClientSecret: "secret-oauth-client-secret",
        requestAuthorization: "Bearer secret",
        discountCode: "SUMMER50",
        submittedCode: "SUMMER50",
        params: '["SUMMER50"]',
        query: "select * from discount_codes where code = $1",
        discountCodeId: "safe-discount-code-id",
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
        accessCode: CENSORED_LOG_VALUE,
        pin: CENSORED_LOG_VALUE,
        oauthClientSecret: CENSORED_LOG_VALUE,
        requestAuthorization: CENSORED_LOG_VALUE,
        discountCode: CENSORED_LOG_VALUE,
        submittedCode: CENSORED_LOG_VALUE,
        params: '["SUMMER50"]',
        query: "select * from discount_codes where code = $1",
        discountCodeId: "safe-discount-code-id",
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
    type CyclicLogInput = {
      readonly name: string;
      self?: CyclicLogInput;
      readonly token?: string;
    };
    const input = {
      name: "cycle",
      self: undefined as CyclicLogInput | undefined,
      token: "secret-token",
    };
    input.self = input;

    const censored = censorLogValue(input) as typeof input;

    expect(censored).not.toBe(input);
    expect(censored.token).toBe(CENSORED_LOG_VALUE);
    expect(censored.self).toBe(censored);
  });

  test("redacts sensitive fields inside query params without hiding safe values", () => {
    const input = {
      params: [
        "visible",
        { email: "private@example.com", sessionDuration: 123 },
      ],
    };

    expect(censorLogValue(input)).toEqual({
      params: ["visible", { email: CENSORED_LOG_VALUE, sessionDuration: 123 }],
    });
  });

  test("redacts only explicitly sensitive database parameter positions", () => {
    const query =
      "select $1, /* deskohub:sensitive */ $2, $3, /* deskohub:sensitive */ $4";

    expect(
      censorDatabaseQueryParams(query, [
        "visible",
        "private",
        { sessionDuration: 123 },
        "also-private",
      ])
    ).toEqual([
      "visible",
      CENSORED_LOG_VALUE,
      { sessionDuration: 123 },
      CENSORED_LOG_VALUE,
    ]);
  });

  test("projects Drizzle query errors with a censored cause", () => {
    const error = new EffectDrizzleQueryError({
      query:
        "select * from customers where id = $1 and email = /* deskohub:sensitive */ $2",
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
        _tag: "EffectDrizzleQueryError",
        query:
          "select * from customers where id = $1 and email = /* deskohub:sensitive */ $2",
        params: ["visible", CENSORED_LOG_VALUE],
        cause: {
          errorType: "Error",
          message: CENSORED_LOG_VALUE,
        },
      },
    });
    expect(serialized).not.toContain("private@example.com");
    expect(serialized).not.toContain("Failed query");
  });

  test("retains recursively censored Effect SQL causes", () => {
    const privateValue = "private@example.com";
    const driverCause = Object.assign(
      new Error(`driver echoed ${privateValue}`, {
        cause: Object.assign(new Error(`socket echoed ${privateValue}`), {
          code: "ETIMEDOUT",
        }),
      }),
      {
        detail: privateValue,
        hint: privateValue,
        internalQuery: privateValue,
        where: privateValue,
      }
    );
    const error = new EffectDrizzleQueryError({
      query: "select /* deskohub:sensitive */ $1",
      params: [privateValue],
      cause: Cause.fail(
        new SqlError.SqlError({
          reason: new SqlError.UnknownError({
            cause: driverCause,
            message: `acquisition echoed ${privateValue}`,
            operation: "acquireConnection",
          }),
        })
      ),
    });

    const serialized = JSON.stringify(censorLogValue({ cause: error }));

    expect(serialized).toContain("EffectDrizzleQueryError");
    expect(serialized).toContain("SqlError");
    expect(serialized).toContain("UnknownError");
    expect(serialized).toContain("acquireConnection");
    expect(serialized).toContain("ETIMEDOUT");
    expect(serialized).toContain(CENSORED_LOG_VALUE);
    expect(serialized).not.toContain(privateValue);
    expect(serialized).not.toContain("driver echoed");
    expect(serialized).not.toContain("socket echoed");
    expect(serialized).not.toContain("acquisition echoed");
  });

  test("projects errors with recursively censored causes", () => {
    const error = new Error("boom");
    error.cause = new Error("nested private value");
    const aggregate = new AggregateError(
      [new Error("aggregate member private value")],
      "aggregate private value",
      { cause: new Error("aggregate cause private value") }
    );
    const date = new Date("2026-05-30T00:00:00.000Z");
    const set = new Set(["secret"]);
    const custom = new CustomValue("secret");
    const promise = Promise.resolve("secret");

    const input = { thrown: error, aggregate, date, set, custom, promise };
    const censored = censorLogValue(input) as typeof input;

    expect(censored.thrown).toEqual({
      errorType: "Error",
      message: CENSORED_LOG_VALUE,
      cause: {
        errorType: "Error",
        message: CENSORED_LOG_VALUE,
      },
    });
    expect(censored.aggregate).toEqual({
      errorType: "AggregateError",
      message: CENSORED_LOG_VALUE,
      cause: {
        errorType: "Error",
        message: CENSORED_LOG_VALUE,
      },
      errors: [
        {
          errorType: "Error",
          message: CENSORED_LOG_VALUE,
        },
      ],
    });
    expect(censored.date).toBe(date);
    expect(censored.set).toBe(set);
    expect(censored.custom).toBe(custom);
    expect(censored.promise).toBe(promise);
    expect(JSON.stringify(censored)).not.toContain("boom");
    expect(JSON.stringify(censored)).not.toContain("nested private value");
    expect(JSON.stringify(censored)).not.toContain("aggregate private value");
    expect(JSON.stringify(censored)).not.toContain(
      "aggregate member private value"
    );
  });

  test("projects native errors from another realm", () => {
    const error = runInNewContext('new Error("cross-realm private value")');

    expect(error).not.toBeInstanceOf(Error);
    expect(censorLogValue(error)).toEqual({
      errorType: "Error",
      message: CENSORED_LOG_VALUE,
    });
  });

  test("projects errors when the runtime does not provide Error.isError", () => {
    const nativeIsError = Error.isError;
    Object.defineProperty(Error, "isError", {
      configurable: true,
      value: undefined,
      writable: true,
    });

    try {
      expect(censorLogValue(new Error("private value"))).toEqual({
        errorType: "Error",
        message: CENSORED_LOG_VALUE,
      });
    } finally {
      Object.defineProperty(Error, "isError", {
        configurable: true,
        value: nativeIsError,
        writable: true,
      });
    }
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
        "/en-US/checkout/pay?payState=secret&payStateRef=ref&checkoutToken=token&discountCode=SUMMER50&submittedCode=SUMMER50&visible=safe#summary"
      )
    ).toBe(
      `/en-US/checkout/pay?payState=${encodeURIComponent(CENSORED_LOG_VALUE)}&payStateRef=${encodeURIComponent(CENSORED_LOG_VALUE)}&checkoutToken=${encodeURIComponent(CENSORED_LOG_VALUE)}&discountCode=${encodeURIComponent(CENSORED_LOG_VALUE)}&submittedCode=${encodeURIComponent(CENSORED_LOG_VALUE)}&visible=safe#summary`
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
      ["filter", "email|like|customer@example.com"],
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
    expect(censored.searchParams.get("filter")).toBe(CENSORED_LOG_VALUE);
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
        getRef: <T>(ref: T) =>
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
        getRef: <T>(ref: T) =>
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

  test("database query logging retains only selectively censored parameters", async () => {
    let capturedAnnotations: LogAnnotations = {};
    const captureLogger = Logger.make((options) => {
      capturedAnnotations = options.fiber.getRef(
        References.CurrentLogAnnotations
      );
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
          Layer.merge(DatabaseQueryLoggerLive, Logger.layer([captureLogger]))
        )
      )
    );

    expect(capturedAnnotations).toEqual({
      params: [
        '"visible"',
        `{"email":"${CENSORED_LOG_VALUE}","sessionDuration":123}`,
        "42",
      ],
      parameterCount: 3,
      query: "select $1, $2, $3",
    });
    expect(JSON.stringify(capturedAnnotations)).toContain("visible");
    expect(JSON.stringify(capturedAnnotations)).not.toContain(
      "private@example.com"
    );
  });

  test("censors Drizzle failures stored in the logger cause", () => {
    const privateValue = "private@example.com";
    const error = new EffectDrizzleQueryError({
      query:
        "select * from customers where id = $1 and email = /* deskohub:sensitive */ $2",
      params: ["safe-customer-id", privateValue],
      cause: new Error(`driver echoed ${privateValue}`),
    });
    const options = {
      message: "query failed",
      logLevel: "Error",
      cause: Cause.fail(error),
      date: new Date(0),
      fiber: {
        id: 1,
        getRef: () => [],
      },
    } as Logger.Options<unknown>;

    const serialized = JSON.stringify(censorLoggerOptions(options).cause);

    expect(serialized).toContain("safe-customer-id");
    expect(serialized).toContain(CENSORED_LOG_VALUE);
    expect(serialized).not.toContain(privateValue);
    expect(serialized).not.toContain("driver echoed");
    expect(serialized).not.toContain("Failed query");
  });

  test("censors Drizzle failures wrapped by a domain error", () => {
    const privateValue = "invoice-key-and-private-buyer";
    const queryError = new EffectDrizzleQueryError({
      query:
        "select $1, pgp_sym_encrypt(/* deskohub:sensitive */ $2, /* deskohub:sensitive */ $3, $4)",
      params: ["safe-attempt-id", privateValue, privateValue, "aes256"],
      cause: new Error(`driver echoed ${privateValue}`),
    });
    const domainError = new Error("accounting storage failed", {
      cause: queryError,
    });
    const options = {
      message: "query failed",
      logLevel: "Error",
      cause: Cause.die(domainError),
      date: new Date(0),
      fiber: {
        id: 1,
        getRef: () => [],
      },
    } as Logger.Options<unknown>;

    const serialized = JSON.stringify(censorLoggerOptions(options).cause);

    expect(serialized).toContain("safe-attempt-id");
    expect(serialized).toContain("aes256");
    expect(serialized).toContain(CENSORED_LOG_VALUE);
    expect(serialized).not.toContain(privateValue);
    expect(serialized).not.toContain("accounting storage failed");
    expect(serialized).not.toContain("driver echoed");
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

  test("does not emit sensitive fields from Drizzle query errors", async () => {
    const exporter = new InMemoryLogRecordExporter();
    const provider = new LoggerProvider({
      processors: [new SimpleLogRecordProcessor(exporter)],
    });
    const error = new EffectDrizzleQueryError({
      query:
        "select * from customers where id = $1 and email = /* deskohub:sensitive */ $2",
      params: ["safe-customer-id", "private@example.com"],
      cause: new Error("driver echoed private@example.com"),
    });

    await Effect.runPromise(
      Effect.logError("query failed", { cause: error }).pipe(
        Effect.provide(Logger.layer([createCensoredOtelLogger(provider)]))
      )
    );
    await provider.forceFlush();

    const serialized = JSON.stringify(exporter.getFinishedLogRecords()[0]);
    expect(serialized).toContain("safe-customer-id");
    expect(serialized).toContain(CENSORED_LOG_VALUE);
    expect(serialized).not.toContain("private@example.com");
    expect(serialized).not.toContain("Failed query");
    await provider.shutdown();
  });
});

describe("createCensoredOtelSpanExporter", () => {
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
            "db.namespace": "private-coordination-database",
            email: privateValue,
            "server.address": "private-provider-endpoint",
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
      "db.namespace": CENSORED_LOG_VALUE,
      email: CENSORED_LOG_VALUE,
      "server.address": CENSORED_LOG_VALUE,
      sessionDuration: 123,
    });
    expect(span?.events[0]?.name).toBe("exception");
    expect(span?.resource.attributes).toMatchObject({
      email: CENSORED_LOG_VALUE,
      "service.name": "censorship-test",
      sessionDuration: 456,
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
