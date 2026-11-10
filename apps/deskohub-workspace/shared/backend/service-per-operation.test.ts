import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { Context, Data, Effect, Layer } from "effect";
import { makeMeetingPoint } from "@/shared/testing/overlapping-requests.test-utils";
import { servicePerOperation } from "./service-per-operation";

const builds = { handler: 0, instance: 0 };

/** Built once by the run or handler that provides the service. */
class HandlerOwn extends Context.Service<HandlerOwn, { readonly id: number }>()(
  "test/HandlerOwn"
) {
  static Live = Layer.sync(this, () => ({ id: ++builds.handler }));
}

class Refused extends Data.TaggedError("Refused")<{
  readonly input: string;
}> {}

type Answer = {
  readonly operation: string;
  readonly input: string;
  readonly instance: number;
  readonly handler: number;
};

class Operations extends Context.Service<
  Operations,
  {
    readonly answer: (input: string) => Effect.Effect<Answer>;
    readonly refuse: (input: string) => Effect.Effect<never, Refused>;
  }
>()("test/Operations") {}

/**
 * An implementation that numbers each instance it builds, over what the
 * handler built. Each answer first waits at `meet`, if given.
 */
const numberedInstances = (meet: Effect.Effect<void> = Effect.void) =>
  Layer.effect(
    Operations,
    Effect.map(HandlerOwn, (handler) => {
      const instance = ++builds.instance;
      return {
        answer: (input) =>
          Effect.as(meet, {
            operation: "answer",
            input,
            instance,
            handler: handler.id,
          }),
        refuse: (input) => Effect.fail(new Refused({ input })),
      };
    })
  );

const perOperation = <R>(implementation: Layer.Layer<Operations, never, R>) =>
  servicePerOperation(
    Operations,
    { answer: true, refuse: true },
    implementation
  );

describe("servicePerOperation", () => {
  test("runs overlapping operations each on its own instance over what the handler built", async () => {
    const meetingPoint = makeMeetingPoint(3);
    const implementation = numberedInstances(
      meetingPoint.arrive("answer")
    ).pipe(Layer.provide(HandlerOwn.Live));

    const answers = await Effect.gen(function* () {
      const operations = yield* Operations;
      return yield* Effect.all(
        ["first", "second", "third"].map(operations.answer),
        { concurrency: "unbounded" }
      );
    }).pipe(
      // As a handler provides it, beside what the handler builds itself.
      Effect.provide(
        Layer.mergeAll(perOperation(implementation), HandlerOwn.Live)
      ),
      Effect.runPromise
    );

    expect(meetingPoint.arrivals()).toEqual({ answer: 3 });
    expect(answers.map(({ input }) => input)).toEqual([
      "first",
      "second",
      "third",
    ]);
    expect(new Set(answers.map(({ instance }) => instance)).size).toBe(3);
    expect(new Set(answers.map(({ handler }) => handler)).size).toBe(1);
  });

  test("builds a new instance for each later operation", async () => {
    const answers = await Effect.gen(function* () {
      const operations = yield* Operations;
      return [
        yield* operations.answer("first"),
        yield* operations.answer("second"),
      ];
    }).pipe(
      Effect.provide(
        perOperation(numberedInstances().pipe(Layer.provide(HandlerOwn.Live)))
      ),
      Effect.runPromise
    );

    expect(answers[0]?.instance).not.toBe(answers[1]?.instance);
  });

  test("builds what the implementation requires once, for overlapping and later operations", async () => {
    const meetingPoint = makeMeetingPoint(2);
    const handlerBuildsBefore = builds.handler;

    const answers = await Effect.gen(function* () {
      const operations = yield* Operations;
      const overlapping = yield* Effect.all(
        ["first", "second"].map(operations.answer),
        { concurrency: "unbounded" }
      );
      return [...overlapping, yield* operations.answer("later")];
    }).pipe(
      Effect.provide(
        perOperation(numberedInstances(meetingPoint.arrive("answer"))).pipe(
          Layer.provide(HandlerOwn.Live)
        )
      ),
      Effect.runPromise
    );

    expect(meetingPoint.arrivals()).toEqual({ answer: 3 });
    expect(builds.handler - handlerBuildsBefore).toBe(1);
    expect(new Set(answers.map(({ handler }) => handler)).size).toBe(1);
    expect(new Set(answers.map(({ instance }) => instance)).size).toBe(3);
  });

  test("fails an operation with its own typed failure", async () => {
    const refusal = await Effect.flatMap(Operations, (operations) =>
      operations.refuse("unwelcome")
    ).pipe(
      Effect.flip,
      Effect.provide(
        perOperation(numberedInstances().pipe(Layer.provide(HandlerOwn.Live)))
      ),
      Effect.runPromise
    );

    expect(refusal).toEqual(new Refused({ input: "unwelcome" }));
  });
});
