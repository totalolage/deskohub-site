import type { AppStateStatus } from "react-native";
import type { AppStateSource } from "../app-foreground";

/**
 * An `AppState` stand-in that starts in `initial` and reports each `change`
 * to its listeners, as React Native does when the app enters or leaves the
 * foreground.
 */
export const fakeAppState = (initial: AppStateStatus = "active") => {
  const listeners = new Set<(state: AppStateStatus) => void>();
  const source: AppStateSource = {
    currentState: initial,
    addEventListener: (_type, listener) => {
      listeners.add(listener);
      return { remove: () => listeners.delete(listener) };
    },
  };
  const change = (state: AppStateStatus) => {
    for (const listener of listeners) listener(state);
  };
  return { source, change, listeners };
};
