import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { Data, Effect } from "effect";
import {
  runWorkspaceBrowserEffect,
  runWorkspaceBrowserEffectUntilAbort,
} from "./workspace-browser-effect";
import {
  deliverWorkspaceBrowserLogs,
  discardWorkspaceBrowserLogs,
  reportWorkspaceBrowserFailure,
  type WorkspaceBrowserLogRecord,
} from "./workspace-browser-logs";

class SyntheticFailure extends Data.TaggedError("SyntheticFailure")<{
  readonly message: string;
}> {}

let detach: (() => void) | undefined;

const collectLogs = () => {
  const records: WorkspaceBrowserLogRecord[] = [];
  detach = deliverWorkspaceBrowserLogs((record) => records.push(record));
  return records;
};

afterEach(() => {
  detach?.();
  detach = undefined;
  discardWorkspaceBrowserLogs();
});

describe("runWorkspaceBrowserEffect", () => {
  test("interrupts a suspended run whose signal already aborted", async () => {
    let interrupted = false;

    await expect(
      Effect.never.pipe(
        Effect.onInterrupt(() =>
          Effect.sync(() => {
            interrupted = true;
          })
        ),
        runWorkspaceBrowserEffect("test.aborted", {
          signal: AbortSignal.abort(),
        })
      )
    ).rejects.toBeDefined();
    expect(interrupted).toBe(true);
  });

  test("reports a censored failure carrying the operation", async () => {
    const records = collectLogs();
    const email = testEmailAddress("browser-runner");

    await reportWorkspaceBrowserFailure(
      "test.browser-failure",
      new Error(`refresh failed for ${email} with synthetic-token`)
    ).pipe(runWorkspaceBrowserEffect("test.reporting"));

    expect(records).toEqual([
      {
        attributes: {
          boundary: "browser",
          errorType: "Error",
          failureCode: "test.browser-failure",
          operation: "test.reporting",
        },
        body: "Workspace browser failure",
        level: "warn",
      },
    ]);
    expect(JSON.stringify(records)).not.toContain(email);
    expect(JSON.stringify(records)).not.toContain("synthetic-token");
  });

  test("discards Effect log output instead of printing raw causes", async () => {
    const email = testEmailAddress("browser-runner-console");
    const spies = (["log", "info", "warn", "error", "debug"] as const).map(
      (method) => spyOn(console, method).mockImplementation(() => undefined)
    );

    try {
      await Effect.logError("Synthetic failure", new Error(email)).pipe(
        runWorkspaceBrowserEffect("test.console")
      );
      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });

  test("keeps the run's outcome when the log sink throws", async () => {
    let attempts = 0;
    detach = deliverWorkspaceBrowserLogs(() => {
      attempts += 1;
      throw new Error("sink unavailable");
    });

    await expect(
      reportWorkspaceBrowserFailure("test.sink-failure", new Error("x")).pipe(
        Effect.as("value"),
        runWorkspaceBrowserEffect("test.sink-failure")
      )
    ).resolves.toBe("value");
    const failure = new SyntheticFailure({ message: "synthetic" });
    await expect(
      reportWorkspaceBrowserFailure("test.sink-failure", failure).pipe(
        Effect.andThen(Effect.fail(failure)),
        runWorkspaceBrowserEffect("test.sink-failure")
      )
    ).rejects.toBe(failure);
    expect(attempts).toBe(2);
  });
});

describe("runWorkspaceBrowserEffectUntilAbort", () => {
  test("settles without rejecting when the lifetime ends mid-run, interrupting the Effect", async () => {
    const lifetime = new AbortController();
    let interrupted = false;
    const run = Effect.never.pipe(
      Effect.onInterrupt(() =>
        Effect.sync(() => {
          interrupted = true;
        })
      ),
      runWorkspaceBrowserEffectUntilAbort("test.lifetime", lifetime.signal)
    );

    lifetime.abort();

    await expect(run).resolves.toBeUndefined();
    expect(interrupted).toBe(true);
  });

  test("ends at once for a lifetime that already ended", async () => {
    let started = false;

    await expect(
      Effect.sync(() => {
        started = true;
      }).pipe(
        Effect.delay("1 millis"),
        runWorkspaceBrowserEffectUntilAbort("test.ended", AbortSignal.abort())
      )
    ).resolves.toBeUndefined();
    expect(started).toBe(false);
  });

  test("still rejects with a failure", async () => {
    await expect(
      Effect.fail(new SyntheticFailure({ message: "synthetic" })).pipe(
        runWorkspaceBrowserEffectUntilAbort(
          "test.failure",
          new AbortController().signal
        )
      )
    ).rejects.toMatchObject({ message: "synthetic" });
  });
});
