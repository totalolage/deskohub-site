import "@/shared/testing/workspace-test-env";

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { Context, Effect, Layer } from "effect";
import {
  createWorkspaceEnv,
  env,
  getAccountingDocumentSnapshotSecret,
} from "@/env";
import {
  signedStandardWebhookRequest,
  standardWebhookSigningSecret,
} from "@/shared/backend/webhooks/standard-webhook-signature.test-utils";

const webhookUrl = "https://workspace.test/api/webhooks/posthog";

let configuredSigningSecret: string | undefined;

mock.module("@/env", () => ({
  createWorkspaceEnv,
  env: new Proxy(env, {
    get: (target, key) =>
      key === "POSTHOG_EMAIL_WEBHOOK_SIGNING_SECRET"
        ? configuredSigningSecret
        : Reflect.get(target, key),
  }),
  getAccountingDocumentSnapshotSecret,
}));

const pollSummary = {
  outcome: "polled",
  trigger: "signal",
  polled: 3,
  settled: 2,
  expired: 0,
} as const;

let pollTriggers: string[] = [];
let pollResult: Effect.Effect<unknown, Error> = Effect.succeed(pollSummary);

const FakePolling = Context.Service<
  FakePolling,
  { readonly poll: (trigger: string) => Effect.Effect<unknown, Error> }
>()("@test/FakePostHogEmailDeliveryPolling");

Object.assign(FakePolling, {
  Live: Layer.succeed(FakePolling, {
    poll: (trigger) =>
      Effect.suspend(() => {
        pollTriggers.push(trigger);
        return pollResult;
      }),
  }),
});

mock.module("@/shared/backend/email/posthog-email-delivery-polling", () => ({
  PostHogEmailDeliveryPolling: FakePolling,
}));

const { GET, POST } = await import("./route");

interface WebhookResponseBody {
  readonly message?: string;
  readonly status?: string;
  readonly reason?: string;
  readonly error?: string;
  readonly code?: string;
}

const send = async (request: Request) => {
  const response = await POST(request);
  return {
    status: response.status,
    body: (await response.json()) as WebhookResponseBody,
  };
};

const signedRequest = (
  options: Partial<Parameters<typeof signedStandardWebhookRequest>[0]> = {}
) =>
  signedStandardWebhookRequest({
    url: webhookUrl,
    secret: configuredSigningSecret ?? standardWebhookSigningSecret(),
    body: JSON.stringify({ event: { event: "$messaging_email_delivered" } }),
    ...options,
  });

beforeEach(() => {
  configuredSigningSecret = standardWebhookSigningSecret();
  pollTriggers = [];
  pollResult = Effect.succeed(pollSummary);
});

describe("PostHog email webhook route", () => {
  test("polls pending deliveries once for a signed request", async () => {
    const { status, body } = await send(signedRequest());

    expect(status).toBe(200);
    expect(body).toEqual({ message: "Webhook received", status: "polled" });
    expect(pollTriggers).toEqual(["signal"]);
  });

  test("ignores what the signed payload says", async () => {
    const { status } = await send(signedRequest({ body: "not json" }));

    expect(status).toBe(200);
    expect(pollTriggers).toEqual(["signal"]);
  });

  test("reports which limit stopped the poll", async () => {
    pollResult = Effect.succeed({ ...pollSummary, stoppedBy: "rate-limited" });

    const { body } = await send(signedRequest());

    expect(body).toEqual({
      message: "Webhook received",
      status: "polled",
      reason: "rate-limited",
    });
  });

  test("reports that delivery polling is not configured", async () => {
    pollResult = Effect.succeed({ outcome: "not-configured" });

    const { status, body } = await send(signedRequest());

    expect(status).toBe(200);
    expect(body).toEqual({
      message: "Webhook received",
      status: "not-configured",
    });
  });

  test.each([
    [
      "signed with another secret",
      () => signedRequest({ secret: standardWebhookSigningSecret() }),
      "posthog_webhook_verification_failed",
    ],
    [
      "signed more than five minutes ago",
      () => signedRequest({ signedAt: new Date(Date.now() - 301_000) }),
      "posthog_webhook_verification_failed",
    ],
    [
      "without a webhook-id header",
      () => signedRequest({ headers: { "webhook-id": undefined } }),
      "posthog_webhook_headers_missing",
    ],
    [
      "without a webhook-timestamp header",
      () => signedRequest({ headers: { "webhook-timestamp": undefined } }),
      "posthog_webhook_headers_missing",
    ],
    [
      "without a webhook-signature header",
      () => signedRequest({ headers: { "webhook-signature": undefined } }),
      "posthog_webhook_headers_missing",
    ],
  ])(
    "answers 401 without polling to a request %s",
    async (_, request, code) => {
      const { status, body } = await send(request());

      expect(status).toBe(401);
      expect(body.code).toBe(code);
      expect(pollTriggers).toEqual([]);
    }
  );

  test.each([
    ["missing", undefined],
    ["blank", "  "],
    ["not a base64 key", "whsec_not base64!"],
  ])(
    "answers a bare 500 so PostHog retries while the signing secret is %s",
    async (_, secret) => {
      const request = signedRequest({ secret: standardWebhookSigningSecret() });
      configuredSigningSecret = secret;

      const { status, body } = await send(request);

      expect(status).toBe(500);
      // Only the generic error: the caller learns nothing of the setup.
      expect(Object.keys(body)).toEqual(["error"]);
      expect(pollTriggers).toEqual([]);
    }
  );

  test("tells an unsigned caller nothing when no signing secret is configured", async () => {
    configuredSigningSecret = undefined;

    const { status, body } = await send(
      new Request(webhookUrl, { method: "POST", body: "{}" })
    );

    expect(status).toBe(500);
    expect(Object.keys(body)).toEqual(["error"]);
    expect(pollTriggers).toEqual([]);
  });

  test("answers 500 without polling when the request body cannot be read", async () => {
    const signed = signedRequest();
    const request = new Request(signed.url, {
      method: "POST",
      headers: signed.headers,
      body: new ReadableStream({
        start: (controller) => controller.error(new Error("connection reset")),
      }),
    });

    const { status, body } = await send(request);

    expect(status).toBe(500);
    expect(body.code).toBe("posthog_webhook_body_unreadable");
    expect(pollTriggers).toEqual([]);
  });

  test("answers 500 so PostHog retries when the poll fails", async () => {
    pollResult = Effect.fail(new Error("database unavailable"));

    const { status, body } = await send(signedRequest());

    expect(status).toBe(500);
    expect(body.error).toBe("PostHog webhook processing failed");
  });

  test("answers a health check", async () => {
    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "ok",
      endpoint: "/api/webhooks/posthog",
    });
  });
});
