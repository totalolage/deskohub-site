import { Effect } from "effect";
import { useEffect, useState } from "react";
import { makeCeremonyRun } from "./ceremony-run";
import { PasskeyCeremonies, type PasskeyCeremonyApi } from "./passkey-ceremony";
import type { PasskeyFailure } from "./passkey-failure";
import { passkeyRuntime } from "./passkey-runtime";

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
  readonly ceremony: (
    ceremonies: PasskeyCeremonyApi
  ) => Effect.Effect<A, PasskeyFailure>;
  readonly onSucceeded?: (value: A) => void;
  readonly takeOver?: (failure: PasskeyFailure) => boolean;
}) => {
  const [state, setState] = useState<PasskeyCeremonyState<A>>({
    status: "idle",
  });
  const [run] = useState(() => makeCeremonyRun(passkeyRuntime));

  useEffect(() => run.interrupt, [run]);

  const start = () =>
    run.start(
      Effect.service(PasskeyCeremonies).pipe(
        Effect.tap(() => Effect.sync(() => setState({ status: "pending" }))),
        Effect.flatMap(ceremony),
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
