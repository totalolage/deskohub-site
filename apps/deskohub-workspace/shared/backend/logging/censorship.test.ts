import { describe, expect, test } from "bun:test";
import { context, createTraceState, trace } from "@opentelemetry/api";
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
import { parse } from "@typescript-eslint/parser";
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

  test("drops dynamic keys as well as values from every supported container", () => {
    const dynamicKey = "SyntheticValidDynamicTelemetryKey";
    const value = "SyntheticValidDynamicTelemetryValue";
    const projected = [
      censorLogValue({ [dynamicKey]: value }),
      censorLogValue(new Map([[dynamicKey, value]])),
      censorLogValue(new Headers([[dynamicKey, value]])),
      censorLogValue(new URLSearchParams([[dynamicKey, value]])),
    ];
    const serialized = JSON.stringify(projected);

    expect(serialized).not.toContain(dynamicKey);
    expect(serialized).not.toContain(value);
    expect(projected).toEqual([
      {},
      { shape: "object", fieldCount: 1 },
      { shape: "object", fieldCount: 1 },
      { shape: "object", fieldCount: 1 },
    ]);
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

    expect(censored).toEqual({});
    expect(input.nested.apiKey).toBe("secret-api-key");
    expect(input.credentials[0]?.password).toBe("secret-password");
  });

  test("redacts telemetry-shaped name keys in ordinary payloads", () => {
    expect(
      censorLogValue({
        "service.name": "private customer value",
        "telemetry.sdk.name": "private provider value",
      })
    ).toEqual({});
  });

  test("handles cycles while preserving the censored cycle shape", () => {
    const input: { name: string; self?: unknown; token?: string } = {
      name: "cycle",
      token: "secret-token",
    };
    input.self = input;

    const censored = censorLogValue(input);

    expect(censored).not.toBe(input);
    expect(censored).toEqual({});
  });

  test("projects every query parameter closed", () => {
    const input = {
      params: [
        "visible",
        { email: "private@example.com", sessionDuration: 123 },
      ],
    };

    expect(censorLogValue(input)).toEqual({});
    expect(censorLogValue(input.params)).toEqual({
      shape: "array",
      fieldCount: 2,
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

    const censored = censorLogValue(input);

    expect(censored).toEqual({ shape: "object", fieldCount: 8 });
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
    expect(censorLogValue(headers)).toEqual({
      shape: "object",
      fieldCount: 4,
    });
    expect(headers.get("authorization")).toBe("Bearer secret");
    expect(censorLogValue(searchParams)).toEqual({
      shape: "object",
      fieldCount: 5,
    });
    expect(searchParams.get("client_secret")).toBe("secret-client");
    expect(
      censorLogValue({
        headers,
        searchParams,
        plain: { payStateRef: "opaque-secret" },
      })
    ).toEqual({});
  });
});

describe("censorLoggerOptions", () => {
  test("projects fail, die, aggregate, primitive, custom, and nested logger causes closed", () => {
    const sentinel = "SYNTHETIC-LOGGER-CAUSE-SENTINEL";
    class CustomFailure extends Error {}
    const causes = Cause.fromReasons([
      Cause.makeFailReason(sentinel),
      Cause.makeFailReason(
        new AggregateError(
          [
            new CustomFailure(sentinel, {
              cause: { detail: sentinel },
            }),
            42,
          ],
          sentinel
        )
      ),
      Cause.makeDieReason(
        new Error(sentinel, {
          cause: {
            _tag: "NestedDefect",
            cause: sentinel,
          },
        })
      ),
    ]);
    const options = {
      message: "code-owned message",
      logLevel: "Error",
      cause: causes,
      date: new Date(0),
      fiber: {
        id: 1,
        getRef: () => [],
      },
    } as Logger.Options<unknown>;

    const projected = censorLoggerOptions(options);

    expect(JSON.stringify(projected.cause)).not.toContain(sentinel);
    expect(projected.cause).not.toBe(causes);
  });

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

    expect(censored.message).toEqual({});
    expect(censoredAnnotations).toEqual({});
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

    expect(censoredAnnotations).toEqual({});
  });

  test("recursively censors params emitted by Drizzle EffectLogger", async () => {
    let capturedAnnotations: unknown;
    const captureLogger = Logger.make((options) => {
      capturedAnnotations = censorLoggerOptions(options).fiber.getRef(
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
          Layer.merge(EffectLogger.layer, Logger.layer([captureLogger]))
        )
      )
    );

    expect(capturedAnnotations).toEqual({});
  });
});

type SyntaxNode = {
  readonly type: string;
  readonly [key: string]: unknown;
};

const isSyntaxNode = (value: unknown): value is SyntaxNode =>
  typeof value === "object" &&
  value !== null &&
  "type" in value &&
  typeof value.type === "string";

const getIdentifierName = (value: unknown) =>
  isSyntaxNode(value) &&
  value.type === "Identifier" &&
  typeof value.name === "string"
    ? value.name
    : undefined;

const getStringLiteral = (value: unknown) =>
  isSyntaxNode(value) &&
  value.type === "Literal" &&
  typeof value.value === "string"
    ? value.value
    : undefined;

const getObjectOperation = (value: unknown) => {
  if (
    !isSyntaxNode(value) ||
    value.type !== "ObjectExpression" ||
    !Array.isArray(value.properties)
  ) {
    return undefined;
  }

  for (const property of value.properties) {
    if (
      !isSyntaxNode(property) ||
      property.type !== "Property" ||
      (getIdentifierName(property.key) ?? getStringLiteral(property.key)) !==
        "operation"
    ) {
      continue;
    }

    return getStringLiteral(property.value);
  }

  return undefined;
};

