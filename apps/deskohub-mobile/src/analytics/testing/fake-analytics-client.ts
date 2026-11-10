import type {
  AnalyticsClient,
  AnalyticsClientOptions,
} from "../analytics-client";

export type FakeAnalyticsClientCall = readonly [string, ...unknown[]];

/**
 * An SDK client that records each call. It finishes loading at once unless
 * `holdLoading`, and reports `restoredDistinctId` as its stored identity.
 */
export const makeFakeAnalyticsClient = (
  options: AnalyticsClientOptions,
  restoredDistinctId: string | null = null,
  holdLoading = false
) => {
  const calls: FakeAnalyticsClientCall[] = [];
  const flagListeners = new Set<() => void>();
  let flags: Record<string, boolean | string> | undefined;
  let networkHeld = false;
  let finishShutdown: () => void = () => {};
  let failShutdown: () => void = () => {};
  let finishLoading: () => void = () => {};
  let failLoading: () => void = () => {};
  const flagReloads: {
    readonly resolve: () => void;
    readonly reject: (error: Error) => void;
  }[] = [];
  const loading = new Promise<void>((resolve, reject) => {
    finishLoading = resolve;
    failLoading = () => reject(new Error("storage"));
  });
  if (!holdLoading) finishLoading();
  const client: AnalyticsClient = {
    ready: () => loading,
    identifiedAs: () => restoredDistinctId,
    capture: (event, properties) => calls.push(["capture", event, properties]),
    screen: (name) => calls.push(["screen", name]),
    identify: (distinctId) => calls.push(["identify", distinctId]),
    setPersonProperties: (properties) =>
      calls.push(["setPersonProperties", properties]),
    reset: () => calls.push(["reset"]),
    reloadFeatureFlags: () => {
      calls.push(["reloadFeatureFlags"]);
      return new Promise<void>((resolve, reject) => {
        flagReloads.push({ resolve, reject });
      });
    },
    getFeatureFlag: (flag) => flags?.[flag],
    holdNetwork: (held) => {
      if (networkHeld !== held) calls.push(["holdNetwork", held]);
      networkHeld = held;
    },
    onFeatureFlags: (listener) => {
      flagListeners.add(listener);
      return () => flagListeners.delete(listener);
    },
    shutDown: () => {
      calls.push(["shutDown"]);
      return new Promise<void>((resolve, reject) => {
        finishShutdown = resolve;
        failShutdown = () => reject(new Error("storage"));
      });
    },
  };
  return {
    client,
    options,
    calls,
    /** The SDK stores flag values and notifies, as any flags response does. */
    loadFlags: (next: Record<string, boolean | string>) => {
      flags = next;
      for (const listener of flagListeners) listener();
    },
    /** Settles the `index`th reload the controller asked for. */
    finishFlagReload: (
      index: number,
      next: Record<string, boolean | string>
    ) => {
      flags = next;
      for (const listener of flagListeners) listener();
      flagReloads[index]?.resolve();
    },
    failFlagReload: (index: number) =>
      flagReloads[index]?.reject(new Error("flags")),
    finishShutdown: () => finishShutdown(),
    /** Shutdown fails, so the client's stored state may remain. */
    failShutdown: () => failShutdown(),
    finishLoading: () => finishLoading(),
    failLoading: () => failLoading(),
    flagListenerCount: () => flagListeners.size,
    networkHeld: () => networkHeld,
  };
};

export type FakeAnalyticsClient = ReturnType<typeof makeFakeAnalyticsClient>;
