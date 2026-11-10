import { describe, expect, test } from "bun:test";
import type { EmailMessage } from "@deskohub/email";
import { testEmailAddress } from "@deskohub/test-email";
import { Exit } from "effect";
import {
  accepted,
  connection,
  type FakeAnswer,
  failureOf,
  makeFakePostHog,
  type RecordedRequest,
  refused,
  runAgainst,
  successOf,
} from "./posthog-email.test-utils";
import { makePostHogEmailProvider } from "./posthog-email-provider";

const ada = testEmailAddress("ada");
const sender = testEmailAddress("campaigns");

const provider = makePostHogEmailProvider({
  ...connection,
  systemIdentity: "deskohub-email-system",
});

const message: EmailMessage = {
  from: { email: sender, name: "Deskohub" },
  to: { email: ada, name: "Ada" },
  subject: "Spring at the workspace",
  html: "<p>Hello</p>",
  text: "Hello",
  tags: ["email-campaign"],
  idempotencyKey: "campaign-send:42:recipient:7",
  recipientIdentity: "account-distinct-id-7",
};

const production = { VERCEL_ENV: "production" };

const sendOnce = async (
  sent: EmailMessage,
  answer: (index: number, request: RecordedRequest) => FakeAnswer = () =>
    accepted(),
  sending = provider,
  env: Record<string, string> = production
) => {
  const fake = makeFakePostHog(answer);
  const { exit, logs } = await runAgainst(fake, sending.send(sent), env);
  return { exit, logs, requests: fake.requests };
};

describe("PostHog email send request", () => {
  test("sends the rendered message in code mode to the app host with the message's idempotency key", async () => {
    const { exit, requests } = await sendOnce({
      ...message,
      replyTo: { email: testEmailAddress("reply"), name: "Reply Desk" },
      cc: [{ email: testEmailAddress("cc"), name: "Copy" }],
      bcc: { email: testEmailAddress("bcc") },
      headers: { "List-Unsubscribe": "<https://example.test/u>" },
      metadata: { campaignId: "42" },
    });

    expect(successOf(exit)).toMatchObject({
      id: "0197a5e1-1b52-7c4e-9f5a-2d3b4c5d6e7f",
      status: "queued",
      provider: "posthog",
    });
    expect(requests).toHaveLength(1);
    const [request] = requests;
    expect(request?.method).toBe("POST");
    expect(request?.url).toBe(
      "https://eu.posthog.com/api/projects/@current/messaging/send/email/"
    );
    expect(request?.headers.get("authorization")).toBe(
      "Bearer phs_test_secret"
    );
    expect(request?.headers.get("idempotency-key")).toBe(
      "campaign-send:42:recipient:7"
    );
    expect(request?.body).toEqual({
      to: ada,
      template_key: "email-campaign",
      subject: "Spring at the workspace",
      html: "<p>Hello</p>",
      text: "Hello",
      from: `Deskohub <${sender}>`,
      reply_to: [testEmailAddress("reply")],
      cc: [testEmailAddress("cc")],
      bcc: [testEmailAddress("bcc")],
      distinct_id: "account-distinct-id-7",
      capture_engagement: true,
    });
  });

  test("leaves out the content and lists the message does not have", async () => {
    const { requests } = await sendOnce({
      ...message,
      from: { email: sender },
      html: undefined,
    });

    expect(requests[0]?.body).toEqual({
      to: ada,
      template_key: "email-campaign",
      subject: "Spring at the workspace",
      text: "Hello",
      from: sender,
      distinct_id: "account-distinct-id-7",
      capture_engagement: true,
    });
  });

  test("uses the configured sender over the message's", async () => {
    const { requests } = await sendOnce(
      message,
      () => accepted(),
      makePostHogEmailProvider({
        ...connection,
        systemIdentity: "deskohub-email-system",
        from: `Deskohub Campaigns <${sender}>`,
      })
    );

    expect(requests[0]?.body?.from).toBe(`Deskohub Campaigns <${sender}>`);
  });

  test("attributes a message without a recipient identity to the system identity, never to the address", async () => {
    for (const recipientIdentity of [undefined, "", "   "]) {
      const { requests } = await sendOnce({ ...message, recipientIdentity });

      expect(requests[0]?.body?.distinct_id).toBe("deskohub-email-system");
    }
  });

  test("names the template by the message category, limited to the characters PostHog accepts", async () => {
    const cases: readonly [EmailMessage["tags"], string][] = [
      [["email-campaign", "other"], "email-campaign"],
      [["spring sale/2026!"], "spring_sale_2026_"],
      [["x".repeat(450)], "x".repeat(400)],
      [undefined, "email"],
      [[], "email"],
      [[""], "email"],
    ];
    for (const [tags, templateKey] of cases) {
      const { requests } = await sendOnce({ ...message, tags });

      expect(requests[0]?.body?.template_key).toBe(templateKey);
    }
  });

  test("generates one idempotency key for a message without one and keeps it across retries", async () => {
    const { requests } = await sendOnce(
      { ...message, idempotencyKey: undefined },
      (index) =>
        index === 0 ? refused(503, "delivery_unavailable") : accepted()
    );

    expect(requests).toHaveLength(2);
    const key = requests[0]?.headers.get("idempotency-key");
    expect(key).toMatch(/^deskohub-generated:[0-9a-f-]{36}$/);
    expect(requests[1]?.headers.get("idempotency-key")).toBe(key ?? "");
  });

  test("digests a key PostHog cannot carry into a stable prefixed key", async () => {
    for (const idempotencyKey of ["has spaces", "k".repeat(256)]) {
      const first = await sendOnce({ ...message, idempotencyKey });
      const second = await sendOnce({ ...message, idempotencyKey });
      const key = first.requests[0]?.headers.get("idempotency-key");

      expect(key).toMatch(/^deskohub-sha256:[0-9a-f]{64}$/);
      expect(second.requests[0]?.headers.get("idempotency-key")).toBe(
        key ?? ""
      );
    }
  });
});

