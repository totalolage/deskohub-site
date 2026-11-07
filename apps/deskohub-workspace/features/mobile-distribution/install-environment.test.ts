import { describe, expect, mock, test } from "bun:test";
import { nativeApp } from "@/features/account/backend/auth/native-app";
import {
  createInstallEnvironment,
  type InstallBrowser,
} from "./install-environment";

const androidChrome =
  "Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36";
const windowsChrome =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const linuxFirefox =
  "Mozilla/5.0 (X11; Linux x86_64; rv:144.0) Gecko/20100101 Firefox/144.0";
const iPadSafari =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15";

const fakeBrowser = ({
  navigator,
  displayModeStandalone = false,
}: {
  readonly navigator: InstallBrowser["navigator"];
  readonly displayModeStandalone?: boolean;
}) =>
  Object.assign(new EventTarget(), {
    navigator,
    document: Object.assign(new EventTarget(), {
      visibilityState: "visible" as DocumentVisibilityState,
    }),
    matchMedia: (query: string) => ({
      matches: query === "(display-mode: standalone)" && displayModeStandalone,
    }),
  });

const installPromptEvent = (outcome: "accepted" | "dismissed") => {
  const prompt = mock(() => Promise.resolve());
  const event = Object.assign(
    new Event("beforeinstallprompt", { cancelable: true }),
    {
      prompt,
      userChoice: Promise.resolve({ outcome, platform: "web" }),
    }
  );

  return { event, prompt };
};

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("createInstallEnvironment", () => {
  test("detects a standalone installed web app", () => {
    const environment = createInstallEnvironment(
      fakeBrowser({
        navigator: { userAgent: windowsChrome, maxTouchPoints: 0 },
        displayModeStandalone: true,
      })
    );

    expect(environment.getSnapshot().standalone).toBe(true);
  });

  test("detects the iOS home screen web app", () => {
    const environment = createInstallEnvironment(
      fakeBrowser({
        navigator: {
          userAgent: iPadSafari,
          maxTouchPoints: 5,
          standalone: true,
        },
      })
    );

    expect(environment.getSnapshot()).toMatchObject({
      platform: "ios",
      standalone: true,
    });
  });

  test("finds the installed Android app through related apps", async () => {
    const environment = createInstallEnvironment(
      fakeBrowser({
        navigator: {
          userAgent: androidChrome,
          maxTouchPoints: 5,
          getInstalledRelatedApps: () =>
            Promise.resolve([
              { platform: "play", id: nativeApp.applicationId },
            ]),
        },
      })
    );
    const onChange = mock(() => undefined);
    environment.subscribe(onChange);

    expect(environment.getSnapshot()).toMatchObject({
      platform: "android",
      androidAppInstalled: undefined,
    });
    await settle();
    expect(environment.getSnapshot().androidAppInstalled).toBe(true);
    expect(onChange).toHaveBeenCalled();
  });

  test("reports no Android app when related apps lack it, the API is missing or it fails", async () => {
    const lookups = [
      () => Promise.resolve([{ platform: "play", id: "com.example.other" }]),
      undefined,
      () => Promise.reject(new Error("synthetic related apps failure")),
    ];

    for (const getInstalledRelatedApps of lookups) {
      const environment = createInstallEnvironment(
        fakeBrowser({
          navigator: {
            userAgent: androidChrome,
            maxTouchPoints: 5,
            ...(getInstalledRelatedApps && { getInstalledRelatedApps }),
          },
        })
      );
      await settle();

      expect(environment.getSnapshot()).toMatchObject({
        platform: "android",
        androidAppInstalled: false,
      });
    }
  });

  test("looks the Android app up again when the visitor returns to the tab", async () => {
    let relatedApps: { platform: string; id: string }[] = [];
    const browser = fakeBrowser({
      navigator: {
        userAgent: androidChrome,
        maxTouchPoints: 5,
        getInstalledRelatedApps: () => Promise.resolve(relatedApps),
      },
    });
    const environment = createInstallEnvironment(browser);
    await settle();
    expect(environment.getSnapshot().androidAppInstalled).toBe(false);

    relatedApps = [{ platform: "play", id: nativeApp.applicationId }];
    browser.document.visibilityState = "hidden";
    browser.document.dispatchEvent(new Event("visibilitychange"));
    await settle();
    expect(environment.getSnapshot().androidAppInstalled).toBe(false);

    browser.document.visibilityState = "visible";
    browser.document.dispatchEvent(new Event("visibilitychange"));
    expect(environment.getSnapshot().androidAppInstalled).toBe(false);
    await settle();
    expect(environment.getSnapshot().androidAppInstalled).toBe(true);
  });

  test("doesn't look up the Android app on other platforms", () => {
    const getInstalledRelatedApps = mock(() => Promise.resolve([]));
    const environment = createInstallEnvironment(
      fakeBrowser({
        navigator: {
          userAgent: windowsChrome,
          maxTouchPoints: 0,
          getInstalledRelatedApps,
        },
      })
    );

    expect(environment.getSnapshot().androidAppInstalled).toBe(false);
    expect(getInstalledRelatedApps).not.toHaveBeenCalled();
  });

  test("captures desktop Chromium's install prompt and shows it on request", async () => {
    const browser = fakeBrowser({
      navigator: {
        userAgent: windowsChrome,
        userAgentData: { platform: "Windows", mobile: false },
        maxTouchPoints: 0,
      },
    });
    const environment = createInstallEnvironment(browser);
    const onChange = mock(() => undefined);
    environment.subscribe(onChange);
    const { event, prompt } = installPromptEvent("accepted");

    expect(environment.getSnapshot()).toMatchObject({
      platform: "desktop",
      installPromptAvailable: false,
    });
    browser.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(environment.getSnapshot().installPromptAvailable).toBe(true);
    expect(onChange).toHaveBeenCalledTimes(1);

    await environment.promptInstall();
    expect(prompt).toHaveBeenCalledTimes(1);
    expect(environment.getSnapshot().installPromptAvailable).toBe(false);
  });

  test("drops a dismissed prompt, which can't be shown twice", async () => {
    const browser = fakeBrowser({
      navigator: { userAgent: windowsChrome, maxTouchPoints: 0 },
    });
    const environment = createInstallEnvironment(browser);
    const { event } = installPromptEvent("dismissed");
    browser.dispatchEvent(event);

    await environment.promptInstall();
    expect(environment.getSnapshot().installPromptAvailable).toBe(false);
  });

  test("drops the prompt once the web app is installed", () => {
    const browser = fakeBrowser({
      navigator: { userAgent: windowsChrome, maxTouchPoints: 0 },
    });
    const environment = createInstallEnvironment(browser);
    browser.dispatchEvent(installPromptEvent("accepted").event);
    browser.dispatchEvent(new Event("appinstalled"));

    expect(environment.getSnapshot().installPromptAvailable).toBe(false);
  });

  test("has no install prompt in Firefox", () => {
    const environment = createInstallEnvironment(
      fakeBrowser({
        navigator: { userAgent: linuxFirefox, maxTouchPoints: 0 },
      })
    );

    expect(environment.getSnapshot()).toMatchObject({
      platform: "desktop",
      standalone: false,
      installPromptAvailable: false,
    });
  });

  test("keeps the snapshot identity until something changes", () => {
    const environment = createInstallEnvironment(
      fakeBrowser({
        navigator: { userAgent: windowsChrome, maxTouchPoints: 0 },
      })
    );

    expect(environment.getSnapshot()).toBe(environment.getSnapshot());
  });
});
