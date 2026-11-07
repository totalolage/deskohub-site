import { Effect, type Fiber } from "effect";
import { useEffect, useState } from "react";
import type { PasskeyFailure } from "./passkey-failure";

/** What a passkey control shows. */
export type PasskeyCeremonyState<A> =
  | { readonly status: "idle" }
  | { readonly status: "pending" }
  | { readonly status: "succeeded"; readonly value: A }
  | { readonly status: "failed"; readonly failure: PasskeyFailure };

/**
 * Failures a control settles quietly: the customer closed the prompt, or
 * another control's ceremony is still running.
 */
const isQuiet = (failure: PasskeyFailure) =>
  failure._tag === "PasskeyCancelled" || failure._tag === "PasskeyCeremonyBusy";

/**
 * The ceremony a control runs, at most one at a time: `start` does nothing
 * while one runs, and `interrupt` stops it without reporting an outcome.
 * This is the hook's one run edge.
 */
export const makeCeremonyRun = () => {
  let running: Fiber.Fiber<void> | undefined;
  return {
    start: (ceremony: Effect.Effect<void>) => {
      if (running) return;
      const fiber = Effect.runFork(ceremony);
      running = fiber;
      // A ceremony can settle before `runFork` returns, such as on a device
      // without passkeys; the observer still runs for it.
      fiber.addObserver(() => {
        if (running === fiber) running = undefined;
      });
    },
    interrupt: () => running?.interruptUnsafe(),
  };
};

/**
 * Runs one passkey ceremony per control at a time. `start` runs `ceremony`
 * unless one is already running; leaving the screen interrupts it.
 * `takeOver` may claim a failure for its caller, such as a stale session
 * that needs reauthentication, and the control then returns to idle.
 */
export const usePasskeyCeremony = <A>({
  ceremony,
  onSucceeded,
  takeOver = () => false,
}: {
  readonly ceremony: () => Effect.Effect<A, PasskeyFailure>;
  readonly onSucceeded?: (value: A) => void;
  readonly takeOver?: (failure: PasskeyFailure) => boolean;
}) => {
  const [state, setState] = useState<PasskeyCeremonyState<A>>({
    status: "idle",
  });
  const [run] = useState(makeCeremonyRun);

  useEffect(() => run.interrupt, [run]);

  const start = () =>
    run.start(
      Effect.suspend(() => {
        setState({ status: "pending" });
        return ceremony();
      }).pipe(
        Effect.match({
          onSuccess: (value) => {
            setState({ status: "succeeded", value });
            onSucceeded?.(value);
          },
          onFailure: (failure) => {
            const quiet = isQuiet(failure) || takeOver(failure);
            setState(
              quiet ? { status: "idle" } : { status: "failed", failure }
            );
          },
        })
      )
    );

  return { state, start };
};
