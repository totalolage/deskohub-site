import { describe, expect, test } from "bun:test";
import { inspect } from "node:util";
import { Effect, Fiber, Redacted } from "effect";
import { TestClock } from "effect/testing";
import { FetchHttpClient } from "effect/unstable/http";
import { withInstantSleeps } from "@/shared/testing/workspace-test-clock.test-utils";
import {
  fetchPostHogEmailStatus,
  type PostHogEmailStatusClientConfig,
  PostHogEmailStatusError,
} from "./posthog-email-status-client";

const secretKey = "phx_status_client_test_secret";

const config: PostHogEmailStatusClientConfig = {
  secretKey: Redacted.make(secretKey),
  host: "https://posthog.example.test",
};

interface RecordedRequest {
  readonly method: string;
  readonly url: string;
  readonly authorization: string | null;
}

/** A fetch stub that answers every request with `respond` and records it. */
const stubFetch = (respond: (request: Request) => Promise<Response>) => {
  const requests: RecordedRequest[] = [];
  const fetch = Object.assign(
    (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      requests.push({
        method: request.method,
        url: request.url,
        authorization: request.headers.get("authorization"),
      });
      return respond(request);
    },
    { preconnect: globalThis.fetch.preconnect }
  );
  return { fetch, requests };
};

const answer = (
  status: number,
  body: Readonly<Record<string, string | null>> = {},
  headers: Record<string, string> = {}
) => stubFetch(async () => Response.json(body, { status, headers }));

/** A fetch stub that never answers and gives up only when aborted. */
const hang = () =>
  stubFetch(
    (request) =>
      new Promise<Response>((_, reject) => {
        request.signal.addEventListener("abort", () =>
          reject(request.signal.reason)
        );
      })
  );

/**
 * The ways a failure can end up in logs or error reports, including an
 * inspection of its raw fields that ignores every custom redaction.
 */
const renderings = (error: PostHogEmailStatusError) => [
  String(error),
  JSON.stringify(error),
  Bun.inspect(error, { depth: 10 }),
  inspect(error, { depth: 10, customInspect: false }),
];

const lookup = (
  fetch: typeof globalThis.fetch,
  messageId = "message-1",
  overrides: Partial<PostHogEmailStatusClientConfig> = {}
) =>
  fetchPostHogEmailStatus({ ...config, ...overrides }, messageId).pipe(
    Effect.provideService(FetchHttpClient.Fetch, fetch)
  );

