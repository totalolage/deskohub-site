import { describe, expect, test } from "bun:test";
import { Deferred, Effect, Exit, Layer, ManagedRuntime } from "effect";
import { makeCeremonyRun } from "./ceremony-run";
import { PasskeyCeremonies, type PasskeyCeremonyApi } from "./passkey-ceremony";
import {
  type PasskeyCeremonyState,
  passkeyCeremonyAttempt,
  withoutEarlierFailure,
} from "./passkey-ceremony-attempt";
import {
  PasskeyCancelled,
  type PasskeyFailure,
  PasskeyNoCredential,
  PasskeyRejected,
} from "./passkey-failure";

/** Ceremonies whose sign-in waits for the test to settle it. */
const pausedCeremonies = () => {
  const settle = Deferred.makeUnsafe<void, PasskeyFailure>();
  const api: PasskeyCeremonyApi = {
    isSupported: Effect.succeed(true),
    signIn: Deferred.await(settle),
    addPasskey: () => Effect.die("not used"),
  };
  const runtime = ManagedRuntime.make(Layer.succeed(PasskeyCeremonies, api));
  return { settle, runtime };
};

/** Runs a sign-in attempt and logs what the control and screen hear. */
const startSignIn = (takeOver?: (failure: PasskeyFailure) => boolean) => {
  const { settle, runtime } = pausedCeremonies();
  const events: Array<string> = [];
  const run = makeCeremonyRun(runtime);
  run.start(
    passkeyCeremonyAttempt({
      ceremony: (ceremonies) => ceremonies.signIn,
      setState: (state) => events.push(`state:${state.status}`),
      onSucceeded: () => events.push("signed-in"),
      takeOver,
      onPendingChange: (pending) => events.push(`pending:${pending}`),
    })
  );
  const settled = () => Effect.runPromise(Effect.yieldNow);
  return { settle, run, events, settled };
};

describe("passkeyCeremonyAttempt", () => {
  test("holds the screen from the prompt until the sign-in is handed on", async () => {
    const { settle, events, settled } = startSignIn();
    await settled();
    // While the prompt is open, the screen holds its other methods.
    expect(events).toEqual(["state:pending", "pending:true"]);

    Deferred.doneUnsafe(settle, Exit.void);
    await settled();
    expect(events).toEqual([
      "state:pending",
      "pending:true",
      "state:succeeded",
      "signed-in",
      "pending:false",
    ]);
  });

  test("releases the screen once a ceremony fails", async () => {
    const { settle, events, settled } = startSignIn();
    Deferred.doneUnsafe(settle, Exit.fail(new PasskeyNoCredential()));
    await settled();
    expect(events).toEqual([
      "state:pending",
      "pending:true",
      "state:failed",
      "pending:false",
    ]);
  });

  test("settles a cancelled prompt quietly and releases the screen", async () => {
    const { settle, events, settled } = startSignIn();
    Deferred.doneUnsafe(settle, Exit.fail(new PasskeyCancelled()));
    await settled();
    expect(events).toEqual([
      "state:pending",
      "pending:true",
      "state:idle",
      "pending:false",
    ]);
  });

  test("returns to idle for a failure its caller takes over", async () => {
    const claimed: Array<PasskeyFailure> = [];
    const { settle, events, settled } = startSignIn((failure) => {
      claimed.push(failure);
      return true;
    });
    const stale = new PasskeyRejected({
      status: 403,
      code: "SESSION_NOT_FRESH",
    });
    Deferred.doneUnsafe(settle, Exit.fail(stale));
    await settled();
    expect(claimed).toEqual([stale]);
    expect(events).toEqual([
      "state:pending",
      "pending:true",
      "state:idle",
      "pending:false",
    ]);
  });

  test("releases the screen when the control leaves mid-ceremony", async () => {
    const { settle, run, events, settled } = startSignIn();
    await settled();
    run.interrupt();
    await settled();
    Deferred.doneUnsafe(settle, Exit.void);
    await settled();
    expect(events).toEqual(["state:pending", "pending:true", "pending:false"]);
  });
});

describe("withoutEarlierFailure", () => {
  // Another sign-in method starting replaces the control's earlier failure,
  // so its alert doesn't stay up beside the new attempt.
  test("returns a failed control to idle", () => {
    const failed: PasskeyCeremonyState<void> = {
      status: "failed",
      failure: new PasskeyNoCredential(),
    };
    expect(withoutEarlierFailure(failed)).toEqual({ status: "idle" });
  });

  test("leaves a running or finished ceremony as it is", () => {
    const states: ReadonlyArray<PasskeyCeremonyState<string>> = [
      { status: "idle" },
      { status: "pending" },
      { status: "succeeded", value: "passkey" },
    ];
    for (const state of states) {
      expect(withoutEarlierFailure(state)).toBe(state);
    }
  });
});
