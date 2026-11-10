import "@/shared/testing/workspace-test-env";

import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { PostHogFeatureFlagEvaluationError } from "@deskohub/posthog/feature-flags/node";
import { Effect } from "effect";
import { runReactServerFixture } from "@/shared/testing/react-server-fixture.test-utils";
import type { GlobalRelease } from "./global-release";
import type { ReleaseGateRequestOptions } from "./release-gate.server";
import {
  TestReleaseGate,
  testReleaseGateEvaluating,
} from "./release-gate.test-utils";

// The flag's release for every visitor; PostHog decides an undecided one per
// visitor.
let globalRelease: GlobalRelease = "undecided";
const loadGlobalRelease = mock(() => Promise.resolve(globalRelease));
mock.module("./global-release.server", () => ({ loadGlobalRelease }));

// Resolves once the render reaches request time; a prerender never does.
let requestStarts: Promise<void> = Promise.resolve();
const connection = mock(() => requestStarts);
const nextServer = await import("next/server");
mock.module("next/server", () => ({ ...nextServer, connection }));

const { releaseGateForRequest } = await import("./release-gate.server");

afterEach(() => {
  globalRelease = "undecided";
  requestStarts = Promise.resolve();
  loadGlobalRelease.mockClear();
  connection.mockClear();
});

const closeOnRunFailure: ReleaseGateRequestOptions = {
  operation: "test.release-gate",
  whenRunFails: "close",
  failureCode: "test_release_gate_unavailable",
};
const rejectOnRunFailure: ReleaseGateRequestOptions = {
  operation: "test.release-gate",
  whenRunFails: "reject",
};

const defect = new Error("unexpected private-defect");

// Decides the request's gate against PostHog answering with `evaluation`,
// as `isOpen()` and as the request layer, collecting the runner's warnings.
const decideRequest = async (
  options: ReleaseGateRequestOptions,
  evaluation: Effect.Effect<boolean, PostHogFeatureFlagEvaluationError>
) => {
  const warn = spyOn(console, "warn").mockImplementation(() => undefined);
  try {
    const request = releaseGateForRequest(
      testReleaseGateEvaluating(() => evaluation),
      options
    );
    const settled = await Promise.allSettled([
      request.isOpen(),
      Effect.runPromise(
        TestReleaseGate.isOpen.pipe(Effect.provide(request.layer))
      ),
    ]);
    return {
      settled,
      warnings: warn.mock.calls.map((call) => call.join(" ")),
    };
  } finally {
    warn.mockRestore();
  }
};

describe("releaseGateForRequest", () => {
  test.each([closeOnRunFailure, rejectOnRunFailure])(
    "keeps the gate's own fail-closed policy when the flag is unavailable ($whenRunFails)",
    async (options) => {
      const { settled, warnings } = await decideRequest(
        options,
        Effect.fail(
          new PostHogFeatureFlagEvaluationError({
            message: "Could not evaluate the PostHog feature flag.",
            cause: undefined,
          })
        )
      );

      expect(settled).toEqual([
        { status: "fulfilled", value: false },
        { status: "fulfilled", value: false },
      ]);
      expect(warnings).toHaveLength(2);
      for (const warning of warnings) {
        expect(warning).toContain("Release gate unavailable");
        expect(warning).not.toContain("test_release_gate_unavailable");
      }
    }
  );

  test("closes the gate and logs its failure code when the run fails", async () => {
    const { settled, warnings } = await decideRequest(
      closeOnRunFailure,
      Effect.die(defect)
    );

    expect(settled).toEqual([
      { status: "fulfilled", value: false },
      { status: "fulfilled", value: false },
    ]);
    expect(warnings).toHaveLength(2);
    for (const warning of warnings) {
      expect(warning).toContain("test_release_gate_unavailable");
      expect(warning).not.toContain("private-defect");
    }
  });

  test("rejects, for the request layer too, when the run fails", async () => {
    const { settled, warnings } = await decideRequest(
      rejectOnRunFailure,
      Effect.die(defect)
    );

    expect(settled).toHaveLength(2);
    for (const result of settled) {
      expect(result.status).toBe("rejected");
    }
    expect(settled[0]).toMatchObject({ reason: defect });
    expect(warnings).toEqual([]);
  });

  test.each([
    ["on", true],
    ["off", false],
  ] as const)(
    "decides a flag that is %s for everyone without the request or PostHog",
    async (release, open) => {
      globalRelease = release;
      const evaluate = mock(() => Effect.die(defect));
      const request = releaseGateForRequest(
        testReleaseGateEvaluating(evaluate),
        rejectOnRunFailure
      );

      expect(await request.isOpen()).toBe(open);
      expect(loadGlobalRelease).toHaveBeenCalledWith(TestReleaseGate.flag);
      expect(connection).not.toHaveBeenCalled();
      expect(evaluate).not.toHaveBeenCalled();
    }
  );

  test("asks PostHog about the visitor only at request time", async () => {
    // A prerender, a runtime prefetch included, never reaches request time.
    // posthog-node reads the clock before its request, which Next.js reports
    // as an error while prerendering (#1187).
    const { promise: requestTime, resolve: startRequest } =
      Promise.withResolvers<void>();
    requestStarts = requestTime;
    const evaluate = mock(() => Effect.succeed(true));
    const request = releaseGateForRequest(
      testReleaseGateEvaluating(evaluate),
      rejectOnRunFailure
    );

    const decision = request.isOpen();
    await new Promise((resolve) => setImmediate(resolve));
    expect(connection).toHaveBeenCalledTimes(1);
    expect(evaluate).not.toHaveBeenCalled();

    startRequest();
    expect(await decision).toBe(true);
    expect(evaluate).toHaveBeenCalledTimes(1);
  });

  test("shares one decision per real React server render", async () => {
    const { exitCode, output } = await runReactServerFixture(
      "./features/feature-flags/backend/release-gate.server.rsc-fixture.ts"
    );

    expect(exitCode).toBe(0);
    expect(output).toContain("3 pass");
    expect(output).toContain("RELEASE_GATE_REQUEST_REACT_SERVER_PROOF");
  });
});
