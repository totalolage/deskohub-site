import { RegistryContext } from "@effect/atom-react";
import { Atom } from "effect/unstable/reactivity";
import { useContext, useEffect } from "react";

/**
 * Forgets a settled save or completion when the screen goes, so the next
 * visit starts without the last message. One still running keeps going: the
 * server may apply it, and its account read must still happen.
 */
export function useSettledResultReset(
  atom: Atom.Writable<{ readonly waiting: boolean }, typeof Atom.Reset>
) {
  const registry = useContext(RegistryContext);
  useEffect(
    () => () => {
      if (!registry.get(atom).waiting) registry.set(atom, Atom.Reset);
    },
    [registry, atom]
  );
}
