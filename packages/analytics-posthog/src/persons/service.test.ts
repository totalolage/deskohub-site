import { describe, expect, test } from "bun:test";
import { Duration, Effect, Fiber, Redacted, Ref, Result } from "effect";
import { TestClock } from "effect/testing";
import { FetchHttpClient } from "effect/unstable/http";
import { PostHogDistinctId, PostHogProjectId } from "../identifiers";
import type { PostHogPersonsWriteFailure } from "./errors";
import { postHogPersonsRequestCeilings } from "./request-policy";
import {
  getPostHogPersonDeletionWorstCase,
  type PostHogPersonDeletion,
  PostHogPersonsService,
} from "./service";

const distinctId = PostHogDistinctId.make("distinct-id-under-test-7f3a");
const apiKey = "phx_personal_key_under_test_91c2";
const attemptTimeout = "5 seconds";

/** One fake PostHog answer: a response, a transport failure, or no answer until aborted. */
type Reply = Response | "transport-error" | "no-answer";

interface SentRequest {
  readonly method: string;
  readonly url: string;
  readonly authorization: string | null;
  readonly body: string;
}

/** A fetch that answers with `replies` in order and records each request. */
const fakePostHog = (replies: readonly Reply[]) => {
  const sent: SentRequest[] = [];
  const fetch = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      sent.push({
        method: request.method,
        url: request.url,
        authorization: request.headers.get("authorization"),
        body: await request.text(),
      });
      const reply = replies[sent.length - 1] ?? replies.at(-1);
      if (reply === "transport-error") throw new TypeError("fetch failed");
      if (reply === "no-answer" || reply === undefined) {
        return new Promise<Response>((_, reject) =>
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError"))
          )
        );
      }
      return reply.clone();
    },
    { preconnect: globalThis.fetch.preconnect }
  ) satisfies typeof globalThis.fetch;
  return { fetch, sent };
};

const deletionResponse = (
  fields: Partial<{
    persons_found: number;
    persons_deleted: number;
    persons_queued_for_deletion: number;
    deletion_errors: readonly Record<string, string | null>[];
  }> = {}
) =>
  Response.json(
    {
      persons_found: 1,
      persons_deleted: 1,
      persons_queued_for_deletion: 0,
      events_queued_for_deletion: false,
      recordings_queued_for_deletion: false,
      ...fields,
    },
    { status: 202 }
  );

const status = (code: number) =>
  Response.json({ detail: "refused" }, { status: code });

/**
 * Runs one deletion against `replies` under a test clock, advancing it a
 * second at a time and letting the fake fetch settle in between, so backoffs
 * and attempt timeouts pass instantly.
 */
const deletePerson = (
  replies: readonly Reply[],
  proceed?: Effect.Effect<boolean>
) => {
  const posthog = fakePostHog(replies);
  const program = Effect.gen(function* () {
    const fiber = yield* Effect.forkChild(
      Effect.gen(function* () {
        const persons = yield* PostHogPersonsService;
        return yield* persons.deletePersonKeepingEvents({
          distinctId,
          ...(proceed && { proceed }),
        });
      }).pipe(Effect.result)
    );
    for (let tick = 0; tick < 120 && !fiber.pollUnsafe(); tick += 1) {
      yield* Effect.promise(
        () => new Promise((resolve) => setTimeout(resolve))
      );
      yield* TestClock.adjust("1 second");
    }
    return yield* Fiber.join(fiber);
  }).pipe(
    Effect.provide(
      PostHogPersonsService.Live({
        apiKey: Redacted.make(apiKey),
        host: new URL("https://eu.posthog.test/ignored-path"),
        projectId: PostHogProjectId.make("4242"),
        attemptTimeout,
      })
    ),
    Effect.provideService(FetchHttpClient.Fetch, posthog.fetch),
    Effect.provide(TestClock.layer())
  );
  return Effect.runPromise(program).then((result) => ({
    result,
    sent: posthog.sent,
  }));
};

const expectDeletion = (
  result: Result.Result<PostHogPersonDeletion, PostHogPersonsWriteFailure>
) => {
  if (Result.isFailure(result)) {
    throw new Error(`Expected a deletion, got ${result.failure._tag}`);
  }
  return result.success;
};

const expectFailure = (
  result: Result.Result<PostHogPersonDeletion, PostHogPersonsWriteFailure>
) => {
  if (Result.isSuccess(result)) {
    throw new Error(`Expected a failure, got ${result.success}`);
  }
  return result.failure;
};

