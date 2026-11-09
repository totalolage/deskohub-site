import { nativeApp } from "@/features/account/backend/auth/native-app";
import { getWorkspacePageUrl } from "@/features/i18n/page-url";
import { workspaceSiteOrigin } from "@/shared/utils/site-constants";

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
    (app) => app.platform === "play" && app.id === nativeApp.applicationId
  );

/**
 * A Chrome intent link that opens the account page in the installed Android
 * app. The app claims only the site's /app/ links, so the link names the web
 * app's account page, which the app routes to its own. Without the app,
 * Chrome follows the fallback to the download page.
 */
export const androidAppIntentUrl = `intent://${new URL(workspaceSiteOrigin).host}/app/account#Intent;scheme=https;package=${nativeApp.applicationId};S.browser_fallback_url=${encodeURIComponent(getWorkspacePageUrl("/android"))};end`;
