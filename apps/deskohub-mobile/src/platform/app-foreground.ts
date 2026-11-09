import { Atom } from "effect/unstable/reactivity";
import { AppState, type AppStateStatus } from "react-native";

/** The part of React Native's `AppState` the foreground atom listens to. */
export interface AppStateSource {
  /** As React Native types it: any string, or none before the first report. */
  readonly currentState: string | null | undefined;
  readonly addEventListener: (
    type: "change",
    listener: (state: AppStateStatus) => void
  ) => { readonly remove: () => void };
}

/**
 * Whether the app is in the foreground, following `source` while anything
 * reads it. Background work that should pause off screen, such as automatic
 * refreshes, depends on it so that leaving the app interrupts that work.
 */
export const makeAppForegroundAtom = (source: AppStateSource) =>
  Atom.make((get) => {
    const subscription = source.addEventListener("change", (state) =>
      get.setSelf(state === "active")
    );
    get.addFinalizer(() => subscription.remove());
    return source.currentState === "active";
  });

/** Whether the app is in the foreground (`AppState` is "active"). */
export const appForegroundAtom = makeAppForegroundAtom(AppState);
