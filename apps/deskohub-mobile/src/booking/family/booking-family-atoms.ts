import { AsyncResult, Atom } from "effect/unstable/reactivity";

/**
 * Stands in for a read a screen doesn't need for its draft, so the screen
 * reads the same number of atoms on every render.
 */
export const unneededReadAtom = Atom.make(AsyncResult.initial<never, never>());
