import "@/shared/testing/workspace-test-env";

import { beforeEach, describe, expect, test } from "bun:test";
import { Deferred, Effect, Exit, Fiber } from "effect";
import { renderServerComponents } from "@/shared/testing/react-server-render.test-utils";
import { shareWithinRequest } from "./share-within-request";

let evaluations = 0;
let release: Deferred.Deferred<void>;

// Each evaluation waits for the test to release it, then counts itself.
const nextDecision = Effect.suspend(() => Deferred.await(release)).pipe(
  Effect.andThen(Effect.promise(() => Promise.resolve())),
  Effect.andThen(
    Effect.sync(() => {
      evaluations += 1;
      return evaluations;
    })
  )
);

const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

// Releases the evaluations from outside every render, once every component
// rendered so far has started waiting.
const releaseAfterRendersStart = () =>
  nextTurn()
    .then(nextTurn)
    .then(() => Effect.runSync(Deferred.succeed(release, undefined)));

// Starts a run of the decision, interrupts it while it waits, and resolves
// with the interrupted run's exit.
const interruptConsumer = async <A>(decision: Effect.Effect<A>) => {
  const consumer = Effect.runFork(decision);
  await nextTurn();
  return Effect.runPromise(
    Fiber.interrupt(consumer).pipe(Effect.andThen(Fiber.await(consumer)))
  );
};

beforeEach(() => {
  evaluations = 0;
  release = Deferred.makeUnsafe<void>();
});

describe("shareWithinRequest in a React server render", () => {
  test("shares one asynchronous evaluation with every component and run of a render", async () => {
    const decision = shareWithinRequest(nextDecision);

    const [rendered] = await Promise.all([
      renderServerComponents([
        () => Effect.runPromise(Effect.all([decision])),
        () =>
          Effect.runPromise(
            Effect.all([decision, decision], { concurrency: "unbounded" })
          ),
        async () => {
          const first = await Effect.runPromise(decision);
          await nextTurn();
          return [first, await Effect.runPromise(decision)];
        },
      ]),
      releaseAfterRendersStart(),
    ]);

    expect(rendered).toEqual([
      { status: "fulfilled", value: [1] },
      { status: "fulfilled", value: [1, 1] },
      { status: "fulfilled", value: [1, 1] },
    ]);
    expect(evaluations).toBe(1);
  });

  test("keeps concurrent renders' evaluations apart", async () => {
    const decision = shareWithinRequest(nextDecision);
    const renderRequest = () =>
      renderServerComponents([
        () => Effect.runPromise(decision),
        () => Effect.runPromise(decision),
      ]);

    const [first, second] = await Promise.all([
      renderRequest(),
      renderRequest(),
      releaseAfterRendersStart(),
    ]);

    const values = [first, second].map((rendered) =>
      rendered.map((result) =>
        result.status === "fulfilled" ? result.value : result.reason
      )
    );
    expect(values.map((request) => new Set(request).size)).toEqual([1, 1]);
    expect(new Set(values.flat())).toEqual(new Set([1, 2]));
    expect(evaluations).toBe(2);
  });

  test("keeps evaluating for the render when a consumer is interrupted", async () => {
    const decision = shareWithinRequest(nextDecision);
    const interrupted = Promise.withResolvers<Exit.Exit<number>>();

    const [rendered] = await Promise.all([
      renderServerComponents([
        async () => {
          interrupted.resolve(await interruptConsumer(decision));
          return Effect.runPromise(decision);
        },
        async () => {
          await interrupted.promise;
          return Effect.runPromise(decision);
        },
        () => Effect.runPromise(decision),
      ]),
      interrupted.promise.then(releaseAfterRendersStart),
    ]);

    expect(Exit.hasInterrupts(await interrupted.promise)).toBe(true);
    expect(rendered).toEqual([
      { status: "fulfilled", value: 1 },
      { status: "fulfilled", value: 1 },
      { status: "fulfilled", value: 1 },
    ]);
    expect(evaluations).toBe(1);
  });

  test("keeps another render evaluating when a render's consumer is interrupted", async () => {
    const decision = shareWithinRequest(nextDecision);

    const [interruptedRender, otherRender] = await Promise.all([
      renderServerComponents([() => interruptConsumer(decision)]),
      renderServerComponents([
        () => Effect.runPromise(decision),
        () => Effect.runPromise(decision),
      ]),
      releaseAfterRendersStart(),
    ]);

    expect(
      interruptedRender.map(
        (result) =>
          result.status === "fulfilled" && Exit.hasInterrupts(result.value)
      )
    ).toEqual([true]);
    const otherValues = otherRender.map((result) =>
      result.status === "fulfilled" ? result.value : result.reason
    );
    expect(otherValues).toHaveLength(2);
    expect(new Set(otherValues).size).toBe(1);
    expect([1, 2]).toContain(otherValues[0]);
    // The interrupted render's detached evaluation still completes.
    expect(evaluations).toBe(2);
  });

  test("shares a failure with the rest of the render", async () => {
    let attempts = 0;
    const decision = shareWithinRequest(
      Effect.suspend(() => {
        attempts += 1;
        return Deferred.await(release).pipe(
          Effect.andThen(Effect.fail("unavailable" as const))
        );
      })
    );

    const [rendered] = await Promise.all([
      renderServerComponents([
        () => Effect.runPromiseExit(decision),
        () => Effect.runPromiseExit(decision),
      ]),
      releaseAfterRendersStart(),
    ]);

    expect(rendered).toEqual([
      { status: "fulfilled", value: Exit.fail("unavailable") },
      { status: "fulfilled", value: Exit.fail("unavailable") },
    ]);
    expect(attempts).toBe(1);
  });

  test("evaluates every run outside a render, as in a Server Action", async () => {
    const decision = shareWithinRequest(nextDecision);
    Effect.runSync(Deferred.succeed(release, undefined));

    expect(await Effect.runPromise(decision)).toBe(1);
    expect(await Effect.runPromise(decision)).toBe(2);
  });
});

process.stdout.write("SHARE_WITHIN_REQUEST_REACT_SERVER_PROOF\n");