describe("PostHog email messages it cannot carry", () => {
  test("refuses attachments before any request, for every provider", async () => {
    const { exit, requests } = await sendOnce({
      ...message,
      attachments: [{ filename: "invoice.pdf", content: "JVBERi0=" }],
    });

    expect(requests).toHaveLength(0);
    expect(failureOf(exit)).toMatchObject({
      _tag: "EmailServiceError",
      failureKind: "message",
      code: "attachments_unsupported",
      provider: "posthog",
    });
  });

  test("hands messages with more recipients than PostHog takes to the next provider before any request", async () => {
    const many = Array.from({ length: 11 }, (_, index) => ({
      email: testEmailAddress(`copy-${index}`),
    }));
    for (const sent of [
      { ...message, to: [{ email: ada }, { email: testEmailAddress("b") }] },
      { ...message, cc: many },
      { ...message, bcc: many },
    ]) {
      const { exit, requests } = await sendOnce(sent);

      expect(requests).toHaveLength(0);
      expect(failureOf(exit)).toMatchObject({
        _tag: "EmailServiceError",
        failureKind: "provider",
        code: "recipients_unsupported",
      });
    }
  });

  test("sends a one-recipient list like a single recipient", async () => {
    const { requests } = await sendOnce({ ...message, to: [{ email: ada }] });

    expect(requests[0]?.body?.to).toBe(ada);
  });

  test("refuses a message without content before any request", async () => {
    const { exit, requests } = await sendOnce({
      ...message,
      html: undefined,
      text: undefined,
    });

    expect(requests).toHaveLength(0);
    expect(failureOf(exit)).toMatchObject({
      failureKind: "message",
      code: "missing_content",
    });
  });
});

