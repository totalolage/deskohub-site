import { afterEach, describe, expect, mock, test } from "bun:test";
import type { AnyValue, LogRecord } from "@opentelemetry/api-logs";
import { Data, Effect } from "effect";
import * as workspaceEnv from "@/env";

const emittedLogRecords: LogRecord[] = [];
const nextServer = await import("next/server");

// Outside a Next request, scheduling the telemetry flush would log a warning.
mock.module("next/server", () => ({ ...nextServer, after: () => undefined }));
mock.module("@/instrumentation", () => ({
  postHogLoggerProvider: {
    forceFlush: () => Promise.resolve(),
    getLogger: () => ({
      emit: (record: LogRecord) => {
        emittedLogRecords.push(record);
      },
    }),
  },
}));

const cronSecret = "test-cron-secret";
let cronEnv: {
  readonly CRON_SECRET: string | undefined;
  readonly VERCEL_ENV: string;
} = { CRON_SECRET: cronSecret, VERCEL_ENV: "production" };

mock.module("@/env", () => ({
  ...workspaceEnv,
  env: new Proxy(workspaceEnv.env, {
    get: (target, key) =>
      key === "CRON_SECRET" || key === "VERCEL_ENV"
        ? cronEnv[key]
        : Reflect.get(target, key),
  }),
}));

const { defineWebhookRoute, defineWorkspaceCron, WebhookRefusal } =
  await import("./service-route");

class TestJobError extends Data.TaggedError("TestJobError")<{
  readonly message: string;
}> {}

const severities = (operation: string) =>
  emittedLogRecords
    .filter(({ attributes }) => attributes?.operation === operation)
    .map(({ severityText }) => severityText);

// The logger serializes structured log values to JSON strings.
const parseLogged = (value: AnyValue | undefined) => JSON.parse(String(value));

/** The structured fields passed beside the message of the first match. */
const fieldsAt = (operation: string, severity: string) => {
  const record = emittedLogRecords.find(
    ({ attributes, severityText }) =>
      attributes?.operation === operation && severityText === severity
  );
  return Array.isArray(record?.body) ? parseLogged(record.body[1]) : undefined;
};

const cronRequest = (authorization?: string) =>
  new Request("https://workspace.test/api/cron/workspace/test", {
    headers: authorization ? { authorization } : {},
  });

afterEach(() => {
  emittedLogRecords.length = 0;
  cronEnv = { CRON_SECRET: cronSecret, VERCEL_ENV: "production" };
});

describe("Workspace cron routes", () => {
  const defineCountingCron = (operation: string) => {
    const runs: { readonly limit: number }[] = [];
    const GET = defineWorkspaceCron({
      operation,
      failureMessage: "Test job failed",
      input: () => ({ limit: 25 }),
      run: (input) =>
        Effect.sync(() => {
          runs.push(input);
          return { swept: 3 };
        }),
    });
    return { GET, runs };
  };

  test("rejects a request without the cron secret as a warning", async () => {
    const { GET, runs } = defineCountingCron("test.cron.missing");

    const response = await GET(cronRequest());

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(runs).toHaveLength(0);
    expect(severities("test.cron.missing")).toEqual(["warn"]);
  });

  test("rejects a wrong bearer secret", async () => {
    const { GET, runs } = defineCountingCron("test.cron.wrong");

    const wrong = await GET(cronRequest("Bearer not-the-secret"));
    const bare = await GET(cronRequest(cronSecret));

    expect([wrong.status, bare.status]).toEqual([401, 401]);
    expect(runs).toHaveLength(0);
  });

  test("runs without a secret only in development", async () => {
    const { GET, runs } = defineCountingCron("test.cron.development");

    cronEnv = { CRON_SECRET: undefined, VERCEL_ENV: "preview" };
    const preview = await GET(cronRequest());
    cronEnv = { CRON_SECRET: undefined, VERCEL_ENV: "development" };
    const development = await GET(cronRequest());

    expect(preview.status).toBe(401);
    expect(development.status).toBe(200);
    expect(runs).toHaveLength(1);
  });

  test("answers the job's summary and logs its input and result", async () => {
    const { GET, runs } = defineCountingCron("test.cron.summary");

    const response = await GET(cronRequest(`Bearer ${cronSecret}`));

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('{"swept":3}');
    expect(runs).toEqual([{ limit: 25 }]);
    expect(severities("test.cron.summary")).toEqual(["info", "info"]);
    const [started, completed] = emittedLogRecords.filter(
      ({ attributes }) => attributes?.operation === "test.cron.summary"
    );
    expect(parseLogged(started?.attributes?.input)).toEqual({ limit: 25 });
    expect(started?.attributes).not.toHaveProperty("result");
    expect(parseLogged(completed?.attributes?.input)).toEqual({ limit: 25 });
    expect(parseLogged(completed?.attributes?.result)).toEqual({ swept: 3 });
  });

  test("runs a job without input", async () => {
    const GET = defineWorkspaceCron({
      operation: "test.cron.no-input",
      failureMessage: "Test job failed",
      run: () => Effect.succeed({ planned: 1 }),
    });

    const response = await GET(cronRequest(`Bearer ${cronSecret}`));

    await expect(response.json()).resolves.toEqual({ planned: 1 });
  });

  test("answers 500 with the failure message and logs the failure as an error", async () => {
    const GET = defineWorkspaceCron({
      operation: "test.cron.failure",
      failureMessage: "Test job failed",
      run: () => Effect.fail(new TestJobError({ message: "private cause" })),
    });

    const response = await GET(cronRequest(`Bearer ${cronSecret}`));
    const body = await response.text();

    expect(response.status).toBe(500);
    expect(JSON.parse(body)).toEqual({ error: "Test job failed" });
    expect(body).not.toContain("private cause");
    expect(severities("test.cron.failure")).toEqual(["info", "error"]);
  });
});

