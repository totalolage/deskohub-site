import type { Effect } from "effect";
import { useCallback, useEffect, useState } from "react";
import { makeCeremonyRun } from "./ceremony-run";
import type { PasskeyCeremonyApi } from "./passkey-ceremony";
import {
  type PasskeyCeremonyState,
  passkeyCeremonyAttempt,
  withoutEarlierFailure,
} from "./passkey-ceremony-attempt";
import type { PasskeyFailure } from "./passkey-failure";
import { passkeyRuntime } from "./passkey-runtime";

/**
 * Runs one passkey ceremony per control at a time. `start` runs `ceremony`
 * unless one is already running; leaving the screen interrupts it.
 * `clearFailure` drops an earlier failure once another method starts. See
 * `passkeyCeremonyAttempt` for `takeOver` and `onPendingChange`.
 */
export const usePasskeyCeremony = <A>({
  ceremony,
  onSucceeded,
  takeOver,
  onPendingChange,
}: {
  readonly ceremony: (
    ceremonies: PasskeyCeremonyApi
  ) => Effect.Effect<A, PasskeyFailure>;
  readonly onSucceeded?: (value: A) => void;
  readonly takeOver?: (failure: PasskeyFailure) => boolean;
  readonly onPendingChange?: (pending: boolean) => void;
}) => {
  const [state, setState] = useState<PasskeyCeremonyState<A>>({
    status: "idle",
  });
  const [run] = useState(() => makeCeremonyRun(passkeyRuntime));

  useEffect(() => run.interrupt, [run]);

  const start = () =>
    run.start(
      passkeyCeremonyAttempt({
        ceremony,
        setState,
        onSucceeded,
        takeOver,
        onPendingChange,
      })
    );

  const clearFailure = useCallback(() => setState(withoutEarlierFailure), []);

  return { state, start, clearFailure };
};
