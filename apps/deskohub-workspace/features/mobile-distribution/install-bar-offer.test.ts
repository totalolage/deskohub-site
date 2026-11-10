import { describe, expect, test } from "bun:test";
import { decideInstallBarOffer } from "./install-bar-offer";
import type { InstallEnvironment } from "./install-environment";

const androidChrome: InstallEnvironment = {
  platform: "android",
  standalone: false,
  androidAppInstalled: false,
  installPromptAvailable: true,
  installPromptSupported: true,
  webAppInstalled: false,
};

const iPhone: InstallEnvironment = {
  platform: "ios",
  standalone: false,
  androidAppInstalled: false,
  installPromptAvailable: false,
  installPromptSupported: false,
  webAppInstalled: false,
};

describe("decideInstallBarOffer", () => {
  test("Android Chromium offers its install prompt once it has one", () => {
    expect(decideInstallBarOffer(androidChrome)).toBe("prompt");
  });

  test("Android Chromium without a prompt shows nothing: the web app is installed or can't be", () => {
    expect(
      decideInstallBarOffer({ ...androidChrome, installPromptAvailable: false })
    ).toBe("none");
  });

  test("Android browsers without install prompts get the guide", () => {
    expect(
      decideInstallBarOffer({
        ...androidChrome,
        installPromptAvailable: false,
        installPromptSupported: false,
      })
    ).toBe("guide");
  });

  test("Android waits for the native app lookup and hides once it finds the app", () => {
    expect(
      decideInstallBarOffer({
        ...androidChrome,
        androidAppInstalled: undefined,
      })
    ).toBe("none");
    expect(
      decideInstallBarOffer({ ...androidChrome, androidAppInstalled: true })
    ).toBe("none");
    expect(
      decideInstallBarOffer({
        ...androidChrome,
        installPromptSupported: false,
        androidAppInstalled: undefined,
      })
    ).toBe("none");
  });

  test("iOS and iPadOS get the guide", () => {
    expect(decideInstallBarOffer(iPhone)).toBe("guide");
  });

  test("desktops get nothing, prompt or not", () => {
    expect(
      decideInstallBarOffer({ ...androidChrome, platform: "desktop" })
    ).toBe("none");
  });

  test("nothing inside the installed web app or once it was installed", () => {
    for (const environment of [androidChrome, iPhone]) {
      expect(decideInstallBarOffer({ ...environment, standalone: true })).toBe(
        "none"
      );
      expect(
        decideInstallBarOffer({ ...environment, webAppInstalled: true })
      ).toBe("none");
    }
  });
});
