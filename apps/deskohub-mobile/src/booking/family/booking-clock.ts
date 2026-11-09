import { Stream } from "effect";
import { AsyncResult, Atom } from "effect/unstable/reactivity";

/** The current time, read again every 30 seconds while a screen reads it. */
const clockTicksAtom = Atom.make(
  Stream.tick("30 seconds").pipe(Stream.map(() => new Date()))
);

/**
 * The current time for the selection screens, so the same-day Open Space
 * cutoff and ended meeting-room starts take effect without a selection
 * change.
 */
export const bookingClockAtom = Atom.map(clockTicksAtom, (ticks) =>
  AsyncResult.getOrElse(ticks, () => new Date())
);
