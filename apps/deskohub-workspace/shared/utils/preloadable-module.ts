import { useEffect, useSyncExternalStore } from "react";

/**
 * A code-split module that callers can start loading ahead of need and then
 * read synchronously, so UI waiting on it can stay closed until it is ready
 * instead of rendering a fallback first.
 */
export type PreloadableModule<Module> = {
  readonly getLoaded: () => Module | undefined;
  readonly load: () => Promise<Module>;
  readonly preload: () => void;
  readonly subscribe: (listener: () => void) => () => void;
};

export const createPreloadableModule = <Module>(
  importModule: () => Promise<Module>
): PreloadableModule<Module> => {
  let loaded: Module | undefined;
  let pending: Promise<Module> | undefined;
  const listeners = new Set<() => void>();

  const load = () => {
    if (pending) return pending;

    const request = importModule().then((loadedModule) => {
      loaded = loadedModule;
      for (const listener of listeners) listener();
      return loadedModule;
    });
    pending = request;
    // Let the next request retry a failed chunk load.
    request.catch(() => {
      pending = undefined;
    });
    return request;
  };

  return {
    getLoaded: () => loaded,
    load,
    preload: () => {
      load().catch(() => undefined);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};

const getUnloadedModule = () => undefined;

/** The module once loaded; `undefined` until then and during hydration. */
export const useLoadedModule = <Module>(
  preloadable: PreloadableModule<Module>
): Module | undefined =>
  useSyncExternalStore(
    preloadable.subscribe,
    preloadable.getLoaded,
    getUnloadedModule
  );

/** Preloads the module once the browser is idle after the caller mounts. */
export const usePreloadWhenIdle = (preloadable: PreloadableModule<unknown>) => {
  useEffect(() => {
    if (!("requestIdleCallback" in window)) {
      const timeout = setTimeout(preloadable.preload, 1);
      return () => clearTimeout(timeout);
    }

    const idleCallback = window.requestIdleCallback(preloadable.preload);
    return () => window.cancelIdleCallback(idleCallback);
  }, [preloadable]);
};