describe("fetchPostHogEmailStatus", () => {
  test("reads a delivered email's status with the project secret key", async () => {
    const { fetch, requests } = answer(200, {
      id: "message/1 ü",
      status: "delivered",
      created_at: "2026-11-09T10:00:00Z",
      status_at: "2026-11-09T10:00:05.250Z",
      reason: null,
    });

    const lookupResult = await Effect.runPromise(lookup(fetch, "message/1 ü"));

    expect(lookupResult).toEqual({
      _tag: "Found",
      report: {
        messageId: "message/1 ü",
        status: "delivered",
        createdAt: new Date("2026-11-09T10:00:00.000Z"),
        statusAt: new Date("2026-11-09T10:00:05.250Z"),
        reason: null,
      },
    });
    expect(requests).toEqual([
      {
        method: "GET",
        url: "https://posthog.example.test/api/projects/@current/messaging/emails/message%2F1%20%C3%BC/",
        authorization: `Bearer ${secretKey}`,
      },
    ]);
  });

  test.each([
    "queued",
    "sent",
    "failed",
    "delivered",
    "bounced",
    "complained",
  ] as const)(
    "reads a %s email without a status time or reason",
    async (status) => {
      const { fetch } = answer(200, {
        id: "message-1",
        status,
        created_at: "2026-11-09T10:00:00Z",
        status_at: null,
        reason: null,
      });

      const lookupResult = await Effect.runPromise(lookup(fetch));

      expect(lookupResult).toEqual({
        _tag: "Found",
        report: {
          messageId: "message-1",
          status,
          createdAt: new Date("2026-11-09T10:00:00.000Z"),
          statusAt: null,
          reason: null,
        },
      });
    }
  );

  test("keeps the reason PostHog gives for a bounce", async () => {
    const { fetch } = answer(200, {
      id: "message-1",
      status: "bounced",
      created_at: "2026-11-09T10:00:00Z",
      status_at: "2026-11-09T10:01:00Z",
      reason: "Mailbox does not exist",
    });

    const lookupResult = await Effect.runPromise(lookup(fetch));

    expect(lookupResult).toMatchObject({
      _tag: "Found",
      report: {
        status: "bounced",
        statusAt: new Date("2026-11-09T10:01:00.000Z"),
        reason: "Mailbox does not exist",
      },
    });
  });

  test("reports a message PostHog does not know yet", async () => {
    const { fetch } = answer(404, { detail: "Not found." });

    const lookupResult = await Effect.runPromise(lookup(fetch));

    expect(lookupResult).toEqual({ _tag: "NotFoundYet" });
  });

  test.each([
    [401, "unauthorized"],
    [403, "unauthorized"],
    [400, "rejected"],
    [422, "rejected"],
    [500, "unavailable"],
    [503, "unavailable"],
  ] as const)("fails an HTTP %i answer as %s", async (status, reason) => {
    const { fetch } = answer(status, { detail: "PostHog says no." });

    const error = await Effect.runPromise(Effect.flip(lookup(fetch)));

    expect(error).toBeInstanceOf(PostHogEmailStatusError);
    expect(error.reason).toBe(reason);
    expect(error.retryAfterSeconds).toBeUndefined();
  });

  test("passes on how long PostHog asks a rate-limited caller to wait", async () => {
    const { fetch } = answer(
      429,
      { detail: "Request was throttled." },
      { "Retry-After": "37" }
    );

    const error = await Effect.runPromise(Effect.flip(lookup(fetch)));

    expect(error.reason).toBe("rate-limited");
    expect(error.retryAfterSeconds).toBe(37);
  });

  test.each<[string, Record<string, string>]>([
    ["without a Retry-After header", {}],
    [
      "with a Retry-After date",
      { "Retry-After": "Mon, 09 Nov 2026 17:00:00 GMT" },
    ],
  ])("fails a rate-limited read %s without a wait time", async (_, headers) => {
    const { fetch } = answer(
      429,
      { detail: "Request was throttled." },
      headers
    );

    const error = await Effect.runPromise(Effect.flip(lookup(fetch)));

    expect(error.reason).toBe("rate-limited");
    expect(error.retryAfterSeconds).toBeUndefined();
  });

  test("fails as unavailable when PostHog cannot be reached", async () => {
    const { fetch } = stubFetch(async () => {
      throw new TypeError("fetch failed");
    });

    const error = await Effect.runPromise(Effect.flip(lookup(fetch)));

    expect(error.reason).toBe("unavailable");
  });

  test("fails as unavailable when the connection drops during the body", async () => {
    const { fetch } = stubFetch(
      async () =>
        new Response(
          new ReadableStream({
            start: (controller) =>
              controller.error(new TypeError("terminated")),
          }),
          { status: 200 }
        )
    );

    const error = await Effect.runPromise(Effect.flip(lookup(fetch)));

    expect(error.reason).toBe("unavailable");
  });

  test("gives up on a body PostHog stops sending and cancels the request", async () => {
    const signals: AbortSignal[] = [];
    const { fetch } = stubFetch(async (request) => {
      signals.push(request.signal);
      return new Response(new ReadableStream(), { status: 200 });
    });

    const error = await Effect.runPromise(
      withInstantSleeps(Effect.flip(lookup(fetch)))
    );

    expect(error.reason).toBe("unavailable");
    expect(signals.map((signal) => signal.aborted)).toEqual([true]);
  });

  test("fails as unavailable when PostHog does not answer in time", async () => {
    const { fetch } = hang();

    const error = await Effect.runPromise(
      withInstantSleeps(Effect.flip(lookup(fetch)))
    );

    expect(error.reason).toBe("unavailable");
  });

  test("waits for PostHog as long as the configured timeout", async () => {
    const { fetch } = hang();

    const { pendingJustBefore, error } = await Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(
        Effect.flip(lookup(fetch, "message-1", { timeout: "2 seconds" }))
      );
      yield* Effect.yieldNow;
      yield* TestClock.adjust("1999 millis");
      const pendingJustBefore = fiber.pollUnsafe() === undefined;
      yield* TestClock.adjust("1 millis");
      return { pendingJustBefore, error: yield* Fiber.join(fiber) };
    }).pipe(Effect.provide(TestClock.layer()), Effect.runPromise);

    expect(pendingJustBefore).toBe(true);
    expect(error.reason).toBe("unavailable");
  });

  test.each([
    ["a body that is not JSON", () => new Response("<html>oops</html>")],
    [
      "an unknown status",
      () =>
        Response.json({
          id: "message-1",
          status: "opened",
          created_at: "2026-11-09T10:00:00Z",
          status_at: null,
          reason: null,
        }),
    ],
    [
      "an unreadable creation time",
      () =>
        Response.json({
          id: "message-1",
          status: "sent",
          created_at: "yesterday",
          status_at: null,
          reason: null,
        }),
    ],
    [
      "a missing status",
      () =>
        Response.json({
          id: "message-1",
          created_at: "2026-11-09T10:00:00Z",
          status_at: null,
          reason: null,
        }),
    ],
    [
      "a missing status time",
      () =>
        Response.json({
          id: "message-1",
          status: "sent",
          created_at: "2026-11-09T10:00:00Z",
          reason: null,
        }),
    ],
    [
      "a missing reason",
      () =>
        Response.json({
          id: "message-1",
          status: "sent",
          created_at: "2026-11-09T10:00:00Z",
          status_at: null,
        }),
    ],
    ["an empty success", () => new Response(null, { status: 204 })],
  ])("fails %s as an invalid response", async (_, respond) => {
    const { fetch } = stubFetch(async () => respond());

    const error = await Effect.runPromise(Effect.flip(lookup(fetch)));

    expect(error.reason).toBe("invalid-response");
  });

  test.each([
    ["an unauthorized answer", () => answer(401, { detail: "Bad key." })],
    ["a server error", () => answer(500)],
    [
      "a network failure",
      () =>
        stubFetch(async () => {
          throw new TypeError("fetch failed");
        }),
    ],
    ["an unreadable body", () => stubFetch(async () => new Response("{"))],
    [
      "a body cut off by the connection",
      () =>
        stubFetch(
          async () =>
            new Response(
              new ReadableStream({
                start: (controller) =>
                  controller.error(new TypeError("terminated")),
              })
            )
        ),
    ],
    [
      "an unexpected body",
      () => answer(200, { id: "message-1", status: "opened" }),
    ],
  ])("keeps the secret key out of the failure for %s", async (_, stub) => {
    const { fetch } = stub();

    const error = await Effect.runPromise(Effect.flip(lookup(fetch)));

    expect(error).toBeInstanceOf(PostHogEmailStatusError);
    for (const rendering of renderings(error)) {
      expect(rendering).not.toContain(secretKey);
    }
  });

  test("keeps the secret key out of a timeout failure", async () => {
    const { fetch } = hang();

    const error = await Effect.runPromise(
      withInstantSleeps(Effect.flip(lookup(fetch)))
    );

    for (const rendering of renderings(error)) {
      expect(rendering).not.toContain(secretKey);
    }
  });
});