describe("PostHog email failure classification", () => {
  /** [status, code, attempts, expected failure] */
  const table: readonly [
    number,
    string,
    number,
    { _tag: string; failureKind: string },
  ][] = [
    [
      400,
      "validation_error",
      1,
      { _tag: "EmailServiceError", failureKind: "message" },
    ],
    [
      400,
      "invalid_recipient",
      1,
      { _tag: "EmailServiceError", failureKind: "message" },
    ],
    [
      400,
      "invalid_idempotency_key",
      1,
      { _tag: "EmailServiceError", failureKind: "message" },
    ],
    [
      400,
      "template_not_sendable",
      1,
      { _tag: "EmailServiceError", failureKind: "message" },
    ],
    [
      400,
      "marketing_template",
      1,
      { _tag: "EmailServiceError", failureKind: "message" },
    ],
    [
      400,
      "transactional_email_paused",
      1,
      { _tag: "EmailServiceError", failureKind: "provider" },
    ],
    [
      400,
      "sender_unavailable",
      1,
      { _tag: "EmailServiceError", failureKind: "provider" },
    ],
    [
      401,
      "authentication_failed",
      1,
      { _tag: "EmailServiceError", failureKind: "provider" },
    ],
    [
      403,
      "permission_denied",
      1,
      { _tag: "EmailServiceError", failureKind: "provider" },
    ],
    [
      404,
      "not_found",
      1,
      { _tag: "EmailServiceError", failureKind: "provider" },
    ],
    [
      409,
      "idempotency_key_in_flight",
      3,
      { _tag: "NetworkError", failureKind: "unknown-outcome" },
    ],
    [
      422,
      "recipient_suppressed",
      1,
      { _tag: "EmailServiceError", failureKind: "message" },
    ],
    [
      422,
      "recipient_unreachable",
      1,
      { _tag: "EmailServiceError", failureKind: "message" },
    ],
    [
      422,
      "idempotency_key_reused",
      1,
      { _tag: "EmailServiceError", failureKind: "message" },
    ],
    [
      422,
      "sending_paused",
      1,
      { _tag: "EmailServiceError", failureKind: "provider" },
    ],
    [
      422,
      "sending_suspended",
      1,
      { _tag: "EmailServiceError", failureKind: "provider" },
    ],
    [
      429,
      "quota_limited",
      1,
      { _tag: "EmailServiceError", failureKind: "provider" },
    ],
    [
      429,
      "throttled",
      3,
      { _tag: "EmailServiceError", failureKind: "provider" },
    ],
    [
      500,
      "server_error",
      3,
      { _tag: "EmailServiceError", failureKind: "provider" },
    ],
    [
      503,
      "delivery_unavailable",
      3,
      { _tag: "EmailServiceError", failureKind: "provider" },
    ],
  ];

  for (const [status, code, attempts, expected] of table) {
    test(`${status} ${code} fails as ${expected._tag} ${expected.failureKind} after ${attempts} attempt(s)`, async () => {
      const { exit, requests, logs } = await sendOnce(message, () =>
        refused(status, code)
      );

      expect(requests).toHaveLength(attempts);
      const failure = failureOf(exit);
      expect(failure).toMatchObject({ ...expected, code });
      expect(JSON.stringify(failure)).not.toContain(ada);
      expect(JSON.stringify(failure)).not.toContain("detail text");
      expect(logs.join("\n")).not.toContain("detail text");
      const keys = requests.map((request) =>
        request.headers.get("idempotency-key")
      );
      expect(new Set(keys).size).toBe(1);
    });
  }

  test("an unreadable error answer is classified by its status", async () => {
    const { exit } = await sendOnce(message, () => ({
      status: 401,
      body: "<html>",
    }));

    expect(failureOf(exit)).toMatchObject({
      _tag: "EmailServiceError",
      failureKind: "provider",
      code: "http_401",
    });
  });

  test("a code outside PostHog's vocabulary is not passed on", async () => {
    const { exit } = await sendOnce(message, () =>
      refused(400, `Ada <${ada}> is invalid`)
    );

    expect(failureOf(exit)).toMatchObject({
      failureKind: "message",
      code: "unrecognized",
    });
  });

  test("a transport failure is retried, then hands the message to the next provider", async () => {
    const { exit, requests } = await sendOnce(message, () => ({
      fails: "network",
    }));

    expect(requests).toHaveLength(3);
    expect(failureOf(exit)).toMatchObject({
      _tag: "NetworkError",
      failureKind: "provider",
      code: "network_error",
    });
  });

  test("an attempt that outlasts the production timeout is abandoned and retried, then hands the message on", async () => {
    const { exit, requests } = await sendOnce(message, () => ({ hangs: true }));

    // 5 s, 1 s backoff, 5 s, 2 s backoff, 5 s.
    expect(requests.map((request) => request.at)).toEqual([0, 6000, 13_000]);
    expect(failureOf(exit)).toMatchObject({
      _tag: "NetworkError",
      failureKind: "provider",
      code: "timeout",
    });
  });

  test("waits 30 seconds per attempt outside production", async () => {
    const { requests } = await sendOnce(
      message,
      (index) => (index === 0 ? { hangs: true } : accepted()),
      provider,
      {}
    );

    expect(requests.map((request) => request.at)).toEqual([0, 31_000]);
  });

  test("an accepted answer whose body stalls or breaks leaves the outcome unknown and is not retried", async () => {
    const answers: readonly [FakeAnswer, number][] = [
      // The stalled body is abandoned at the 5-second attempt timeout.
      [{ stallsBody: true }, 0],
      [{ breaksBody: true }, 0],
    ];
    for (const [answer, at] of answers) {
      const { exit, requests } = await sendOnce(message, () => answer);

      expect(requests.map((request) => request.at)).toEqual([at]);
      expect(failureOf(exit)).toMatchObject({
        _tag: "NetworkError",
        failureKind: "unknown-outcome",
        code: "invalid_response",
      });
    }
  });

  test("recovers when a retry is accepted", async () => {
    const { exit, requests } = await sendOnce(message, (index) =>
      index < 2 ? refused(503, "delivery_unavailable") : accepted("id-3")
    );

    expect(requests).toHaveLength(3);
    expect(successOf(exit)).toMatchObject({ id: "id-3", status: "queued" });
  });

  test("an accepted answer without a message id leaves the outcome unknown and is not retried", async () => {
    for (const body of [{ replayed: false }, "not json", { message_id: "" }]) {
      const { exit, requests } = await sendOnce(message, () => ({
        status: 202,
        body,
      }));

      expect(requests).toHaveLength(1);
      expect(failureOf(exit)).toMatchObject({
        _tag: "NetworkError",
        failureKind: "unknown-outcome",
        code: "invalid_response",
      });
    }
  });
});

