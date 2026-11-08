import type { InstallPlatform } from "./install-platform";

/** What the visitor's browser tells the site about installing the app. */
export type AppInstallContext = {
  /** The page runs inside the installed web app. */
  readonly standalone: boolean;
  readonly platform: InstallPlatform;
  /** The browser reports the native Android app as installed. */
  readonly androidAppInstalled: boolean;
  /** Desktop Chromium handed the site its install prompt. */
  readonly installPromptAvailable: boolean;
  /** The visitor is already on the Android download page. */
  readonly onAndroidDownloadPage: boolean;
};

/** The one install offer the site shows, if any. */
export type AppInstallDecision =
  | "none"
  | "open-android-app"
  | "download-android"
  | "ios-add-to-home-screen"
  | "install-web-app";

/**
 * Chooses the install offer. Inside the installed web app it only offers the
 * native Android app when that is installed. Otherwise Android opens or
 * downloads the native app, iOS and iPadOS get Add to Home Screen
 * instructions (they have no install prompt), and desktop offers the web app
 * only where the browser supplied an install prompt.
 */
export const decideAppInstall = (
  context: AppInstallContext
): AppInstallDecision => {
  if (context.standalone) {
    return context.platform === "android" && context.androidAppInstalled
      ? "open-android-app"
      : "none";
  }

  switch (context.platform) {
    case "android":
      if (context.androidAppInstalled) return "open-android-app";
      return context.onAndroidDownloadPage ? "none" : "download-android";
    case "ios":
      return "ios-add-to-home-screen";
    case "desktop":
      return context.installPromptAvailable ? "install-web-app" : "none";
  }
};
