import type { InstallEnvironment } from "./install-environment";

/**
 * What the install bar's Install button does, or `"none"` where the bar
 * doesn't show: `"prompt"` shows the browser's own install prompt, `"guide"`
 * opens the add-to-Home-Screen guide.
 */
export type InstallBarOffer = "none" | "prompt" | "guide";

/**
 * Chooses the install bar's offer. The bar is for phones and tablets only
 * (the footer covers desktops), never inside the installed web app or once
 * the web app or the native Android app is installed, and nothing while the
 * native app lookup is still pending, so it can't flash.
 *
 * A browser that hands out install prompts withholds one while the web app
 * is installed, so there the bar waits for the prompt and stays hidden
 * without it. Browsers without install prompts (iOS, Firefox, in-app
 * WebViews) get the guide.
 */
export const decideInstallBarOffer = (
  environment: InstallEnvironment
): InstallBarOffer => {
  if (environment.standalone || environment.webAppInstalled) return "none";

  switch (environment.platform) {
    case "desktop":
      return "none";
    case "ios":
      return "guide";
    case "android":
      if (environment.androidAppInstalled !== false) return "none";
      if (!environment.installPromptSupported) return "guide";
      return environment.installPromptAvailable ? "prompt" : "none";
  }
};
