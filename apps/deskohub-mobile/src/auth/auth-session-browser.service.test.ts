import { describe, expect, test } from "bun:test";
import { Effect, Exit, Fiber } from "effect";
import type { AppStateStatus } from "react-native";
import type {
  TrustedWebActivityColors,
  TrustedWebActivityProvider,
} from "../../modules/trusted-web-activity";
import {
  type AuthSessionDevice,
  AuthSessionResult,
  AuthSessionUnavailable,
  makeOpenAuthSession,
} from "./auth-session-browser.service";

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
  launch = async () => undefined,
}: {
  readonly platform?: string;
  readonly provider?: TrustedWebActivityProvider | null;
  readonly launch?: () => Promise<void>;
} = {}) => {
  const urlListeners = new Set<(url: string) => void>();
  const appStateListeners = new Set<(state: AppStateStatus) => void>();
  const launches: Array<{
    readonly url: string;
    readonly provider: TrustedWebActivityProvider;
    readonly colors: TrustedWebActivityColors;
  }> = [];
  const authSessions: Array<string> = [];
  let releases = 0;
  const device: AuthSessionDevice = {
    platform,
    trustedWebActivity: {
      findProvider: () => provider,
      launch: (url, launchedProvider, colors) => {
        launches.push({ url, provider: launchedProvider, colors });
        return launch();
      },
      release: async () => {
        releases += 1;
      },
    },
    openAuthSession: async (url) => {
      authSessions.push(url);
      return { type: "dismiss" };
    },
    onUrl: (listener) => {
      urlListeners.add(listener);
      return { remove: () => urlListeners.delete(listener) };
    },
    onAppStateChange: (listener) => {
      appStateListeners.add(listener);
      return { remove: () => appStateListeners.delete(listener) };
    },
  };
  return {
    device,
    launches,
    authSessions,
    releases: () => releases,
    listeners: () => urlListeners.size + appStateListeners.size,
    sendLink: (url: string) => {
      for (const listener of [...urlListeners]) listener(url);
    },
    moveApp: (state: AppStateStatus) => {
      for (const listener of [...appStateListeners]) listener(state);
    },
  };
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Starts opening the sign-in page and waits until the browser shows it. */
const startOpen = async (fake: ReturnType<typeof makeDevice>) => {
  const fiber = Effect.runFork(
    makeOpenAuthSession(fake.device)(signInUrl, returnUri)
  );
  await settle();
  return fiber;
};

describe("Trusted Web Activity sign-in", () => {
  test("opens the sign-in page with the brand colours", async () => {
    const fake = makeDevice();
    const fiber = await startOpen(fake);

    expect(fake.launches).toEqual([
      {
        url: signInUrl,
        provider: chrome,
        colors: { toolbar: "#00024f", navigationBar: "#00024f" },
      },
    ]);
    expect(fake.authSessions).toEqual([]);
    await Effect.runPromise(Fiber.interrupt(fiber));
  });

  test("returns with the callback link the page sends to the app", async () => {
    const fake = makeDevice();
    const fiber = await startOpen(fake);
    fake.moveApp("background");
    fake.sendLink("https://workspace.deskohub.cz/app/");
    fake.sendLink(callbackUrl);
    fake.moveApp("active");

    expect(await Effect.runPromise(Fiber.join(fiber))).toEqual(
      AuthSessionResult.Returned({ url: callbackUrl })
    );
    expect(fake.listeners()).toBe(0);
    expect(fake.releases()).toBe(1);
  });

  test("closes once the customer comes back to the app without a link", async () => {
    const fake = makeDevice();
    const fiber = await startOpen(fake);
    // The app is still in front until the browser covers it.
    fake.moveApp("active");
    await settle();
    expect(fiber.pollUnsafe()).toBeUndefined();

    fake.moveApp("background");
    fake.moveApp("active");

    expect(await Effect.runPromise(Fiber.join(fiber))).toEqual(
      AuthSessionResult.Closed()
    );
    expect(fake.listeners()).toBe(0);
    expect(fake.releases()).toBe(1);
  });

  test("stops listening when the sign-in is abandoned", async () => {
    const fake = makeDevice();
    const fiber = await startOpen(fake);
    expect(fake.listeners()).toBe(2);

    await Effect.runPromise(Fiber.interrupt(fiber));

    expect(fake.listeners()).toBe(0);
    expect(fake.releases()).toBe(1);
  });

  test("refuses a second page while one is open, then opens again", async () => {
    const fake = makeDevice();
    const open = makeOpenAuthSession(fake.device);
    const first = Effect.runFork(open(signInUrl, returnUri));
    await settle();

    const second = await Effect.runPromiseExit(open(signInUrl, returnUri));
    expect(second).toEqual(
      Exit.fail(
        new AuthSessionUnavailable({
          cause: new Error("A sign-in page is already open"),
        })
      )
    );
    expect(fake.launches).toHaveLength(1);

    fake.moveApp("background");
    fake.sendLink(callbackUrl);
    await Effect.runPromise(Fiber.join(first));

    const third = Effect.runFork(open(signInUrl, returnUri));
    await settle();
    expect(fake.launches).toHaveLength(2);
    await Effect.runPromise(Fiber.interrupt(third));
  });

  test("reports the session unavailable when the browser can't launch", async () => {
    const launchFailure = new Error("No activity to launch from");
    const fake = makeDevice({ launch: () => Promise.reject(launchFailure) });
    const open = makeOpenAuthSession(fake.device);

    expect(await Effect.runPromiseExit(open(signInUrl, returnUri))).toEqual(
      Exit.fail(new AuthSessionUnavailable({ cause: launchFailure }))
    );
    expect(fake.listeners()).toBe(0);
    expect(fake.releases()).toBe(1);

    // The failed launch doesn't block the next one.
    const retry = Effect.runFork(open(signInUrl, returnUri));
    await settle();
    expect(fake.launches).toHaveLength(2);
    await Effect.runPromise(Fiber.interrupt(retry));
  });
});

describe("auth session sign-in", () => {
  test.each([
    ["iOS", { platform: "ios" }],
    [
      "Android with only a Custom Tabs browser",
      {
        provider: {
          packageName: "org.example.browser",
          launchMode: "custom-tab",
        },
      },
    ],
    ["Android without a browser", { provider: null }],
  ] as const)("%s opens Expo's auth session", async (_, options) => {
    const fake = makeDevice(options);

    expect(
      await Effect.runPromise(
        makeOpenAuthSession(fake.device)(signInUrl, returnUri)
      )
    ).toEqual(AuthSessionResult.Closed());
    expect(fake.authSessions).toEqual([signInUrl]);
    expect(fake.launches).toEqual([]);
  });
});
