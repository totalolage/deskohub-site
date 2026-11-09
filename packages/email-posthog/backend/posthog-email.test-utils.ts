import { testEmailAddress } from "@deskohub/test-email";
import {
  ConfigProvider,
  Duration,
  Effect,
  Exit,
  Fiber,
  Layer,
  Logger,
  Random,
  Redacted,
} from "effect";
import { TestClock } from "effect/testing";
import { FetchHttpClient } from "effect/unstable/http";

/** What the fake PostHog answers to one request. */
export type FakeAnswer =
  | {
      readonly status: number;
      readonly body?: unknown;
      readonly headers?: Record<string, string>;
    }
  | { readonly fails: "network" }
  | { readonly hangs: true };

/** One request the fake PostHog received, at test-clock time `at`. */
export interface RecordedRequest {
  readonly url: string;
  readonly method: string;
  readonly headers: Headers;
  readonly body: Record<string, unknown> | undefined;
  readonly at: number;
}

export const accepted = (id = "0197a5e1-1b52-7c4e-9f5a-2d3b4c5d6e7f") => ({
  status: 202,
  body: { message_id: id, replayed: false },
});

export const refused = (
  status: number,
  code: string,
  headers?: Record<string, string>
) => ({
  status,
  body: {
    type: "validation_error",
    code,
    detail: `detail text for ${testEmailAddress("ada")}`,
    attr: null,
  },
  headers,
});

/**
 * A fake PostHog behind `FetchHttpClient.Fetch`. `answer` picks the answer of
 * each request by its index; requests and their test-clock times are
 * recorded.
 */
export const makeFakePostHog = (
  answer: (index: number, request: RecordedRequest) => FakeAnswer
) => {
  const requests: RecordedRequest[] = [];
  const clock = { now: 0 };
  let inFlight = 0;
  let maxInFlight = 0;
  // Requests whose answer is on its way; the test clock waits for them.
  let settling = 0;

  const fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    settling += 1;
    const rawBody = init?.body
      ? await new Response(init.body).text()
      : undefined;
    const request: RecordedRequest = {
      url: input instanceof Request ? input.url : String(input),
      method: init?.method ?? "GET",
      headers: new Headers(init?.headers),
      body: rawBody ? JSON.parse(rawBody) : undefined,
      at: clock.now,
    };
    const index = requests.push(request) - 1;
    const next = answer(index, request);
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    try {
      if ("hangs" in next) {
        settling -= 1;
        return await new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError"))
          );
        });
      }
      if ("fails" in next) {
        settling -= 1;
        throw new TypeError("fetch failed");
      }
      // Settle on a later tick, so concurrent requests overlap.
      await new Promise((resolve) => setTimeout(resolve, 1));
      settling -= 1;
      return new Response(serializeBody(next.body), {
        status: next.status,
        headers: next.headers,
      });
    } finally {
      inFlight -= 1;
    }
  }) as typeof globalThis.fetch;

  return {
    fetch,
    requests,
    clock,
    get maxInFlight() {
      return maxInFlight;
    },
    get settling() {
      return settling;
    },
  };
};

const serializeBody = (body: unknown) => {
  if (body === undefined) return null;
  return typeof body === "string" ? body : JSON.stringify(body);
};

export type FakePostHog = ReturnType<typeof makeFakePostHog>;

export const connection = {
  secretKey: Redacted.make("phs_test_secret"),
  host: "https://eu.i.posthog.com/",
};

const realTick = Effect.promise(
  () => new Promise<void>((resolve) => setTimeout(resolve, 0))
);

/**
 * Runs `effect` against `fake` on a test clock, advancing it in 100 ms steps
 * while the effect waits, with neutral backoff jitter. Returns its exit and
 * the messages it logged.
 */
export const runAgainst = async <A, E>(
  fake: FakePostHog,
  effect: Effect.Effect<A, E>,
  env: Record<string, string> = {}
) => {
  const logs: string[] = [];
  const logger = Logger.make(({ message }) => {
    logs.push(Array.isArray(message) ? String(message[0]) : String(message));
  });
  const exit = await Effect.runPromise(
    Effect.gen(function* () {
      const fiber = yield* Effect.forkChild(effect);
      for (let step = 0; step < 5000; step += 1) {
        yield* realTick;
        if (fiber.pollUnsafe() !== undefined) break;
        if (fake.settling > 0) continue;
        fake.clock.now += 100;
        yield* TestClock.adjust(Duration.millis(100));
      }
      return yield* Fiber.await(fiber);
    }).pipe(
      Effect.provideService(FetchHttpClient.Fetch, fake.fetch),
      Effect.provideService(Random.Random, {
        nextDoubleUnsafe: () => 0.5,
        nextIntUnsafe: () => 0,
      }),
      Effect.provideService(
        ConfigProvider.ConfigProvider,
        ConfigProvider.fromUnknown(env)
      ),
      Effect.provide(Layer.mergeAll(Logger.layer([logger]), TestClock.layer()))
    )
  );
  return { exit, logs };
};

/** The success of `exit`, or a thrown failure for a clear test message. */
export const successOf = <A, E>(exit: Exit.Exit<A, E>) => {
  if (Exit.isSuccess(exit)) return exit.value;
  throw new Error(`expected success, got ${String(exit.cause)}`);
};

/** The typed failure of `exit`. */
export const failureOf = <A, E>(exit: Exit.Exit<A, E>) => {
  if (Exit.isFailure(exit)) {
    const reason = exit.cause.reasons[0];
    if (reason?._tag === "Fail") return reason.error;
  }
  throw new Error(`expected a typed failure, got ${String(exit)}`);
};
