import "@/shared/testing/workspace-test-env";

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { Deferred, Effect } from "effect";
import { renderServerComponents } from "@/shared/testing/react-server-render.test-utils";
import {
  TestReleaseGate,
  testReleaseGateEvaluating,
} from "./release-gate.test-utils";

// Next resolves `next/navigation` to its server build for server components.
mock.module(
  "next/navigation",
  () => import("next/dist/api/navigation.react-server")
);

const { releaseGateForRequest } = await import("./release-gate.server");

let open = false;
let evaluations = 0;
let release: Deferred.Deferred<void>;

// PostHog answers once the test releases it, with the opposite value on
// every evaluation.
const gate = testReleaseGateEvaluating(() =>
  Deferred.await(release).pipe(
    Effect.andThen(Effect.promise(() => Promise.resolve())),
    Effect.andThen(
      Effect.sync(() => {
        evaluations += 1;
        open = !open;
        return open;
      })
    )
  )
);

const request = releaseGateForRequest(gate, {
  operation: "test.release-gate",
  whenRunFails: "reject",
});

// One Effect consumer with its own build of the request layer, as a loader
// or service of the render starts.
const isOpenInOwnRun = () =>
  Effect.runPromise(TestReleaseGate.isOpen.pipe(Effect.provide(request.layer)));

const nextTurn = () => new Promise((resolve) => setImmediate(resolve));

// Releases PostHog from outside every render, once every component rendered
// so far has started waiting.
const releaseAfterRendersStart = () =>
  nextTurn()
    .then(nextTurn)
    .then(() => Effect.runSync(Deferred.succeed(release, undefined)));

const valuesOf = (rendered: readonly PromiseSettledResult<boolean>[]) =>
  rendered.map((result) =>
    result.status === "fulfilled" ? result.value : result.reason
  );

beforeEach(() => {
  open = false;
  evaluations = 0;
  release = Deferred.makeUnsafe<void>();
});

describe("releaseGateForRequest in a React server render", () => {
  test("shares one decision with the page, its loaders, and their layers", async () => {
    const [rendered] = await Promise.all([
      renderServerComponents([
        () => request.isOpen(),
        isOpenInOwnRun,
        async () => {
          await request.isOpen();
          await nextTurn();
          return isOpenInOwnRun();
        },
      ]),
      releaseAfterRendersStart(),
    ]);

    expect(valuesOf(rendered)).toEqual([true, true, true]);
    expect(evaluations).toBe(1);
  });

  test("decides separately for concurrent renders", async () => {
    const renderRequest = () =>
      renderServerComponents([() => request.isOpen(), isOpenInOwnRun]);

    const [first, second] = await Promise.all([
      renderRequest(),
      renderRequest(),
      releaseAfterRendersStart(),
    ]);

    const decisions = [valuesOf(first), valuesOf(second)];
    expect(decisions.map((decision) => new Set(decision).size)).toEqual([1, 1]);
    expect(new Set(decisions.flat())).toEqual(new Set([true, false]));
    expect(evaluations).toBe(2);
  });

  test("decides per call outside a render, such as in a Server Action", async () => {
    Effect.runSync(Deferred.succeed(release, undefined));

    expect(await request.isOpen()).toBe(true);
    expect(await request.isOpen()).toBe(false);
    expect(evaluations).toBe(2);
  });
});

process.stdout.write("RELEASE_GATE_REQUEST_REACT_SERVER_PROOF\n");
