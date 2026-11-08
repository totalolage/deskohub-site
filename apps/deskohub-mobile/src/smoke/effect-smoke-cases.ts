// Effect runtime checks for the app's JavaScript engine (Hermes on device).
// Each case runs its own Effect program: the engine's timers, microtasks,
// AbortController, BigInt and Schema support are what's under test.
import {
  BigDecimal,
  Cause,
  Clock,
  Context,
  Data,
  Effect,
  Exit,
  Fiber,
  Layer,
  Queue,
  Random,
  Redacted,
  Schedule,
  Schema,
  Stream,
} from "effect";
import * as TestClock from "effect/testing/TestClock";
import type { SmokeCase } from "./smoke-case";
import { assertSmoke, toOneLine } from "./smoke-case";

class Boom extends Data.TaggedError("Boom")<{ readonly reason: string }> {}

class Greeter extends Context.Service<
  Greeter,
  { readonly greet: (name: string) => Effect.Effect<string> }
>()("deskohub-mobile/smoke/Greeter") {
  static readonly Default = Layer.succeed(this, {
    greet: (name: string) => Effect.succeed(`hello ${name}`),
  });
}

const SmokePerson = Schema.Struct({
  name: Schema.NonEmptyString,
  age: Schema.Number,
});

const collected = (values: Iterable<number>) =>
  JSON.stringify(Array.from(values));

const effectCase = (name: string, run: SmokeCase["run"]): SmokeCase => ({
  group: "effect",
  name,
  run,
});

