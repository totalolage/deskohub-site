import { Effect, type Fiber } from "effect";
import { useEffect, useRef, useState } from "react";
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
  const running = useRef<Fiber.Fiber<void>>(undefined);

  useEffect(() => () => running.current?.interruptUnsafe(), []);

  const start = () => {
    if (running.current) return;
    setState({ status: "pending" });
    running.current = Effect.runFork(
      ceremony().pipe(
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
        }),
        Effect.ensuring(
          Effect.sync(() => {
            running.current = undefined;
          })
        )
      )
    );
  };

  return { state, start };
};