describe("Webhook routes", () => {
  const webhookRequest = () =>
    new Request("https://workspace.test/api/webhooks/test", { method: "POST" });

  test("answers only a receipt's status and reason after the message", async () => {
    const POST = defineWebhookRoute(
      { operation: "test.webhook.receipt", failureMessage: "Test failed" },
      () =>
        Effect.succeed({
          orderId: "private-order",
          reason: "unknown event",
          status: "ignored",
        })
    );

    const response = await POST(webhookRequest());

    expect(response.status).toBe(200);
    expect(await response.text()).toBe(
      '{"message":"Webhook received","status":"ignored","reason":"unknown event"}'
    );
  });

  test.each([
    {
      disposition: { kind: "declined", severity: "fatal" },
      status: 202,
      logs: ["fatal"],
    },
    {
      disposition: { kind: "rejected", status: 400, severity: "error" },
      status: 400,
      logs: ["error"],
    },
    {
      disposition: { kind: "rejected", status: 401, severity: "warning" },
      status: 401,
      logs: ["warn"],
    },
    {
      disposition: { kind: "retry", severity: "error" },
      status: 500,
      logs: ["error", "warn"],
    },
    {
      disposition: { kind: "retry", severity: "fatal" },
      status: 500,
      logs: ["fatal", "warn"],
    },
  ] as const)(
    "answers a $disposition.kind refusal with $status and logs $logs",
    async ({ disposition, status, logs }) => {
      const operation = `test.webhook.${disposition.kind}.${status}.${disposition.severity}`;
      const POST = defineWebhookRoute(
        { operation, failureMessage: "Test failed" },
        () =>
          Effect.fail(
            new WebhookRefusal({
              disposition,
              code: "test_code",
              details: { eventId: "event-1" },
              cause: new TestJobError({ message: "private cause" }),
            })
          )
      );

      const response = await POST(webhookRequest());
      const body = await response.text();

      expect(response.status).toBe(status);
      expect(body).toBe(
        '{"error":"Webhook processing failed","code":"test_code"}'
      );
      expect(severities(operation)).toEqual([...logs]);
      const failure = fieldsAt(operation, logs[0]);
      expect(failure).toMatchObject({
        errorCode: "test_code",
        eventId: "event-1",
      });
      expect(failure).toHaveProperty("cause");
      if (disposition.kind === "retry") {
        expect(fieldsAt(operation, "warn")).toEqual({
          errorCode: "test_code",
          eventId: "event-1",
        });
      }
    }
  );

  test("answers a refusal's own public message and detail", async () => {
    const POST = defineWebhookRoute(
      { operation: "test.webhook.detail", failureMessage: "Test failed" },
      () =>
        Effect.fail(
          new WebhookRefusal({
            disposition: { kind: "rejected", status: 401, severity: "warning" },
            publicMessage: "Unauthorized",
            publicDetail: "Missing signature",
          })
        )
    );

    const response = await POST(webhookRequest());

    expect(response.status).toBe(401);
    expect(await response.text()).toBe(
      '{"error":"Unauthorized","message":"Missing signature"}'
    );
  });

  test("answers an unclassified failure with the route's failure message", async () => {
    const POST = defineWebhookRoute(
      { operation: "test.webhook.unclassified", failureMessage: "Test failed" },
      () => Effect.fail(new TestJobError({ message: "private cause" }))
    );

    const response = await POST(webhookRequest());
    const body = await response.text();

    expect(response.status).toBe(500);
    expect(JSON.parse(body)).toEqual({ error: "Test failed" });
    expect(body).not.toContain("private cause");
    expect(severities("test.webhook.unclassified")).toEqual(["error"]);
  });
});