export const effectSmokeCases: ReadonlyArray<SmokeCase> = [
  effectCase("gen-run-promise", async () => {
    const sum = await Effect.runPromise(
      Effect.gen(function* () {
        const a = yield* Effect.succeed(20);
        const b = yield* Effect.sync(() => 22);
        return a + b;
      })
    );
    assertSmoke(sum === 42, `got ${sum}`);
    return String(sum);
  }),
  effectCase("schema-decode", () => {
    const person = Schema.decodeUnknownSync(SmokePerson)({
      name: "Ada",
      age: 36,
    });
    assertSmoke(
      person.name === "Ada" && person.age === 36,
      JSON.stringify(person)
    );
    return JSON.stringify(person);
  }),
  effectCase("schema-encode", () => {
    const Stamped = Schema.Struct({
      at: Schema.DateFromString,
      n: Schema.Number,
    });
    const encoded = Schema.encodeSync(Stamped)({ at: new Date(0), n: 1 });
    assertSmoke(
      encoded.at === "1970-01-01T00:00:00.000Z",
      JSON.stringify(encoded)
    );
    return JSON.stringify(encoded);
  }),
  effectCase("schema-decode-failure-message", async () => {
    const exit = await Effect.runPromiseExit(
      Schema.decodeUnknownEffect(SmokePerson)({ name: "Ada", age: "old" })
    );
    assertSmoke(Exit.isFailure(exit), "expected a failed decode");
    const error = await Effect.runPromise(
      Effect.flip(
        Schema.decodeUnknownEffect(SmokePerson)({ name: "Ada", age: "old" })
      )
    );
    assertSmoke(
      error.message.includes("age"),
      `message lacks the field: ${error.message}`
    );
    return toOneLine(error.message, 160);
  }),
  effectCase("schema-date-bigint-redacted", () => {
    const Sensitive = Schema.Struct({
      at: Schema.DateFromString,
      big: Schema.BigIntFromString,
      secret: Schema.RedactedFromValue(Schema.String),
    });
    const decoded = Schema.decodeUnknownSync(Sensitive)({
      at: "2026-01-05T09:30:00.000Z",
      big: "9007199254740993",
      secret: "s3cr3t",
    });
    assertSmoke(
      decoded.at instanceof Date &&
        decoded.at.getTime() === Date.UTC(2026, 0, 5, 9, 30),
      `date ${decoded.at.toISOString()}`
    );
    assertSmoke(
      decoded.big === 9007199254740993n,
      `bigint ${String(decoded.big)}`
    );
    assertSmoke(
      Redacted.value(decoded.secret) === "s3cr3t",
      "redacted value differs"
    );
    assertSmoke(
      !String(decoded.secret).includes("s3cr3t"),
      "String() reveals the redacted value"
    );
    return `date=${decoded.at.toISOString()} big=${decoded.big} redacted=${String(decoded.secret)}`;
  }),
  effectCase("layer-context-service", async () => {
    const greeting = await Effect.runPromise(
      Effect.gen(function* () {
        const greeter = yield* Greeter;
        return yield* greeter.greet("hermes");
      }).pipe(Effect.provide(Greeter.Default))
    );
    assertSmoke(greeting === "hello hermes", greeting);
    return greeting;
  }),
  effectCase("stream-iterable", async () => {
    const values = await Effect.runPromise(
      Stream.fromIterable([1, 2, 3]).pipe(
        Stream.map((n) => n * 10),
        Stream.runCollect
      )
    );
    assertSmoke(collected(values) === "[10,20,30]", collected(values));
    return collected(values);
  }),
  effectCase("stream-async-iterable", async () => {
    async function* numbers() {
      for (const n of [1, 2, 3]) {
        await Promise.resolve();
        yield n;
      }
    }
    const values = await Effect.runPromise(
      Stream.fromAsyncIterable(numbers(), (error) => error).pipe(
        Stream.runCollect
      )
    );
    assertSmoke(collected(values) === "[1,2,3]", collected(values));
    return collected(values);
  }),
  effectCase("stream-callback-timers", async () => {
    const values = await Effect.runPromise(
      Stream.callback<number>((queue) =>
        Effect.sync(() => {
          let emitted = 0;
          const tick = () => {
            emitted++;
            Queue.offerUnsafe(queue, emitted);
            if (emitted < 3) setTimeout(tick, 5);
            else Queue.endUnsafe(queue);
          };
          setTimeout(tick, 5);
        })
      ).pipe(Stream.runCollect)
    );
    assertSmoke(collected(values) === "[1,2,3]", collected(values));
    return collected(values);
  }),
  effectCase("fiber-fork-join-interrupt", async () => {
    let interrupted = false;
    const outcome = await Effect.runPromise(
      Effect.gen(function* () {
        const worker = yield* Effect.forkChild(
          Effect.succeed(7).pipe(Effect.delay("5 millis"))
        );
        const sleeper = yield* Effect.forkChild(
          Effect.never.pipe(
            Effect.onInterrupt(() =>
              Effect.sync(() => {
                interrupted = true;
              })
            )
          )
        );
        const joined = yield* Fiber.join(worker);
        yield* Fiber.interrupt(sleeper);
        const exit = yield* Fiber.await(sleeper);
        return { joined, exitInterrupted: Exit.hasInterrupts(exit) };
      })
    );
    assertSmoke(outcome.joined === 7, `joined ${outcome.joined}`);
    assertSmoke(interrupted, "onInterrupt did not run");
    assertSmoke(outcome.exitInterrupted, "exit is not interrupted");
    return `joined=${outcome.joined} interrupted=${interrupted}`;
  }),
  effectCase("scope-acquire-release-order", async () => {
    const events: Array<string> = [];
    const resource = (name: string) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          events.push(`acquire ${name}`);
          return name;
        }),
        () =>
          Effect.sync(() => {
            events.push(`release ${name}`);
          })
      );
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* resource("a");
          yield* resource("b");
          events.push("use");
        })
      )
    );
    const order = events.join(",");
    assertSmoke(order === "acquire a,acquire b,use,release b,release a", order);
    return order;
  }),
  effectCase("retry-recurs", async () => {
    let attempts = 0;
    const result = await Effect.runPromise(
      Effect.suspend(() => {
        attempts++;
        return attempts < 3
          ? Effect.fail(new Boom({ reason: `try ${attempts}` }))
          : Effect.succeed("ok");
      }).pipe(Effect.retry(Schedule.recurs(5)))
    );
    assertSmoke(
      result === "ok" && attempts === 3,
      `result=${result} attempts=${attempts}`
    );
    return `attempts=${attempts}`;
  }),
  effectCase("retry-spaced-timer", async () => {
    let attempts = 0;
    const startedAt = Date.now();
    await Effect.runPromise(
      Effect.suspend(() => {
        attempts++;
        return attempts < 3
          ? Effect.fail(new Boom({ reason: "again" }))
          : Effect.succeed("ok");
      }).pipe(Effect.retry(Schedule.spaced("20 millis")))
    );
    const elapsed = Date.now() - startedAt;
    assertSmoke(
      attempts === 3 && elapsed >= 35,
      `attempts=${attempts} elapsed=${elapsed}ms`
    );
    return `attempts=${attempts} elapsed=${elapsed}ms`;
  }),
  effectCase("clock-sleep", async () => {
    const timing = await Effect.runPromise(
      Effect.gen(function* () {
        const before = yield* Clock.currentTimeMillis;
        const wall = Date.now();
        yield* Effect.sleep("50 millis");
        const after = yield* Clock.currentTimeMillis;
        return { drift: Math.abs(before - wall), slept: after - before };
      })
    );
    assertSmoke(timing.drift < 1000, `clock drift ${timing.drift}ms`);
    // No upper bound: debugger pauses and device scheduling stretch sleeps,
    // and the case timeout already catches a sleep that never wakes.
    assertSmoke(timing.slept >= 45, `slept ${timing.slept}ms`);
    return `slept=${timing.slept}ms drift=${timing.drift}ms`;
  }),
  effectCase("test-clock", async () => {
    const woke = await Effect.runPromise(
      Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(
          Effect.sleep("1 hour").pipe(Effect.as("woke"))
        );
        yield* TestClock.adjust("1 hour");
        return yield* Fiber.join(fiber);
      }).pipe(Effect.provide(TestClock.layer()))
    );
    assertSmoke(woke === "woke", woke);
    return woke;
  }),
  effectCase("run-fork-exit", async () => {
    const failed = await Effect.runPromise(
      Fiber.await(Effect.runFork(Effect.fail(new Boom({ reason: "forked" }))))
    );
    const succeeded = await Effect.runPromise(
      Fiber.await(Effect.runFork(Effect.succeed(1)))
    );
    assertSmoke(Exit.isFailure(failed), "expected a failure exit");
    assertSmoke(Exit.isSuccess(succeeded), "expected a success exit");
    return `failure=${Exit.isFailure(failed)} success=${Exit.isSuccess(succeeded)}`;
  }),
  effectCase("cause-pretty", async () => {
    const exit = await Effect.runPromiseExit(
      Effect.fail(new Boom({ reason: "pretty" }))
    );
    assertSmoke(Exit.isFailure(exit), "expected a failure exit");
    const pretty = Cause.pretty(exit.cause);
    assertSmoke(pretty.includes("Boom"), `pretty=${pretty}`);
    return toOneLine(pretty, 120);
  }),
  effectCase("try-promise-abort-signal", async () => {
    let signal: AbortSignal | undefined;
    // The forked fiber starts on a later scheduler tick, so a fixed sleep
    // can interrupt it before tryPromise runs; wait until it has.
    let markStarted = () => {};
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const aborted = await Effect.runPromise(
      Effect.gen(function* () {
        const fiber = yield* Effect.forkChild(
          Effect.tryPromise((abortSignal) => {
            signal = abortSignal;
            markStarted();
            return new Promise<string>(() => {});
          })
        );
        yield* Effect.promise(() => started);
        yield* Fiber.interrupt(fiber);
        return signal?.aborted;
      })
    );
    assertSmoke(signal !== undefined, "tryPromise passed no signal");
    assertSmoke(aborted === true, `aborted=${aborted}`);
    return `aborted=${aborted}`;
  }),
  effectCase("random-next", async () => {
    const n = await Effect.runPromise(Random.next);
    assertSmoke(n >= 0 && n < 1, `n=${n}`);
    return `next=${n.toFixed(4)}`;
  }),
  effectCase("random-with-seed", async () => {
    const draw = Effect.gen(function* () {
      return [yield* Random.next, yield* Random.next] as const;
    });
    const first = await Effect.runPromise(draw.pipe(Random.withSeed("smoke")));
    const second = await Effect.runPromise(draw.pipe(Random.withSeed("smoke")));
    assertSmoke(
      first[0] === second[0] && first[1] === second[1] && first[0] !== first[1],
      `first=${first.join(",")} second=${second.join(",")}`
    );
    return `seeded=${first.map((n) => n.toFixed(4)).join(",")}`;
  }),
  effectCase("big-decimal", () => {
    const formatted = BigDecimal.format(BigDecimal.fromStringUnsafe("1234.50"));
    assertSmoke(formatted === "1234.5", formatted);
    return formatted;
  }),
];
