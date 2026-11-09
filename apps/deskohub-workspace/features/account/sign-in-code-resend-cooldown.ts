import { Clock, Effect, Schedule, Stream } from "effect";
import * as AsyncResult from "effect/unstable/reactivity/AsyncResult";
import * as Atom from "effect/unstable/reactivity/Atom";

/** How long the customer waits before asking for another email. */
export const SIGN_IN_CODE_RESEND_COOLDOWN_MS = 60 * 1000;

const secondsUntil = (availableAt: number, now: number) =>
  Math.max(0, Math.ceil((availableAt - now) / 1000));

/**
 * Whole seconds left until another email may be requested, ticking every
 * second and settling at 0. Keyed by the instant the cooldown ends.
 */
export const resendCooldownSecondsAtom = Atom.family((availableAt: number) => {
  const initialSeconds = secondsUntil(availableAt, Date.now());
  const countdown = Atom.make(
    Stream.fromSchedule(Schedule.spaced("1 second")).pipe(
      Stream.mapEffect(() =>
        Clock.currentTimeMillis.pipe(
          Effect.map((now) => secondsUntil(availableAt, now))
        )
      ),
      Stream.takeUntil((seconds) => seconds === 0)
    ),
    { initialValue: initialSeconds }
  );
  return Atom.map(countdown, (result) =>
    AsyncResult.getOrElse(result, () => initialSeconds)
  );
});
