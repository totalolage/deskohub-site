import { describe, expect, test } from "bun:test";
import { detectInstallPlatform, isStandaloneDisplay } from "./install-platform";

const userAgents = {
  androidChrome:
    "Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36",
  androidFirefox:
    "Mozilla/5.0 (Android 15; Mobile; rv:144.0) Gecko/144.0 Firefox/144.0",
  iPhoneSafari:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1",
  iPhoneChrome:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.0.0 Mobile/15E148 Safari/604.1",
  macSafari:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15",
  windowsChrome:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  linuxFirefox:
    "Mozilla/5.0 (X11; Linux x86_64; rv:144.0) Gecko/20100101 Firefox/144.0",
};

describe("detectInstallPlatform", () => {
  test("reads Android from client hints when the browser sends them", () => {
    expect(
      detectInstallPlatform({
        userAgent: userAgents.windowsChrome,
        userAgentData: { platform: "Android", mobile: true },
        maxTouchPoints: 5,
      })
    ).toBe("android");
    expect(
      detectInstallPlatform({
        userAgent: userAgents.androidChrome,
        userAgentData: { platform: "Windows", mobile: false },
        maxTouchPoints: 0,
      })
    ).toBe("desktop");
  });

  test("falls back to the user agent string without client hints", () => {
    expect(
      detectInstallPlatform({
        userAgent: userAgents.androidFirefox,
        maxTouchPoints: 5,
      })
    ).toBe("android");
    expect(
      detectInstallPlatform({
        userAgent: userAgents.androidChrome,
        userAgentData: { platform: "", mobile: true },
        maxTouchPoints: 5,
      })
    ).toBe("android");
  });

  test("detects iPhone browsers as iOS", () => {
    for (const userAgent of [
      userAgents.iPhoneSafari,
      userAgents.iPhoneChrome,
    ]) {
      expect(detectInstallPlatform({ userAgent, maxTouchPoints: 5 })).toBe(
        "ios"
      );
    }
  });

  test("treats a Macintosh user agent with touch as iPadOS", () => {
    expect(
      detectInstallPlatform({
        userAgent: userAgents.macSafari,
        maxTouchPoints: 5,
      })
    ).toBe("ios");
    expect(
      detectInstallPlatform({
        userAgent: userAgents.macSafari,
        maxTouchPoints: 0,
      })
    ).toBe("desktop");
  });

  test("detects desktop Chromium and Firefox as desktop", () => {
    expect(
      detectInstallPlatform({
        userAgent: userAgents.windowsChrome,
        userAgentData: { platform: "Windows", mobile: false },
        maxTouchPoints: 0,
      })
    ).toBe("desktop");
    expect(
      detectInstallPlatform({
        userAgent: userAgents.linuxFirefox,
        maxTouchPoints: 0,
      })
    ).toBe("desktop");
  });
});

describe("isStandaloneDisplay", () => {
  test("is true in a standalone display mode or iOS home screen web app", () => {
    expect(
      isStandaloneDisplay({
        displayModeStandalone: true,
        navigatorStandalone: undefined,
      })
    ).toBe(true);
    expect(
      isStandaloneDisplay({
        displayModeStandalone: false,
        navigatorStandalone: true,
      })
    ).toBe(true);
  });

  test("is false in a browser tab", () => {
    expect(
      isStandaloneDisplay({
        displayModeStandalone: false,
        navigatorStandalone: undefined,
      })
    ).toBe(false);
    expect(
      isStandaloneDisplay({
        displayModeStandalone: false,
        navigatorStandalone: false,
      })
    ).toBe(false);
  });
});
