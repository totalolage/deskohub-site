import { getWorkspacePageUrl } from "@/features/i18n/page-url";
import { workspaceSiteOrigin } from "@/shared/utils/site-constants";
import { ANDROID_PACKAGE_ID } from "./android-app";

/**
 * An entry `navigator.getInstalledRelatedApps()` resolves with. Declared here
 * because the DOM library doesn't include the API.
 */
export type InstalledRelatedApp = {
  readonly platform: string;
  readonly id?: string;
};

/** Whether the related apps the browser reports include the Android app. */
export const includesAndroidApp = (
  relatedApps: readonly InstalledRelatedApp[]
): boolean =>
  relatedApps.some(
    (app) => app.platform === "play" && app.id === ANDROID_PACKAGE_ID
  );

/**
 * A Chrome intent link that opens the account page in the installed Android
 * app. Without the app, Chrome follows the fallback to the download page.
 */
export const androidAppIntentUrl = `intent://${new URL(workspaceSiteOrigin).host}/account#Intent;scheme=https;package=${ANDROID_PACKAGE_ID};S.browser_fallback_url=${encodeURIComponent(getWorkspacePageUrl("/android"))};end`;
