import {
  type InstalledRelatedApp,
  includesAndroidApp,
} from "./install-android-app";
import {
  detectInstallPlatform,
  type InstallPlatform,
  type InstallPlatformSignals,
  isStandaloneDisplay,
} from "./install-platform";

/** What the browser reports about installing the app, as it is now. */
export type InstallEnvironment = {
  readonly platform: InstallPlatform;
  readonly standalone: boolean;
  /** `undefined` while the browser is still looking the app up. */
  readonly androidAppInstalled: boolean | undefined;
  readonly installPromptAvailable: boolean;
};

/**
 * The browser APIs the install offer reads. `standalone` (iOS Safari) and
 * `getInstalledRelatedApps` (Chromium) are declared here because the DOM
 * library doesn't include them.
 */
export type InstallBrowser = {
  readonly navigator: InstallPlatformSignals & {
    readonly standalone?: boolean;
    readonly getInstalledRelatedApps?: () => Promise<
      readonly InstalledRelatedApp[]
    >;
  };
  readonly matchMedia: (query: string) => { readonly matches: boolean };
  readonly addEventListener: (
    type: string,
    listener: (event: Event) => void
  ) => void;
};

/** Chromium's `beforeinstallprompt` event, missing from the DOM library. */
type BeforeInstallPromptEvent = Event & {
  readonly prompt: () => Promise<unknown>;
};

const isBeforeInstallPromptEvent = (
  event: Event
): event is BeforeInstallPromptEvent => "prompt" in event;

export type InstallEnvironmentStore = {
  readonly getSnapshot: () => InstallEnvironment;
  readonly subscribe: (onChange: () => void) => () => void;
  /**
   * Shows the captured install prompt and drops it: an event's prompt can be
   * shown only once, whatever the visitor answers. Chromium sends a new event
   * when it would offer the install again.
   */
  readonly promptInstall: () => Promise<void>;
};

/**
 * Tracks the install environment of one browser window: the platform and
 * display mode once, the Android app lookup on Android, and the install
 * prompt that desktop Chromium offers until the web app is installed.
 */
export const createInstallEnvironment = (
  browser: InstallBrowser
): InstallEnvironmentStore => {
  const { navigator } = browser;
  const platform = detectInstallPlatform(navigator);
  const listeners = new Set<() => void>();
  let installPrompt: BeforeInstallPromptEvent | undefined;
  let snapshot: InstallEnvironment = {
    platform,
    standalone: isStandaloneDisplay({
      displayModeStandalone: browser.matchMedia("(display-mode: standalone)")
        .matches,
      navigatorStandalone: navigator.standalone,
    }),
    androidAppInstalled: platform === "android" ? undefined : false,
    installPromptAvailable: false,
  };

  const update = (change: Partial<InstallEnvironment>) => {
    snapshot = { ...snapshot, ...change };
    for (const listener of listeners) listener();
  };
  const dropInstallPrompt = () => {
    installPrompt = undefined;
    if (snapshot.installPromptAvailable) {
      update({ installPromptAvailable: false });
    }
  };

  browser.addEventListener("beforeinstallprompt", (event) => {
    if (!isBeforeInstallPromptEvent(event)) return;
    event.preventDefault();
    installPrompt = event;
    update({ installPromptAvailable: true });
  });
  browser.addEventListener("appinstalled", dropInstallPrompt);

  if (platform === "android") {
    // A missing API, a synchronous throw and a rejection all mean the app
    // can't be found.
    void Promise.resolve()
      .then(() => navigator.getInstalledRelatedApps?.() ?? [])
      .then(
        (relatedApps) =>
          update({ androidAppInstalled: includesAndroidApp(relatedApps) }),
        () => update({ androidAppInstalled: false })
      );
  }

  return {
    getSnapshot: () => snapshot,
    subscribe: (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    promptInstall: async () => {
      const prompt = installPrompt;
      if (!prompt) return;
      dropInstallPrompt();
      // A refused prompt leaves nothing to retry.
      await prompt.prompt().catch(() => undefined);
    },
  };
};

const browserEnvironments = new WeakMap<object, InstallEnvironmentStore>();

/** The current window's install environment; `undefined` on the server. */
export const browserInstallEnvironment = ():
  | InstallEnvironmentStore
  | undefined => {
  const browser = globalThis.window;
  if (browser === undefined) return undefined;
  let environment = browserEnvironments.get(browser);
  if (!environment) {
    environment = createInstallEnvironment(browser);
    browserEnvironments.set(browser, environment);
  }
  return environment;
};

// Start listening when the client bundle loads, so an install prompt fired
// before the footer hydrates isn't lost.
browserInstallEnvironment();
