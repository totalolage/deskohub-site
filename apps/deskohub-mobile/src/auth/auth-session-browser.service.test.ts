import { describe, expect, test } from "bun:test";
import { Effect, Exit, Fiber, Layer, ManagedRuntime } from "effect";
import { TestClock } from "effect/testing";
import type { WebBrowserCustomTabsResults } from "expo-web-browser";
import type { AppStateStatus } from "react-native";
import type {
  TrustedWebActivityColors,
  TrustedWebActivityProvider,
} from "../../modules/trusted-web-activity";
import {
  AuthSessionBrowser,
  AuthSessionResult,
  AuthSessionUnavailable,
} from "./auth-session-browser.service";
import {
  AuthSessionDevice,
  type CustomTabOptions,
} from "./auth-session-device.service";

const signInUrl =
  "https://workspace.deskohub.cz/app/sign-in?native=1&state=state-1";
const returnUri = "deskohub://auth/callback";
const callbackUrl = `${returnUri}?code=code-1&state=state-1`;
const chrome: TrustedWebActivityProvider = {
  packageName: "com.android.chrome",
  launchMode: "trusted-web-activity",
};

/**
 * An Android device with a browser: the test plays the browser, sending the
 * app links and moving it between foreground and background.
 */
const makeDevice = ({
  platform = "android",
  provider = chrome,
  findProvider = () => provider,
  launch = async () => undefined,
  customTabsBrowsers = async () => ({
    browserPackages: ["com.android.chrome"],
    defaultBrowserPackage: "com.android.chrome",
    servicePackages: ["com.android.chrome"],
  }),
}: {
  readonly platform?: string;
  readonly provider?: TrustedWebActivityProvider | null;
  readonly findProvider?: () => TrustedWebActivityProvider | null;
  readonly launch?: () => Promise<void>;
  readonly customTabsBrowsers?: () => Promise<WebBrowserCustomTabsResults>;
} = {}) => {
  const urlListeners = new Set<(url: string) => void>();
  const appStateListeners = new Set<(state: AppStateStatus) => void>();
  const launches: Array<{
    readonly url: string;
    readonly provider: TrustedWebActivityProvider;
    readonly colors: TrustedWebActivityColors;
  }> = [];
  const authSessions: Array<{
    readonly url: string;
    readonly options: CustomTabOptions | undefined;
  }> = [];
  let customTabsLookups = 0;
  let releases = 0;
  const device = Layer.succeed(AuthSessionDevice, {
    platform,
    trustedWebActivity: {
      findProvider,
      launch: (url, launchedProvider, colors) => {
        launches.push({ url, provider: launchedProvider, colors });
        return launch();
      },
      release: async () => {
        releases += 1;
      },
    },
    findCustomTabsBrowsers: () => {
      customTabsLookups += 1;
      return customTabsBrowsers();
    },
    openAuthSession: async (url, _returnUri, options) => {
      authSessions.push({ url, options });
      return { type: "success", url: callbackUrl };
    },
    onUrl: (listener) => {
      urlListeners.add(listener);
      return { remove: () => urlListeners.delete(listener) };
    },
    onAppStateChange: (listener) => {
      appStateListeners.add(listener);
      return { remove: () => appStateListeners.delete(listener) };
    },
  });
  const runtime = ManagedRuntime.make(
    Layer.mergeAll(
      AuthSessionBrowser.Default.pipe(Layer.provide(device)),
      TestClock.layer()
    )
  );
  const open = () =>
    Effect.gen(function* () {
      const browser = yield* AuthSessionBrowser;
      return yield* browser.open(signInUrl, returnUri);
    });
  return {
    launches,
    authSessions,
    customTabsLookups: () => customTabsLookups,
    releases: () => releases,
    listeners: () => urlListeners.size + appStateListeners.size,
    sendLink: (url: string) => {
      for (const listener of [...urlListeners]) listener(url);
    },
    moveApp: (state: AppStateStatus) => {
      for (const listener of [...appStateListeners]) listener(state);
    },
    open: () => runtime.runPromiseExit(open()),
    /** Starts opening the sign-in page and waits until the browser shows it. */
    startOpen: async () => {
      const fiber = runtime.runFork(open());
      await settle();
      return fiber;
    },
    adjustClock: (duration: `${number} seconds`) =>
      runtime.runPromise(TestClock.adjust(duration)),
  };
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("Trusted Web Activity sign-in", () => {
  test("opens the sign-in page with the brand colours", async () => {
    const device = makeDevice();
    const fiber = await device.startOpen();

    expect(device.launches).toEqual([
      {
        url: signInUrl,
        provider: chrome,
        colors: { toolbar: "#00024f", navigationBar: "#00024f" },
      },
    ]);
    expect(device.authSessions).toEqual([]);
    await Effect.runPromise(Fiber.interrupt(fiber));
  });

  test("returns with the callback link the page sends to the app", async () => {
    const device = makeDevice();
    const fiber = await device.startOpen();
    device.moveApp("background");
    device.sendLink("https://workspace.deskohub.cz/app/");
    device.sendLink(callbackUrl);
    device.moveApp("active");

    expect(await Effect.runPromise(Fiber.join(fiber))).toEqual(
      AuthSessionResult.Returned({ url: callbackUrl })
    );
    expect(device.listeners()).toBe(0);
    expect(device.releases()).toBe(1);
  });

  test("closes once the customer comes back to the app without a link", async () => {
    const device = makeDevice();
    const fiber = await device.startOpen();
    // The app is still in front until the browser covers it.
    device.moveApp("active");
    await settle();
    expect(fiber.pollUnsafe()).toBeUndefined();

    device.moveApp("background");
    device.moveApp("active");

    expect(await Effect.runPromise(Fiber.join(fiber))).toEqual(
      AuthSessionResult.Closed()
    );
    expect(device.listeners()).toBe(0);
    expect(device.releases()).toBe(1);
  });

  test("stops listening when the sign-in is abandoned", async () => {
    const device = makeDevice();
    const fiber = await device.startOpen();
    expect(device.listeners()).toBe(2);

    await Effect.runPromise(Fiber.interrupt(fiber));

    expect(device.listeners()).toBe(0);
    expect(device.releases()).toBe(1);
  });

  test("refuses a second page while one is open, then opens again", async () => {
    const device = makeDevice();
    const first = await device.startOpen();

    expect(await device.open()).toEqual(
      Exit.fail(
        new AuthSessionUnavailable({
          cause: new Error("A sign-in page is already open"),
        })
      )
    );
    expect(device.launches).toHaveLength(1);

    device.moveApp("background");
    device.sendLink(callbackUrl);
    await Effect.runPromise(Fiber.join(first));

    const third = await device.startOpen();
    expect(device.launches).toHaveLength(2);
    await Effect.runPromise(Fiber.interrupt(third));
  });

  test("reports the session unavailable when the browser can't launch", async () => {
    const launchFailure = new Error("No activity to launch from");
    const device = makeDevice({ launch: () => Promise.reject(launchFailure) });

    expect(await device.open()).toEqual(
      Exit.fail(new AuthSessionUnavailable({ cause: launchFailure }))
    );
    expect(device.listeners()).toBe(0);
    expect(device.releases()).toBe(1);

    // The failed launch doesn't block the next one.
    const retry = await device.startOpen();
    expect(device.launches).toHaveLength(2);
    await Effect.runPromise(Fiber.interrupt(retry));
  });

  test("gives up on a browser that never shows the page", async () => {
    const device = makeDevice({ launch: () => new Promise(() => undefined) });
    const fiber = await device.startOpen();

    await device.adjustClock("10 seconds");

    expect(await Effect.runPromiseExit(Fiber.join(fiber))).toEqual(
      Exit.fail(
        new AuthSessionUnavailable({
          cause: new Error("The browser didn't open the sign-in page"),
        })
      )
    );
    expect(device.listeners()).toBe(0);
    expect(device.releases()).toBe(1);
  });
});

describe("auth session sign-in", () => {
  test("iOS opens its auth session without a browser lookup", async () => {
    const device = makeDevice({ platform: "ios" });

    expect(await device.open()).toEqual(
      Exit.succeed(AuthSessionResult.Returned({ url: callbackUrl }))
    );
    expect(device.authSessions).toEqual([
      { url: signInUrl, options: undefined },
    ]);
    expect(device.customTabsLookups()).toBe(0);
    expect(device.launches).toEqual([]);
  });

  test.each([
    [
      "only a Custom Tabs browser",
      {
        provider: {
          packageName: "org.example.browser",
          launchMode: "custom-tab",
        },
      },
    ],
    [
      "only a plain browser",
      {
        provider: {
          packageName: "org.example.browser",
          launchMode: "browser",
        },
      },
    ],
    ["no Trusted Web Activity browser", { provider: null }],
    [
      "a failing browser picker",
      {
        findProvider: () => {
          throw new Error("TwaProviderPicker failed");
        },
      },
    ],
  ] as const)(
    "Android with %s opens a Custom Tabs auth session",
    async (_, options) => {
      const device = makeDevice(options);

      expect(await device.open()).toEqual(
        Exit.succeed(AuthSessionResult.Returned({ url: callbackUrl }))
      );
      expect(device.authSessions).toEqual([
        {
          url: signInUrl,
          options: { browserPackage: "com.android.chrome", createTask: false },
        },
      ]);
      expect(device.launches).toEqual([]);
    }
  );

  test("a Trusted Web Activity skips the Custom Tabs lookup", async () => {
    const device = makeDevice();
    const fiber = await device.startOpen();
    device.sendLink(callbackUrl);

    expect(await Effect.runPromise(Fiber.join(fiber))).toEqual(
      AuthSessionResult.Returned({ url: callbackUrl })
    );
    expect(device.customTabsLookups()).toBe(0);
    expect(device.authSessions).toEqual([]);
  });

  test("Android without a Trusted Web Activity fails as unavailable when no Custom Tabs browser is known", async () => {
    const device = makeDevice({
      provider: null,
      customTabsBrowsers: async () => ({
        browserPackages: [],
        servicePackages: [],
      }),
    });

    expect(await device.open()).toEqual(
      Exit.fail(
        new AuthSessionUnavailable({
          cause: "No browser supports Custom Tabs.",
        })
      )
    );
    expect(device.authSessions).toEqual([]);
  });

  test("Android without a Trusted Web Activity fails as unavailable when the browser lookup fails", async () => {
    const lookupFailure = new Error("no package manager");
    const device = makeDevice({
      provider: null,
      customTabsBrowsers: () => Promise.reject(lookupFailure),
    });

    expect(await device.open()).toEqual(
      Exit.fail(new AuthSessionUnavailable({ cause: lookupFailure }))
    );
    expect(device.authSessions).toEqual([]);
  });
});