describe("PostHog email Retry-After", () => {
  test("waits out the delay PostHog asks for before retrying a throttled send", async () => {
    const { exit, requests } = await sendOnce(message, (index) =>
      index === 0
        ? refused(429, "throttled", { "Retry-After": "10" })
        : accepted()
    );

    expect(requests.map((request) => request.at)).toEqual([0, 10_000]);
    expect(Exit.isSuccess(exit)).toBe(true);
  });

  test("hands the message on at once when PostHog asks for more than 30 seconds", async () => {
    const { exit, requests } = await sendOnce(message, () =>
      refused(429, "throttled", { "Retry-After": "31" })
    );

    expect(requests).toHaveLength(1);
    expect(failureOf(exit)).toMatchObject({
      _tag: "EmailServiceError",
      failureKind: "provider",
      code: "throttled",
    });
  });
});

const batchMessage = (index: number): EmailMessage => ({
  ...message,
  to: { email: testEmailAddress(`recipient-${index}`) },
  idempotencyKey: undefined,
});

const sendBatch = async (
  messages: readonly EmailMessage[],
  answer: (index: number, request: RecordedRequest) => FakeAnswer,
  env: Record<string, string> = production
) => {
  const fake = makeFakePostHog(answer);
  const { exit, logs } = await runAgainst(
    fake,
    provider.sendBatch(messages, { idempotencyKey: "campaign-batch:42:1" }),
    env
  );
  return { results: successOf(exit), logs, fake };
};

const recipientOf = (request: RecordedRequest | undefined) =>
  String(request?.body?.to);