const workspaceBoundaryWrappers = new Set([
  "defineWorkspaceAction",
  "defineWorkspaceRoute",
  "defineWorkspaceStateAction",
]);
const workspaceBoundaryCallNames = [
  "runWorkspaceEffect",
  "defineWorkspaceTask",
  ...workspaceBoundaryWrappers,
];

const getWorkspaceBoundaryOperation = (node: SyntaxNode) => {
  if (
    node.type !== "CallExpression" ||
    !Array.isArray(node.arguments) ||
    node.arguments.length === 0
  ) {
    return undefined;
  }

  const calleeName = getIdentifierName(node.callee);
  if (
    calleeName === "runWorkspaceEffect" ||
    calleeName === "defineWorkspaceTask"
  ) {
    return getStringLiteral(node.arguments[0]);
  }
  if (calleeName && workspaceBoundaryWrappers.has(calleeName)) {
    return getObjectOperation(node.arguments[0]);
  }

  return undefined;
};

const visitSyntaxTree = (
  value: unknown,
  visit: (node: SyntaxNode) => void
): void => {
  if (Array.isArray(value)) {
    for (const item of value) visitSyntaxTree(item, visit);
    return;
  }
  if (!isSyntaxNode(value)) return;

  visit(value);
  for (const [key, child] of Object.entries(value)) {
    if (key !== "type") visitSyntaxTree(child, visit);
  }
};

describe("production runWorkspaceEffect operation names", () => {
  test("keeps every literal production operation in the closed allowlist", async () => {
    const workspaceRoot = new URL("../../../", import.meta.url).pathname;
    const sourceFiles = new Bun.Glob(
      "{app,features,shared}/**/*.{ts,tsx}"
    ).scan({
      cwd: workspaceRoot,
      absolute: true,
      onlyFiles: true,
    });
    const operations = new Set<string>();

    for await (const sourceFile of sourceFiles) {
      const relativePath = sourceFile.slice(workspaceRoot.length);
      if (
        relativePath.includes(".test.") ||
        relativePath.includes(".typecheck.") ||
        relativePath.startsWith("e2e/") ||
        relativePath.includes("/e2e/")
      ) {
        continue;
      }
      const source = await Bun.file(sourceFile).text();
      if (
        !workspaceBoundaryCallNames.some((callName) =>
          source.includes(callName)
        )
      ) {
        continue;
      }
      const syntaxTree = parse(source, {
        jsx: relativePath.endsWith(".tsx"),
        sourceType: "module",
      });

      visitSyntaxTree(syntaxTree, (node) => {
        const operation = getWorkspaceBoundaryOperation(node);
        if (operation) operations.add(operation);
      });
    }

    const missing = [...operations]
      .filter(
        (operation) =>
          (
            censorLogValue({ operation }) as {
              readonly operation?: unknown;
            }
          ).operation !== operation
      )
      .sort();

    expect(missing).toEqual([]);
    expect(
      censorLogValue({ operation: "synthetic.dynamic.operation" })
    ).toEqual({
      operation: CENSORED_LOG_VALUE,
    });
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

    expect(record?.body).toEqual({ shape: "array", fieldCount: 1 });
    expect(record?.severityNumber).toBe(9);
    expect(record?.severityText).toBe("info");
    expect(record?.attributes).toEqual({});
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
    expect(serialized).toContain("fieldCount");
    expect(serialized).not.toContain("private@example.com");
    expect(serialized).not.toContain("Failed query");
    await provider.shutdown();
  });
});

describe("createCensoredOtelSpanExporter", () => {
  test("rejects valid-format dynamic names and benign attributes everywhere", async () => {
    const exporter = new InMemorySpanExporter();
    const provider = new BasicTracerProvider({
      resource: resourceFromAttributes(
        {
          "service.name": "SyntheticValidServiceName",
          "telemetry.sdk.name": "SyntheticValidSdkName",
          detail: "SyntheticValidResourceValue",
        },
        { schemaUrl: "https://SyntheticValidResourceSchema.test" }
      ),
      spanProcessors: [
        new SimpleSpanProcessor(createCensoredOtelSpanExporter(exporter)),
      ],
    });
    const tracer = provider.getTracer("closed-projection-test");
    const traceState = createTraceState(
      "syntheticvalidtracestate=dynamicvalue"
    );
    const parentContext = {
      traceId: "3".repeat(32),
      spanId: "4".repeat(16),
      traceFlags: 1,
      traceState,
    };
    const span = tracer.startSpan(
      "SyntheticValidSpanName",
      {
        attributes: { detail: "SyntheticValidSpanValue" },
        links: [
          {
            context: {
              traceId: "1".repeat(32),
              spanId: "2".repeat(16),
              traceFlags: 1,
              traceState,
            },
            attributes: { visible: "SyntheticValidLinkValue" },
          },
        ],
      },
      trace.setSpanContext(context.active(), parentContext)
    );
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
      resourceSchemaUrl: exported?.resource.schemaUrl,
    });

    expect(serialized).not.toContain("SyntheticValid");
    expect(exported?.name).toBe("operation");
    expect(exported?.parentSpanContext?.traceState).toBeUndefined();
    expect(exported?.links[0]?.context.traceState).toBeUndefined();
    expect(exported?.spanContext().traceState).toBeUndefined();
    expect(exported?.resource.schemaUrl).toBeUndefined();
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
    expect(span?.attributes).toEqual({});
    expect(span?.events[0]?.name).toBe("exception");
    expect(span?.resource.attributes).toEqual({});
    const serialized = JSON.stringify({
      attributes: span?.attributes,
      events: span?.events,
      resource: span?.resource.attributes,
      status: span?.status,
    });
    expect(serialized).not.toContain(privateValue);
    await provider.shutdown();
  });
});
