import { Atom } from "effect/unstable/reactivity";

/** How often the selection screens re-read the time. */
const tick = 30_000;

/**
 * The current time for the selection screens, refreshed every 30 seconds
 * while a screen reads it, so the same-day Open Space cutoff and ended
 * meeting-room starts take effect without a selection change.
 */
export const bookingClockAtom = Atom.make((get) => {
  const timer = setInterval(() => get.setSelf(new Date()), tick);
  get.addFinalizer(() => clearInterval(timer));
  return new Date();
});
