import { describe, expect, mock, test } from "bun:test";
import { runInNewContext } from "node:vm";
import { DotyposUnavailable } from "@deskohub/dotypos";
import { testEmailAddress } from "@deskohub/test-email";
import { SeverityNumber } from "@opentelemetry/api-logs";
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
import { Cause, Data, Effect, Logger, References } from "effect";
import { SqlError } from "effect/unstable/sql";
import { createTracingLive } from "../observability/telemetry-sinks";

const syntheticEmail = testEmailAddress("synthetic");
const adaEmail = testEmailAddress("ada");
const privateEmail = testEmailAddress("private");
const exampleHost = "example.com";

import { CENSORED_LOG_VALUE } from "@/shared/utils/log-classification";
import {
  censorDatabaseQueryParams,
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

  test("redacts nested normalized discount-code request keys", () => {
    const value = censorLogValue({
      envelope: {
        requestedDiscountCode: " summer50 ",
        submittedCode: "summer50",
        checkoutSessionId: "safe-session-id",
      },
    });

    expect(value).toEqual({
      envelope: {
        requestedDiscountCode: CENSORED_LOG_VALUE,
        submittedCode: CENSORED_LOG_VALUE,
        checkoutSessionId: "safe-session-id",
      },
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
      recipient: syntheticEmail,
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
        email: adaEmail,
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

  // Nesting costs heap rather than call stack, so a deeply nested request or
  // webhook payload still gets censored instead of overflowing the stack.
  const supportedNestingDepth = 5000;

  test("censors records nested thousands of levels deep", () => {
    type NestedRecord = {
      readonly token: string;
      readonly next?: NestedRecord;
    };
    let input: NestedRecord = { token: "secret-token" };
    for (let level = 1; level < supportedNestingDepth; level += 1) {
      input = { token: "secret-token", next: input };
    }

    let censored = censorLogValue(input) as NestedRecord;
    let levels = 1;
    while (censored.next) {
      expect(censored.token).toBe(CENSORED_LOG_VALUE);
      censored = censored.next;
      levels += 1;
    }

    expect(levels).toBe(supportedNestingDepth);
    expect(censored).toEqual({ token: CENSORED_LOG_VALUE });
  });

  test("censors arrays nested thousands of levels deep", () => {
    let input: unknown = { token: "secret-token" };
    for (let level = 0; level < supportedNestingDepth; level += 1) {
      input = [input];
    }

    let censored = censorLogValue(input);
    let levels = 0;
    while (Array.isArray(censored)) {
      censored = censored[0];
      levels += 1;
    }

    expect(levels).toBe(supportedNestingDepth);
    expect(censored).toEqual({ token: CENSORED_LOG_VALUE });
  });

  test("redacts sensitive fields inside query params without hiding safe values", () => {
    const input = {
      params: ["visible", { email: privateEmail, sessionDuration: 123 }],
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

  test("projects Drizzle query errors to their tag, parameter count, and censored cause", () => {
    const error = new EffectDrizzleQueryError({
      query:
        "select * from customers where id = $1 and email = /* deskohub:sensitive */ $2",
      params: ["visible", { email: privateEmail, sessionDuration: 123 }],
      cause: new Error(`driver echoed ${privateEmail}`),
    });

    const censored = censorLogValue({ cause: error });
    const serialized = JSON.stringify(censored);

    expect(censored).toEqual({
      cause: {
        _tag: "EffectDrizzleQueryError",
        parameterCount: 2,
        cause: expect.objectContaining({
          errorType: "Error",
          message: CENSORED_LOG_VALUE,
        }),
      },
    });
    expect(serialized).not.toContain("from customers");
    expect(serialized).not.toContain("visible");
    expect(serialized).not.toContain(privateEmail);
    expect(serialized).not.toContain("Failed query");
  });

  test("retains recursively censored Effect SQL causes", () => {
    const privateValue = testEmailAddress("private");
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

  test("keeps the SQLSTATE of a database failure a queue error wraps", () => {
    const privateValue = testEmailAddress("queue-private");
    class QueueTestScheduleError extends Data.TaggedError(
      "QueueTestScheduleError"
    )<{ readonly message: string; readonly cause: unknown }> {}
    const error = new QueueTestScheduleError({
      message: "Queued reservation hold cleanup state could not be loaded.",
      cause: new EffectDrizzleQueryError({
        query: "select /* deskohub:sensitive */ $1",
        params: [privateValue],
        cause: Cause.fail(
          new SqlError.SqlError({
            reason: new SqlError.AuthenticationError({
              cause: Object.assign(
                new Error(`password authentication failed for ${privateValue}`),
                { code: "28P01" }
              ),
              message: `Failed to acquire connection for ${privateValue}`,
              operation: "acquireConnection",
            }),
          })
        ),
      }),
    });

    const serialized = JSON.stringify(censorLogValue({ cause: error }));

    expect(serialized).toContain("QueueTestScheduleError");
    expect(serialized).toContain("EffectDrizzleQueryError");
    expect(serialized).toContain("AuthenticationError");
    expect(serialized).toContain("acquireConnection");
    expect(serialized).toContain("28P01");
    expect(serialized).not.toContain("[object Object]");
    expect(serialized).not.toContain(privateValue);
  });

  test("projects errors with recursively censored causes", () => {
    const error = new Error("boom");
    error.cause = new Error("nested private value");
    const aggregate = new AggregateError(
      [
        new Error("aggregate member private value"),
        "aggregate scalar private value",
        { payload: "aggregate object private value" },
      ],
      "aggregate private value",
      { cause: new Error("aggregate cause private value") }
    );
    const date = new Date("2026-05-30T00:00:00.000Z");
    const set = new Set(["secret"]);
    const custom = new CustomValue("secret");
    const promise = Promise.resolve("secret");

    const input = { thrown: error, aggregate, date, set, custom, promise };
    const censored = censorLogValue(input) as typeof input;

    expect(censored.thrown).toMatchObject({
      errorType: "Error",
      message: CENSORED_LOG_VALUE,
      cause: {
        errorType: "Error",
        message: CENSORED_LOG_VALUE,
      },
    });
    expect(censored.aggregate).toMatchObject({
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
        CENSORED_LOG_VALUE,
        CENSORED_LOG_VALUE,
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
    expect(JSON.stringify(censored)).not.toContain(
      "aggregate scalar private value"
    );
    expect(JSON.stringify(censored)).not.toContain(
      "aggregate object private value"
    );
  });

  test("retains stack frames while redacting recursive error messages", () => {
    const privateValue = testEmailAddress("private");
    const multilineMessage = `${privateValue}\n    at /${privateValue}:8:9`;
    const nested = new Error(privateValue);
    nested.stack = `Error: ${privateValue}\n    at nestedFailure (/app/nested.ts:2:3)`;
    const error = new Error(privateValue, { cause: nested });
    error.stack = `Error: ${privateValue}\n    at outerFailure (/app/outer.ts:4:5)`;

    expect(censorLogValue(error)).toEqual({
      errorType: "Error",
      message: CENSORED_LOG_VALUE,
      stack: `${CENSORED_LOG_VALUE}\n    at /app/outer.ts:4:5`,
      cause: {
        errorType: "Error",
        message: CENSORED_LOG_VALUE,
        stack: `${CENSORED_LOG_VALUE}\n    at /app/nested.ts:2:3`,
      },
    });
    expect(
      censorLogValue({
        "exception.message": multilineMessage,
        "exception.stacktrace": `Error: ${multilineMessage}\n    at tracedFailure (https://${privateValue}:${privateValue}@${exampleHost}/app.js?code=${privateValue}#${privateValue}:6:7)\n    at relativeFailure (/admin/cli/authenticate?code=${privateValue}#${privateValue}:8:9)\n    at fileFailure (file:///app/file.js?token=${privateValue}:10:11)\n    at mappedFailure (turbopack:///[project]/app/page.ts?token=${privateValue}:12:13)\n    at malformedUrl (https://user:${privateValue}@exa mple.com/app.js:14:15)\n    at malformedRelativeUrl (//user:${privateValue}@exa mple.com/app.js:16:17)`,
      })
    ).toEqual({
      "exception.message": CENSORED_LOG_VALUE,
      "exception.stacktrace": `${CENSORED_LOG_VALUE}\n    at https://example.com/app.js:6:7\n    at /admin/cli/authenticate:8:9\n    at file:///app/file.js:10:11\n    at turbopack:///[project]/app/page.ts:12:13`,
    });

    const sqlError = new SqlError.SqlError({
      reason: new SqlError.UnknownError({
        cause: new Error(privateValue),
        message: privateValue,
        operation: "acquireConnection",
      }),
    });
    expect(
      (censorLogValue(sqlError) as { readonly stack: string }).stack
    ).toContain("censorship.test.ts");

    const staleMessageError = new Error(multilineMessage);
    const staleStack = staleMessageError.stack;
    staleMessageError.message = "replacement";
    staleMessageError.stack = staleStack;
    expect(censorLogValue(staleMessageError)).toMatchObject({
      stack: CENSORED_LOG_VALUE,
    });
    staleMessageError.message = "";
    expect(censorLogValue(staleMessageError)).toMatchObject({
      stack: CENSORED_LOG_VALUE,
    });
  });

  test("retains only safe error classification fields", () => {
    const privateValue = testEmailAddress("private");
    const error = Object.assign(new Error(privateValue), {
      _tag: "CalendarSaleConfigurationError",
      reason: "invalid_event",
      operation: "normalize",
      code: "INVALID_EVENT",
      outcome: "uncertain",
      failureCode: "fulfillment_access_failed",
      errorCode: "nexi_webhook_verification_failed",
      eventReference: privateValue,
      issue: { actual: privateValue },
    });

    const censored = censorLogValue({ cause: error });

    expect(censored).toMatchObject({
      cause: {
        errorType: "Error",
        message: CENSORED_LOG_VALUE,
        _tag: "CalendarSaleConfigurationError",
        reason: "invalid_event",
        operation: "normalize",
        code: "INVALID_EVENT",
        outcome: "uncertain",
        failureCode: "fulfillment_access_failed",
        errorCode: "nexi_webhook_verification_failed",
      },
    });
    expect(JSON.stringify(censored)).not.toContain(privateValue);

    const dynamicClassifications = Object.assign(new Error(privateValue), {
      _tag: privateValue,
      reason: `invalid ${privateValue}`,
      operation: `load ${privateValue}`,
      code: privateValue,
      outcome: { email: privateValue },
      failureCode: `failed ${privateValue}`,
      errorCode: `error ${privateValue}`,
      status: `status ${privateValue}`,
      statusCode: privateValue,
      constraint: `constraint ${privateValue}`,
    });
    const dynamicCensored = censorLogValue(dynamicClassifications);
    expect(dynamicCensored).toMatchObject(
      Object.fromEntries(
        Object.keys(dynamicClassifications).map((key) => [
          key,
          CENSORED_LOG_VALUE,
        ])
      )
    );
    expect(JSON.stringify(dynamicCensored)).not.toContain(privateValue);
  });

  test("filters an error name like its other classification fields", () => {
    const privateValue = testEmailAddress("private");
    const named = Object.assign(new Error("synthetic"), {
      name: privateValue,
    });
    const classified = Object.assign(new Error("synthetic"), {
      name: "RequestHeadersError",
    });

    const censored = censorLogValue({ named, classified });

    expect(censored).toMatchObject({
      named: { errorType: CENSORED_LOG_VALUE },
      classified: { errorType: "RequestHeadersError" },
    });
    expect(JSON.stringify(censored)).not.toContain(privateValue);
  });

  test("retains the classification fields of a logged Dotypos outcome", () => {
    const privateValue = testEmailAddress("private");
    const failure = new DotyposUnavailable({
      operation: "getCustomersByIds",
      request: "customers.page",
      reason: "server",
      httpStatus: 503,
      message: privateValue,
      cause: { email: privateValue },
    });

    const censored = censorLogValue({ cause: failure });

    expect(censored).toMatchObject({
      cause: {
        _tag: "DotyposUnavailable",
        reason: "server",
        operation: "getCustomersByIds",
        request: "customers.page",
        httpStatus: 503,
      },
    });
    expect(JSON.stringify(censored)).not.toContain(privateValue);
  });

  test("projects native errors from another realm", () => {
    const error = runInNewContext('new Error("cross-realm private value")');

    expect(error).not.toBeInstanceOf(Error);
    expect(censorLogValue(error)).toMatchObject({
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
      expect(censorLogValue(new Error("private value"))).toMatchObject({
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

  test("redacts sensitive protocol-relative URL query params", () => {
    expect(
      censorLogValue(`//${exampleHost}/pay?token=secret&visible=safe#summary`)
    ).toBe(
      `//${exampleHost}/pay?token=${encodeURIComponent(CENSORED_LOG_VALUE)}&visible=safe#summary`
    );
  });

  test("keeps non-HTTP, unparseable and query-free strings unchanged", () => {
    expect(censorLogValue(`ftp://${exampleHost}/file?visible=safe`)).toBe(
      `ftp://${exampleHost}/file?visible=safe`
    );
    expect(censorLogValue("http://exa mple.com/?visible=safe")).toBe(
      "http://exa mple.com/?visible=safe"
    );
    expect(censorLogValue("plain operational text")).toBe(
      "plain operational text"
    );
  });

  test("strips credentials and queries from protocol-relative stack frames", () => {
    const privateValue = testEmailAddress("private");

    expect(
      censorLogValue({
        message: "safe",
        stack: `Error: safe\n    at cdnFailure (//user:${privateValue}@${exampleHost}/app.js?token=${privateValue}:1:2)`,
      })
    ).toEqual({
      message: CENSORED_LOG_VALUE,
      stack: `${CENSORED_LOG_VALUE}\n    at //${exampleHost}/app.js:1:2`,
    });
  });

  test("censors JSON and URL strings inside database query parameters", () => {
    expect(
      censorDatabaseQueryParams("select $1, $2, $3", [
        JSON.stringify({ email: privateEmail, visible: "safe" }),
        "/pay?token=secret&visible=safe",
        "not json",
      ])
    ).toEqual([
      JSON.stringify({ email: CENSORED_LOG_VALUE, visible: "safe" }),
      `/pay?token=${encodeURIComponent(CENSORED_LOG_VALUE)}&visible=safe`,
      "not json",
    ]);
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
      ["filter", `email|like|${testEmailAddress("customer")}`],
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

  test("censors Drizzle failures stored in the logger cause", () => {
    const privateValue = testEmailAddress("private");
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

    expect(serialized).toContain("EffectDrizzleQueryError");
    expect(serialized).toContain(CENSORED_LOG_VALUE);
    expect(serialized).not.toContain("from customers");
    expect(serialized).not.toContain("safe-customer-id");
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

    expect(serialized).toContain("EffectDrizzleQueryError");
    expect(serialized).toContain(CENSORED_LOG_VALUE);
    expect(serialized).not.toContain("pgp_sym_encrypt");
    expect(serialized).not.toContain("safe-attempt-id");
    expect(serialized).not.toContain("aes256");
    expect(serialized).not.toContain(privateValue);
    expect(serialized).not.toContain("accounting storage failed");
    expect(serialized).not.toContain("driver echoed");
  });

  test("censors a defect that is not an error whole", () => {
    const privateValue = "private-defect-payload";
    const options = {
      message: "action failed",
      logLevel: "Error",
      cause: Cause.die({ attrs: { title: privateValue } }),
      date: new Date(0),
      fiber: {
        id: 1,
        getRef: () => [],
      },
    } as Logger.Options<unknown>;

    const serialized = JSON.stringify(censorLoggerOptions(options).cause);

    expect(serialized).toContain(CENSORED_LOG_VALUE);
    expect(serialized).not.toContain(privateValue);
  });
});

describe("createCensoredOtelLogger", () => {
  test("redacts Effect log options before emitting OTel logs", async () => {
    const exporter = new InMemoryLogRecordExporter();
    const provider = new LoggerProvider({
      processors: [new SimpleLogRecordProcessor({ exporter })],
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

  test.each([
    ["Fatal", SeverityNumber.FATAL, "fatal"],
    ["Error", SeverityNumber.ERROR, "error"],
    ["Warn", SeverityNumber.WARN, "warn"],
    ["Info", SeverityNumber.INFO, "info"],
    ["Debug", SeverityNumber.DEBUG, "debug"],
    ["Trace", SeverityNumber.TRACE, "trace"],
  ] as const)(
    "emits a %s log with its OTel severity",
    async (level, severityNumber, severityText) => {
      const exporter = new InMemoryLogRecordExporter();
      const provider = new LoggerProvider({
        processors: [new SimpleLogRecordProcessor({ exporter })],
      });

      await Effect.runPromise(
        Effect.logWithLevel(level)("safe message").pipe(
          Effect.provideService(References.MinimumLogLevel, "All"),
          Effect.provide(Logger.layer([createCensoredOtelLogger(provider)]))
        )
      );
      await provider.forceFlush();

      const [record] = exporter.getFinishedLogRecords();
      expect(record?.severityNumber).toBe(severityNumber);
      expect(record?.severityText).toBe(severityText);
      await provider.shutdown();
    }
  );

  test("serializes structured and unserializable OTel attributes", async () => {
    const exporter = new InMemoryLogRecordExporter();
    const provider = new LoggerProvider({
      processors: [new SimpleLogRecordProcessor({ exporter })],
    });

    await Effect.runPromise(
      Effect.logInfo("safe message").pipe(
        Effect.annotateLogs({
          attempts: 10n,
          details: { token: "secret-token", visible: "safe" },
        }),
        Effect.provide(Logger.layer([createCensoredOtelLogger(provider)]))
      )
    );
    await provider.forceFlush();

    expect(exporter.getFinishedLogRecords()[0]?.attributes).toMatchObject({
      attempts: "10",
      details: JSON.stringify({ token: CENSORED_LOG_VALUE, visible: "safe" }),
    });
    await provider.shutdown();
  });

  test("does not emit sensitive fields from Drizzle query errors", async () => {
    const exporter = new InMemoryLogRecordExporter();
    const provider = new LoggerProvider({
      processors: [new SimpleLogRecordProcessor({ exporter })],
    });
    const error = new EffectDrizzleQueryError({
      query:
        "select * from customers where id = $1 and email = /* deskohub:sensitive */ $2",
      params: ["safe-customer-id", privateEmail],
      cause: new Error(`driver echoed ${privateEmail}`),
    });

    await Effect.runPromise(
      Effect.logError("query failed", { cause: error }).pipe(
        Effect.provide(Logger.layer([createCensoredOtelLogger(provider)]))
      )
    );
    await provider.forceFlush();

    const serialized = JSON.stringify(exporter.getFinishedLogRecords()[0]);
    expect(serialized).toContain("EffectDrizzleQueryError");
    expect(serialized).toContain(CENSORED_LOG_VALUE);
    expect(serialized).not.toContain("from customers");
    expect(serialized).not.toContain("safe-customer-id");
    expect(serialized).not.toContain(privateEmail);
    expect(serialized).not.toContain("Failed query");
    await provider.shutdown();
  });
});

describe("createCensoredOtelSpanExporter", () => {
  test("flushes through the wrapped exporter when it can flush", async () => {
    const forceFlush = mock(() => Promise.resolve());
    const exporter = createCensoredOtelSpanExporter({
      export: () => undefined,
      forceFlush,
      shutdown: () => Promise.resolve(),
    });

    await exporter.forceFlush?.();

    expect(forceFlush).toHaveBeenCalledTimes(1);
  });

  test("flushes at once when the wrapped exporter can't flush", async () => {
    const exporter = createCensoredOtelSpanExporter({
      export: () => undefined,
      shutdown: () => Promise.resolve(),
    });

    expect(await exporter.forceFlush?.()).toBeUndefined();
  });

  test("applies the shared telemetry censorship policy to span data", async () => {
    const exporter = new InMemorySpanExporter();
    const privateValue = testEmailAddress("private");
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
    expect(span?.events[0]?.attributes?.["exception.stacktrace"]).toContain(
      "censorship.test.ts"
    );
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

describe("censorLogValue structure", () => {
  const censoredParam = encodeURIComponent(CENSORED_LOG_VALUE);

  test("keeps array holes and censors a shared array once", () => {
    const shared = ["/pay?token=secret"];
    const sparse: unknown[] = [];
    sparse[0] = shared;
    sparse[2] = shared;

    const censored = censorLogValue(sparse) as unknown[];

    expect(censored).toHaveLength(3);
    expect(1 in censored).toBe(false);
    expect(censored[0]).toEqual([`/pay?token=${censoredParam}`]);
    expect(censored[2]).toBe(censored[0]);
  });

  test("censors Map values by string keys only and keeps a Map cycle", () => {
    const objectKey = { token: "kept-as-key" };
    const input = new Map<unknown, unknown>([
      ["token", "secret"],
      [7, { token: "secret" }],
      [objectKey, "visible"],
    ]);
    input.set("self", input);

    const censored = censorLogValue(input) as Map<unknown, unknown>;

    expect(censored.get("token")).toBe(CENSORED_LOG_VALUE);
    expect(censored.get(7)).toEqual({ token: CENSORED_LOG_VALUE });
    expect(censored.get(objectKey)).toBe("visible");
    expect(censored.get("self")).toBe(censored);
  });

  test("censors shared Headers and URLSearchParams once each", () => {
    const headers = new Headers({ cookie: "secret", accept: "text/html" });
    const search = new URLSearchParams({ token: "secret", page: "2" });

    const censored = censorLogValue({
      first: [headers, search],
      second: [headers, search],
    }) as Record<"first" | "second", readonly [Headers, URLSearchParams]>;

    expect(censored.second[0]).toBe(censored.first[0]);
    expect(censored.second[1]).toBe(censored.first[1]);
    expect(censored.first[0].get("cookie")).toBe(CENSORED_LOG_VALUE);
    expect(censored.first[0].get("accept")).toBe("text/html");
    expect(censored.first[1].toString()).toBe(`token=${censoredParam}&page=2`);
  });

  test("passes primitives and non-plain objects through unchanged", () => {
    const date = new Date(0);
    const custom = new CustomValue("kept by reference");
    const callback = () => "secret";
    const symbol = Symbol("secret");

    expect(censorLogValue(date)).toBe(date);
    expect(censorLogValue(custom)).toBe(custom);
    expect(censorLogValue(callback)).toBe(callback);
    expect(censorLogValue(symbol)).toBe(symbol);
    expect(censorLogValue(12n)).toBe(12n);
    expect(censorLogValue(Number.NaN)).toBeNaN();
    expect(censorLogValue(true)).toBe(true);
    expect(censorLogValue(null)).toBeNull();
    expect(censorLogValue(undefined)).toBeUndefined();
  });

  test("censors a null-prototype object like a plain one", () => {
    const input = Object.assign(Object.create(null) as object, {
      token: "secret",
      visible: "/pay?secret=1",
    });

    expect(censorLogValue(input)).toEqual({
      token: CENSORED_LOG_VALUE,
      visible: `/pay?secret=${censoredParam}`,
    });
  });

  test("censors a plain object's params by its own query", () => {
    expect(
      censorLogValue({
        query: "select $1, /* deskohub:sensitive */ $2",
        params: ["visible", "private"],
      })
    ).toEqual({
      query: "select $1, /* deskohub:sensitive */ $2",
      params: ["visible", CENSORED_LOG_VALUE],
    });
    expect(censorLogValue({ query: 7, params: ["visible", "kept"] })).toEqual({
      query: 7,
      params: ["visible", "kept"],
    });
    expect(censorLogValue({ params: { token: "secret" } })).toEqual({
      params: { token: CENSORED_LOG_VALUE },
    });
  });

  test("censors a shared params array once", () => {
    const params = ["visible"];

    const censored = censorLogValue({
      first: { params },
      second: { params },
    }) as Record<"first" | "second", { readonly params: unknown }>;

    expect(censored.second.params).toBe(censored.first.params);
  });

  test("keeps only structured or plain causes", () => {
    expect(censorLogValue({ cause: "private text" })).toEqual({
      cause: CENSORED_LOG_VALUE,
    });
    expect(censorLogValue({ cause: { token: "secret", step: "a" } })).toEqual({
      cause: { token: CENSORED_LOG_VALUE, step: "a" },
    });
    expect(censorLogValue({ cause: new CustomValue("secret") })).toEqual({
      cause: CENSORED_LOG_VALUE,
    });
  });

  test("reads a record's stack against its exception message first", () => {
    const frame = "    at run (/srv/app.js:1:2)";
    const keptFrame = "    at /srv/app.js:1:2";

    expect(
      censorLogValue({
        "exception.message": "outer",
        message: "inner",
        "exception.stacktrace": `Error: outer\n${frame}`,
      })
    ).toEqual({
      "exception.message": CENSORED_LOG_VALUE,
      message: CENSORED_LOG_VALUE,
      "exception.stacktrace": `${CENSORED_LOG_VALUE}\n${keptFrame}`,
    });
    expect(
      censorLogValue({ message: "inner", Stack: `Error: inner\n${frame}` })
    ).toEqual({
      message: CENSORED_LOG_VALUE,
      Stack: `${CENSORED_LOG_VALUE}\n${keptFrame}`,
    });
    expect(censorLogValue({ message: 7, stack: `Error: 7\n${frame}` })).toEqual(
      { message: CENSORED_LOG_VALUE, stack: CENSORED_LOG_VALUE }
    );
    expect(censorLogValue({ message: "inner", stacktrace: 7 })).toEqual({
      message: CENSORED_LOG_VALUE,
      stacktrace: CENSORED_LOG_VALUE,
    });
  });

  test("censors a shared or cyclic error once", () => {
    const error = new Error("private") as Error & { self?: unknown };
    error.cause = error;

    const censored = censorLogValue([error, error]) as Array<{
      readonly cause: unknown;
    }>;

    expect(censored[1]).toBe(censored[0]);
    expect(censored[0]?.cause).toBe(censored[0]);
  });

  test("reads only an error's own data properties", () => {
    const error = new Error("private");
    Object.defineProperty(error, "code", { get: () => "ACCESSOR" });
    Object.defineProperty(error, "status", { value: 503 });
    Object.defineProperty(error, "stack", { get: () => "Error: private" });
    Object.defineProperty(error, "errors", { get: () => [new Error("x")] });

    expect(censorLogValue(error)).toEqual({
      errorType: "Error",
      message: CENSORED_LOG_VALUE,
      status: 503,
    });
  });

  test("drops a non-string error stack and keeps a missing cause out", () => {
    const error = new Error("private");
    Object.defineProperty(error, "stack", { value: 7 });

    const censored = censorLogValue(error);

    expect(censored).toEqual({
      errorType: "Error",
      message: CENSORED_LOG_VALUE,
    });
    expect(Object.keys(censored as object)).toEqual(["errorType", "message"]);
  });

  test("keeps an aggregate error's structured errors only", () => {
    const error = new AggregateError(
      [new TypeError("first"), { token: "secret" }, "text"],
      "private"
    );
    Object.defineProperty(error, "stack", { value: undefined });

    expect(censorLogValue(error)).toEqual({
      errorType: "AggregateError",
      message: CENSORED_LOG_VALUE,
      errors: [
        {
          errorType: "TypeError",
          message: CENSORED_LOG_VALUE,
          stack: expect.any(String),
        },
        CENSORED_LOG_VALUE,
        CENSORED_LOG_VALUE,
      ],
    });
  });

  test("ignores a non-array errors property", () => {
    const error = new Error("private");
    Object.defineProperty(error, "stack", { value: undefined });
    Object.defineProperty(error, "errors", { value: "not a list" });

    expect(censorLogValue(error)).toEqual({
      errorType: "Error",
      message: CENSORED_LOG_VALUE,
    });
  });

  test("censors a shared Drizzle query error once", () => {
    const error = new EffectDrizzleQueryError({
      query: "select $1",
      params: ["visible"],
      cause: new Error("private"),
    });

    const censored = censorLogValue([error, error]) as unknown[];

    expect(censored[1]).toBe(censored[0]);
    expect(censored[0]).toMatchObject({
      _tag: "EffectDrizzleQueryError",
      parameterCount: 1,
    });
  });
});

describe("censorLogValue URL strings", () => {
  const censoredParam = encodeURIComponent(CENSORED_LOG_VALUE);

  test.each([
    [
      "an absolute HTTPS URL",
      "https://example.com/a?token=x&page=1#top",
      `https://example.com/a?token=${censoredParam}&page=1#top`,
    ],
    [
      "an absolute HTTP URL",
      "http://example.com/?secret=x",
      `http://example.com/?secret=${censoredParam}`,
    ],
    ["a mailto URL", "mailto:someone?subject=x", "mailto:someone?subject=x"],
    [
      "a query-only URL",
      "?state=x&page=1#top",
      `?state=${censoredParam}&page=1#top`,
    ],
    ["a path-relative URL without a query", "/a/b#top", "/a/b#top"],
    [
      "a protocol-relative URL without a query",
      "//example.com/a",
      "//example.com/a",
    ],
    [
      "a bare relative URL with a query",
      "a/b?filter=x",
      `a/b?filter=${censoredParam}`,
    ],
    ["a bare word", "just-text", "just-text"],
    ["an unparseable relative URL", "//[bad?token=x", "//[bad?token=x"],
  ])("handles %s", (_case, input, output) => {
    expect(censorLogValue(input)).toBe(output);
  });
});

describe("censorLogValue stack traces", () => {
  const stackOf = (message: string, stack: string) =>
    (censorLogValue({ message, stack }) as { readonly stack: unknown }).stack;

  test("keeps frames after an empty message with no message marker", () => {
    expect(stackOf("", "Error\n    at run (/srv/app.js:1:2)")).toBe(
      `${CENSORED_LOG_VALUE}\n    at /srv/app.js:1:2`
    );
  });

  test("keeps frames after a first line without a message marker", () => {
    expect(stackOf("other", "Boom\n    at run (/srv/app.js:1:2)")).toBe(
      `${CENSORED_LOG_VALUE}\n    at /srv/app.js:1:2`
    );
  });

  test("censors a stack whose first line is not followed by frames", () => {
    expect(stackOf("other", "Boom\nmore text")).toBe(CENSORED_LOG_VALUE);
    expect(stackOf("other", "Boom")).toBe(CENSORED_LOG_VALUE);
  });

  test("censors a stack whose message does not match", () => {
    expect(stackOf("other", "Error: private\n    at /srv/app.js:1:2")).toBe(
      CENSORED_LOG_VALUE
    );
  });

  test("censors a stack whose message runs past the first line", () => {
    expect(stackOf("private", "Error: private text\n    at /a.js:1:2")).toBe(
      CENSORED_LOG_VALUE
    );
  });

  test("keeps only frames with a known source location", () => {
    const stack = [
      "Error: private",
      "    at /srv/app.js:1:2",
      "    at C:\\app\\main.js:3:4",
      "    at run (file:///srv/app.js?v=1:5:6)",
      "    at node:internal/process:7:8",
      "    at webpack:///./src/a.js:9:10",
      "    at https://user:pw@example.com/a.js#x:11:12",
      "    at anonymous (native)",
      "    at relative/path.js:13:14",
      "    at http://[bad/a.js:15:16",
      "not a frame",
    ].join("\n");

    expect(stackOf("private", stack)).toBe(
      [
        CENSORED_LOG_VALUE,
        "    at /srv/app.js:1:2",
        "    at C:\\app\\main.js:3:4",
        "    at file:///srv/app.js:5:6",
        "    at node:internal/process:7:8",
        "    at webpack:///src/a.js:9:10",
        "    at https://example.com/a.js:11:12",
      ].join("\n")
    );
  });

  test("censors a stack with no kept frames to the marker alone", () => {
    expect(
      stackOf("private", "Error: private\n    at anonymous (native)")
    ).toBe(CENSORED_LOG_VALUE);
  });
});
