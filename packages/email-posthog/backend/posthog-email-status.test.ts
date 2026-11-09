import { describe, expect, test } from "bun:test";
import {
  connection,
  type FakeAnswer,
  failureOf,
  makeFakePostHog,
  refused,
  runAgainst,
  successOf,
} from "./posthog-email.test-utils";
import { fetchPostHogEmailStatus } from "./posthog-email-status";

const messageId = "0197a5e1-1b52-7c4e-9f5a-2d3b4c5d6e7f";

const statusAnswer = (fields: Record<string, unknown>) => ({
  status: 200,
  body: {
    id: messageId,
    status: "delivered",
    created_at: "2026-11-09T10:00:00Z",
    status_at: "2026-11-09T10:00:05Z",
    reason: null,
    ...fields,
  },
});

const lookUp = async (
  answer: FakeAnswer,
  env: Record<string, string> = { VERCEL_ENV: "production" }
) => {
  const fake = makeFakePostHog(() => answer);
  const { exit } = await runAgainst(
    fake,
    fetchPostHogEmailStatus(connection, messageId),
    env
  );
  return { exit, requests: fake.requests };
};

describe("fetchPostHogEmailStatus", () => {
  test("reads the message's status from the app host with the secret key", async () => {
    const { exit, requests } = await lookUp(statusAnswer({}));

    expect(requests).toHaveLength(1);
    expect(requests[0]?.method).toBe("GET");
    expect(requests[0]?.url).toBe(
      `https://eu.posthog.com/api/projects/@current/messaging/emails/${messageId}/`
    );
    expect(requests[0]?.headers.get("authorization")).toBe(
      "Bearer phs_test_secret"
    );
    expect(successOf(exit)).toEqual({
      _tag: "Found",
      report: {
        messageId,
        status: "delivered",
        createdAt: new Date("2026-11-09T10:00:00Z"),
        statusAt: new Date("2026-11-09T10:00:05Z"),
        reason: null,
      },
    });
  });

  test("decodes every PostHog delivery status", async () => {
    for (const status of [
      "queued",
      "sent",
      "failed",
      "delivered",
      "bounced",
      "complained",
    ]) {
      const { exit } = await lookUp(statusAnswer({ status }));

      expect(successOf(exit)).toMatchObject({
        _tag: "Found",
        report: { status },
      });
    }
  });

  test("keeps the reason of a failed or bounced email", async () => {
    const { exit } = await lookUp(
      statusAnswer({ status: "bounced", reason: "hard" })
    );

    expect(successOf(exit)).toMatchObject({
      report: { status: "bounced", reason: "hard" },
    });
  });

  test("reads an absent or empty status time and reason as null", async () => {
    const { exit } = await lookUp({
      status: 200,
      body: {
        id: messageId,
        status: "queued",
        created_at: "2026-11-09T10:00:00Z",
        reason: "",
      },
    });

    expect(successOf(exit)).toMatchObject({
      report: { statusAt: null, reason: null },
    });
  });

  test("answers NotFoundYet while PostHog does not know the message", async () => {
    const { exit } = await lookUp(refused(404, "not_found"));

    expect(successOf(exit)).toEqual({ _tag: "NotFoundYet" });
  });

  test("encodes the message id into the path", async () => {
    const fake = makeFakePostHog(() => statusAnswer({}));
    await runAgainst(fake, fetchPostHogEmailStatus(connection, "a/b?c"));

    expect(fake.requests[0]?.url).toBe(
      "https://eu.posthog.com/api/projects/@current/messaging/emails/a%2Fb%3Fc/"
    );
  });

  const failures: readonly [string, FakeAnswer, Record<string, unknown>][] = [
    [
      "a throttled read is rate-limited with its Retry-After",
      refused(429, "throttled", { "Retry-After": "12" }),
      { reason: "rate-limited", retryAfterSeconds: 12 },
    ],
    [
      "a quota-limited read is rate-limited",
      refused(429, "quota_limited"),
      { reason: "rate-limited" },
    ],
    [
      "401 is unauthorized",
      refused(401, "authentication_failed"),
      { reason: "unauthorized" },
    ],
    [
      "403 is unauthorized",
      refused(403, "permission_denied"),
      { reason: "unauthorized" },
    ],
    [
      "another 4xx is rejected",
      refused(400, "validation_error"),
      { reason: "rejected" },
    ],
    [
      "5xx is unavailable",
      refused(503, "delivery_unavailable"),
      { reason: "unavailable" },
    ],
    [
      "a transport failure is unavailable",
      { fails: "network" },
      { reason: "unavailable" },
    ],
    [
      "an unreadable body is invalid",
      { status: 200, body: "<html>" },
      { reason: "invalid-response" },
    ],
    [
      "an unknown status is invalid",
      statusAnswer({ status: "deferred" }),
      { reason: "invalid-response" },
    ],
    [
      "a missing id is invalid",
      statusAnswer({ id: undefined }),
      { reason: "invalid-response" },
    ],
    [
      "an unreadable time is invalid",
      statusAnswer({ created_at: "yesterday" }),
      { reason: "invalid-response" },
    ],
  ];

  for (const [name, answer, expected] of failures) {
    test(name, async () => {
      const { exit, requests } = await lookUp(answer);

      expect(requests).toHaveLength(1);
      expect(failureOf(exit)).toMatchObject({
        _tag: "PostHogEmailStatusError",
        ...expected,
      });
    });
  }

  test("a read that outlasts the timeout is unavailable and not retried", async () => {
    const { exit, requests } = await lookUp({ hangs: true });

    expect(requests).toHaveLength(1);
    expect(failureOf(exit)).toMatchObject({
      _tag: "PostHogEmailStatusError",
      reason: "unavailable",
    });
  });

  test("uses the configured timeout", async () => {
    const fake = makeFakePostHog(() => ({ hangs: true }));
    const { exit } = await runAgainst(
      fake,
      fetchPostHogEmailStatus({ ...connection, timeout: "1 second" }, messageId)
    );

    expect(failureOf(exit)).toMatchObject({ reason: "unavailable" });
    expect(fake.clock.now).toBe(1000);
  });
});
