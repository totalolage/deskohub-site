import { Effect } from "effect";
import { PasskeyCeremonies, type PasskeyCeremonyApi } from "./passkey-ceremony";
import type { PasskeyFailure } from "./passkey-failure";

/** What a passkey control shows. */
export type PasskeyCeremonyState<A> =
  | { readonly status: "idle" }
  | { readonly status: "pending" }
  | { readonly status: "succeeded"; readonly value: A }
  | { readonly status: "failed"; readonly failure: PasskeyFailure };

/**
 * A control's state once another sign-in method starts: an earlier failure
 * gives way, so its alert doesn't stay up beside the new attempt.
 */
export const withoutEarlierFailure = <A>(
  state: PasskeyCeremonyState<A>
): PasskeyCeremonyState<A> =>
  state.status === "failed" ? { status: "idle" } : state;

/**
 * Failures a control settles quietly: the customer closed the prompt, or
 * another control's ceremony is still running.
 */
const isQuiet = (failure: PasskeyFailure) =>
  failure._tag === "PasskeyCancelled" || failure._tag === "PasskeyCeremonyBusy";

/**
 * One run of a control's ceremony. `onPendingChange` tells the screen while
 * the ceremony may change the session, so it can hold its other sign-in
 * methods: it turns true before the prompt opens and false only after
 * `onSucceeded` has run, or once the ceremony fails or is interrupted.
 * `takeOver` may claim a failure for its caller, and the control then
 * returns to idle.
 */
export const passkeyCeremonyAttempt = <A>({
  ceremony,
  setState,
  onSucceeded,
  takeOver = () => false,
  onPendingChange,
}: {
  readonly ceremony: (
    ceremonies: PasskeyCeremonyApi
  ) => Effect.Effect<A, PasskeyFailure>;
  readonly setState: (state: PasskeyCeremonyState<A>) => void;
  readonly onSucceeded?: (value: A) => void;
  readonly takeOver?: (failure: PasskeyFailure) => boolean;
  readonly onPendingChange?: (pending: boolean) => void;
}): Effect.Effect<void, never, PasskeyCeremonies> =>
  Effect.service(PasskeyCeremonies).pipe(
    Effect.tap(() =>
      Effect.sync(() => {
        setState({ status: "pending" });
        onPendingChange?.(true);
      })
    ),
    Effect.flatMap(ceremony),
    Effect.match({
      onSuccess: (value) => {
        setState({ status: "succeeded", value });
        onSucceeded?.(value);
      },
      onFailure: (failure) => {
        const quiet = isQuiet(failure) || takeOver(failure);
        setState(quiet ? { status: "idle" } : { status: "failed", failure });
      },
    }),
    Effect.ensuring(Effect.sync(() => onPendingChange?.(false)))
  );
