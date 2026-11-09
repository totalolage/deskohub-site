import { describe, expect, test } from "bun:test";
import { type AppInstallContext, decideAppInstall } from "./install-decision";

const context = (overrides: Partial<AppInstallContext>): AppInstallContext => ({
  standalone: false,
  platform: "desktop",
  androidAppInstalled: false,
  installPromptAvailable: false,
  onAndroidDownloadPage: false,
  ...overrides,
});

describe("decideAppInstall", () => {
  test("inside the installed web app it offers only the detected Android app", () => {
    expect(
      decideAppInstall(
        context({
          standalone: true,
          platform: "android",
          androidAppInstalled: true,
        })
      )
    ).toBe("open-android-app");
    expect(
      decideAppInstall(context({ standalone: true, platform: "android" }))
    ).toBe("none");
    expect(
      decideAppInstall(
        context({
          standalone: true,
          platform: "desktop",
          installPromptAvailable: true,
        })
      )
    ).toBe("none");
    expect(
      decideAppInstall(context({ standalone: true, platform: "ios" }))
    ).toBe("none");
  });

  test("on Android it opens the installed app, else sends to the download page", () => {
    expect(
      decideAppInstall(
        context({ platform: "android", androidAppInstalled: true })
      )
    ).toBe("open-android-app");
    expect(decideAppInstall(context({ platform: "android" }))).toBe(
      "download-android"
    );
    expect(
      decideAppInstall(
        context({
          platform: "android",
          androidAppInstalled: true,
          onAndroidDownloadPage: true,
        })
      )
    ).toBe("open-android-app");
  });

  test("on the Android download page it doesn't link to that same page", () => {
    expect(
      decideAppInstall(
        context({ platform: "android", onAndroidDownloadPage: true })
      )
    ).toBe("none");
  });

  test("on iOS and iPadOS it gives Add to Home Screen instructions", () => {
    expect(decideAppInstall(context({ platform: "ios" }))).toBe(
      "ios-add-to-home-screen"
    );
  });

  test("on desktop it offers the web app install only with a captured prompt", () => {
    expect(
      decideAppInstall(
        context({ platform: "desktop", installPromptAvailable: true })
      )
    ).toBe("install-web-app");
    expect(decideAppInstall(context({ platform: "desktop" }))).toBe("none");
  });
});