describe("PostHogPersonsService.deletePersonKeepingEvents", () => {
  test("sends one bulk delete that keeps events and recordings", async () => {
    const { result, sent } = await deletePerson([deletionResponse()]);

    expect(expectDeletion(result)).toBe("deleted");
    expect(sent).toEqual([
      {
        method: "POST",
        url: "https://eu.posthog.test/api/projects/4242/persons/bulk_delete/",
        authorization: `Bearer ${apiKey}`,
        body: `{"distinct_ids":["${distinctId}"],"delete_events":false,"delete_recordings":false}`,
      },
    ]);
  });

  test.each([
    ["a deleted person", deletionResponse(), "deleted"],
    [
      "a person queued for deletion",
      deletionResponse({ persons_deleted: 0, persons_queued_for_deletion: 1 }),
      "deleted",
    ],
    [
      "no person for the distinct id",
      deletionResponse({ persons_found: 0, persons_deleted: 0 }),
      "absent",
    ],
    [
      "a deleted person whose activity log failed",
      deletionResponse({
        deletion_errors: [{ person_uuid: "p-1", step: "log_activity" }],
      }),
      "deleted",
    ],
    [
      "a deleted person whose analytics tombstone failed",
      deletionResponse({
        deletion_errors: [
          { person_uuid: "p-1", step: "publish_clickhouse_tombstone" },
        ],
      }),
      "deleted",
    ],
  ] as const)("reports %s as %s", async (_, reply, expected) => {
    const { result, sent } = await deletePerson([reply]);

    expect(expectDeletion(result)).toBe(expected);
    expect(sent).toHaveLength(1);
  });

  test("retries a rate limit and then deletes", async () => {
    const { result, sent } = await deletePerson([
      status(429),
      deletionResponse(),
    ]);

    expect(expectDeletion(result)).toBe("deleted");
    expect(sent).toHaveLength(2);
  });

  test("retries deletion errors from a step before the person was deleted", async () => {
    const { result, sent } = await deletePerson([
      deletionResponse({
        persons_deleted: 0,
        deletion_errors: [{ person_uuid: "p-1", step: "delete_person" }],
      }),
      deletionResponse(),
    ]);

    expect(expectDeletion(result)).toBe("deleted");
    expect(sent).toHaveLength(2);
  });

  test("gives up on a rate limit after the first attempt and two retries", async () => {
    const { result, sent } = await deletePerson([status(429)]);

    expect(expectFailure(result)).toMatchObject({
      _tag: "PostHogPersonsUnavailable",
      reason: "rate-limited",
      operation: "deletePersonKeepingEvents",
      request: "persons.bulkDelete",
      httpStatus: 429,
    });
    expect(sent).toHaveLength(3);
  });

  test("gives up on persistent deletion errors as incomplete", async () => {
    const { result, sent } = await deletePerson([
      deletionResponse({
        persons_deleted: 0,
        deletion_errors: [{ person_uuid: "p-1", step: "delete_person" }],
      }),
    ]);

    expect(expectFailure(result)).toMatchObject({
      _tag: "PostHogPersonsUnavailable",
      reason: "deletion-incomplete",
    });
    expect(sent).toHaveLength(3);
  });

  test.each([
    ["a server error", status(503), "PostHogPersonsUncertain", "server", 503],
    [
      "an internal error",
      status(500),
      "PostHogPersonsUncertain",
      "server",
      500,
    ],
    [
      "an unauthorized key",
      status(401),
      "PostHogPersonsRejected",
      "unauthorized",
      401,
    ],
    [
      "a key without person:write",
      status(403),
      "PostHogPersonsRejected",
      "unauthorized",
      403,
    ],
    [
      "an invalid request",
      status(400),
      "PostHogPersonsRejected",
      "invalid-request",
      400,
    ],
    [
      "an unknown project",
      status(404),
      "PostHogPersonsRejected",
      "invalid-request",
      404,
    ],
    [
      "a 2xx body that is not a deletion result",
      Response.json({ unexpected: true }, { status: 202 }),
      "PostHogPersonsUncertain",
      "invalid-response",
      undefined,
    ],
    [
      "a 2xx body that is not JSON",
      new Response("<html>", { status: 200 }),
      "PostHogPersonsUncertain",
      "invalid-response",
      200,
    ],
    [
      "deletion errors that name no step",
      deletionResponse({ persons_deleted: 0, deletion_errors: [{}] }),
      "PostHogPersonsUncertain",
      "invalid-response",
      undefined,
    ],
    [
      "deletion errors whose step is not text",
      deletionResponse({
        persons_deleted: 0,
        deletion_errors: [{ step: null }],
      }),
      "PostHogPersonsUncertain",
      "invalid-response",
      undefined,
    ],
    [
      "a transport error",
      "transport-error",
      "PostHogPersonsUncertain",
      "transport",
      undefined,
    ],
    [
      "an attempt that never answers",
      "no-answer",
      "PostHogPersonsUncertain",
      "timeout",
      undefined,
    ],
  ] as const)(
    "sends once and fails on %s",
    async (_, reply, tag, reason, httpStatus) => {
      const { result, sent } = await deletePerson([reply]);
      const failure = expectFailure(result);

      expect(failure).toMatchObject({
        _tag: tag,
        reason,
        operation: "deletePersonKeepingEvents",
        request: "persons.bulkDelete",
      });
      expect(failure.httpStatus).toBe(httpStatus);
      expect(sent).toHaveLength(1);
    }
  );

  test("an attempt that never answers times out at the attempt timeout", async () => {
    const posthog = fakePostHog(["no-answer"]);
    const finished = await Effect.gen(function* () {
      const persons = yield* PostHogPersonsService;
      const fiber = yield* Effect.forkChild(
        persons.deletePersonKeepingEvents({ distinctId }).pipe(Effect.result)
      );
      yield* Effect.promise(
        () => new Promise((resolve) => setTimeout(resolve))
      );
      yield* TestClock.adjust("4999 millis");
      const early = fiber.pollUnsafe() !== undefined;
      yield* TestClock.adjust("1 millis");
      yield* Effect.promise(
        () => new Promise((resolve) => setTimeout(resolve))
      );
      return { early, atTimeout: fiber.pollUnsafe() !== undefined };
    }).pipe(
      Effect.provide(
        PostHogPersonsService.Live({
          apiKey: Redacted.make(apiKey),
          host: new URL("https://eu.posthog.test"),
          projectId: PostHogProjectId.make("4242"),
          attemptTimeout,
        })
      ),
      Effect.provideService(FetchHttpClient.Fetch, posthog.fetch),
      Effect.provide(TestClock.layer()),
      Effect.runPromise
    );

    expect(finished).toEqual({ early: false, atTimeout: true });
  });

  test("skips without sending when proceed says no", async () => {
    const { result, sent } = await deletePerson(
      [deletionResponse()],
      Effect.succeed(false)
    );

    expect(expectDeletion(result)).toBe("skipped");
    expect(sent).toHaveLength(0);
  });

  test("rechecks proceed before a retry and skips it", async () => {
    const checks = Ref.makeUnsafe(0);
    const proceed = Ref.updateAndGet(checks, (count) => count + 1).pipe(
      Effect.map((count) => count === 1)
    );
    const { result, sent } = await deletePerson(
      [status(429), deletionResponse()],
      proceed
    );

    expect(expectDeletion(result)).toBe("skipped");
    expect(sent).toHaveLength(1);
    expect(Effect.runSync(Ref.get(checks))).toBe(2);
  });

  test.each([
    ["rate-limited", [status(429)]],
    ["incomplete", [deletionResponse({ deletion_errors: [{ step: "x" }] })]],
    ["rejected", [status(401)]],
    ["server", [status(503)]],
    ["invalid-response", [new Response("<html>", { status: 200 })]],
    ["transport", ["transport-error"]],
    ["timeout", ["no-answer"]],
  ] as const)(
    "a %s failure names neither the distinct id nor the key",
    async (_, replies) => {
      const { result } = await deletePerson(replies);
      const failure = expectFailure(result);
      const renderings = [
        failure.message,
        String(failure),
        JSON.stringify(failure),
        JSON.stringify(Object.entries(failure)),
        failure.stack ?? "",
      ];

      for (const rendering of renderings) {
        expect(rendering).not.toContain(distinctId);
        expect(rendering).not.toContain(apiKey);
      }
    }
  );
});

describe("PostHog persons retry ceilings", () => {
  test("pins the bulk delete ceiling", () => {
    expect(postHogPersonsRequestCeilings).toEqual({
      "persons.bulkDelete": { baseDelay: "1 second", maxRetries: 2 },
    });
  });

  test("bounds one deletion by three timed-out attempts and maximal backoff", () => {
    // Three 5-second attempts plus 1.2 s + 2.4 s of maximally jittered backoff.
    expect(
      Duration.toMillis(getPostHogPersonDeletionWorstCase(attemptTimeout))
    ).toBe(18_600);
  });
});