describe("PostHog email batches", () => {
  test("sends each message on its own and answers in message order with mixed outcomes", async () => {
    const messages = [0, 1, 2].map(batchMessage);
    const { results, fake } = await sendBatch(messages, (_, request) =>
      recipientOf(request) === testEmailAddress("recipient-1")
        ? refused(422, "recipient_suppressed")
        : accepted(`id-for-${recipientOf(request)}`)
    );

    expect(results).toMatchObject([
      { status: "queued", id: `id-for-${testEmailAddress("recipient-0")}` },
      {
        status: "failed",
        provider: "posthog",
        error: { failureKind: "message", code: "recipient_suppressed" },
      },
      { status: "queued", id: `id-for-${testEmailAddress("recipient-2")}` },
    ]);
    const keys = Object.fromEntries(
      fake.requests.map((request) => [
        recipientOf(request),
        request.headers.get("idempotency-key"),
      ])
    );
    expect(keys).toEqual({
      [testEmailAddress("recipient-0")]: "campaign-batch:42:1:0",
      [testEmailAddress("recipient-1")]: "campaign-batch:42:1:1",
      [testEmailAddress("recipient-2")]: "campaign-batch:42:1:2",
    });
  });

  test("keeps a message's own idempotency key", async () => {
    const { fake } = await sendBatch(
      [{ ...batchMessage(0), idempotencyKey: "own-key" }],
      () => accepted()
    );

    expect(fake.requests[0]?.headers.get("idempotency-key")).toBe("own-key");
  });

  test("sends at most four messages at a time", async () => {
    const { results, fake } = await sendBatch(
      Array.from({ length: 12 }, (_, index) => batchMessage(index)),
      () => accepted()
    );

    expect(results).toHaveLength(12);
    expect(fake.maxInFlight).toBe(4);
  });

  test("stops starting sends after a provider-level failure and hands the rest to the next provider", async () => {
    const { results, fake } = await sendBatch(
      Array.from({ length: 10 }, (_, index) => batchMessage(index)),
      () => refused(401, "authentication_failed")
    );

    expect(fake.requests).toHaveLength(4);
    expect(results).toHaveLength(10);
    for (const result of results.slice(0, 4)) {
      expect(result).toMatchObject({
        status: "failed",
        error: { failureKind: "provider", code: "authentication_failed" },
      });
    }
    for (const result of results.slice(4)) {
      expect(result).toMatchObject({
        status: "failed",
        error: {
          _tag: "EmailServiceError",
          failureKind: "provider",
          code: "not_attempted",
        },
      });
    }
  });

  test("keeps the sends in flight when another fails provider-level", async () => {
    const { results } = await sendBatch(
      [0, 1, 2].map(batchMessage),
      (_, request) =>
        recipientOf(request) === testEmailAddress("recipient-0")
          ? refused(401, "authentication_failed")
          : accepted()
    );

    expect(results.map((result) => result.status)).toEqual([
      "failed",
      "queued",
      "queued",
    ]);
  });

  test("message-level failures do not stop the batch", async () => {
    const { results, fake } = await sendBatch(
      Array.from({ length: 6 }, (_, index) => batchMessage(index)),
      () => refused(422, "recipient_unreachable")
    );

    expect(fake.requests).toHaveLength(6);
    expect(results).toHaveLength(6);
  });

  test("ends the batch at 15 seconds: sends in flight have an unknown outcome, unstarted ones go to the next provider", async () => {
    const { results, fake } = await sendBatch(
      Array.from({ length: 6 }, (_, index) => batchMessage(index)),
      () => ({ hangs: true }),
      {}
    );

    expect(fake.requests).toHaveLength(4);
    for (const result of results.slice(0, 4)) {
      expect(result).toMatchObject({
        status: "failed",
        error: {
          _tag: "NetworkError",
          failureKind: "unknown-outcome",
          code: "batch_deadline",
        },
      });
    }
    for (const result of results.slice(4)) {
      expect(result).toMatchObject({
        status: "failed",
        error: {
          _tag: "EmailServiceError",
          failureKind: "provider",
          code: "batch_deadline",
        },
      });
    }
  });

  test("does not wait out a Retry-After that would end past the batch deadline", async () => {
    const { results, fake } = await sendBatch([batchMessage(0)], () =>
      refused(429, "throttled", { "Retry-After": "20" })
    );

    expect(fake.requests).toHaveLength(1);
    expect(results[0]).toMatchObject({
      status: "failed",
      error: { failureKind: "provider", code: "throttled" },
    });
  });

  test("stops retrying when a later Retry-After would end past the batch deadline", async () => {
    const { results, fake } = await sendBatch([batchMessage(0)], () =>
      refused(429, "throttled", { "Retry-After": "10" })
    );

    expect(fake.requests.map((request) => request.at)).toEqual([0, 10_000]);
    expect(results[0]).toMatchObject({
      status: "failed",
      error: {
        _tag: "EmailServiceError",
        failureKind: "provider",
        code: "throttled",
      },
    });
  });

  test("checks every message before sending, handing on the ones PostHog cannot carry", async () => {
    const { results, fake } = await sendBatch(
      [
        { ...batchMessage(0), attachments: [{ filename: "a", content: "b" }] },
        { ...batchMessage(1), to: [{ email: ada }, { email: sender }] },
        batchMessage(2),
      ],
      () => accepted()
    );

    expect(fake.requests).toHaveLength(1);
    expect(results).toMatchObject([
      { status: "failed", error: { failureKind: "message" } },
      { status: "failed", error: { failureKind: "provider" } },
      { status: "queued" },
    ]);
  });

  test("logs the dropped custom headers once per batch", async () => {
    const { logs } = await sendBatch(
      [0, 1, 2].map((index) => ({
        ...batchMessage(index),
        headers: { "List-Unsubscribe": "<https://example.test/u>" },
      })),
      () => accepted()
    );

    expect(logs.filter((line) => line.includes("custom headers"))).toHaveLength(
      1
    );
  });

  test("an empty batch sends nothing", async () => {
    const { results, fake } = await sendBatch([], () => accepted());

    expect(results).toEqual([]);
    expect(fake.requests).toHaveLength(0);
  });
});
