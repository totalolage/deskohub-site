/** The device family that decides how the app installs. */
export type InstallPlatform = "android" | "ios" | "desktop";

/**
 * User-Agent Client Hints (`navigator.userAgentData`), which only Chromium
 * browsers expose. Declared here because the DOM library doesn't include it.
 */
type UserAgentClientHints = {
  readonly platform: string;
  readonly mobile: boolean;
  readonly brands?: readonly { readonly brand: string }[];
};

export type InstallPlatformSignals = {
  readonly userAgent: string;
  readonly userAgentData?: UserAgentClientHints;
  readonly maxTouchPoints: number;
};

/**
 * Detects the platform from client hints when the browser sends them, else
 * from the user agent string. iPadOS Safari sends a macOS user agent, so a
 * Macintosh user agent on a touch screen counts as iOS.
 */
export const detectInstallPlatform = ({
  userAgent,
  userAgentData,
  maxTouchPoints,
}: InstallPlatformSignals): InstallPlatform => {
  if (userAgentData?.platform) {
    return userAgentData.platform === "Android" ? "android" : "desktop";
  }
  if (/\bAndroid\b/.test(userAgent)) return "android";
  if (/\b(iPhone|iPad|iPod)\b/.test(userAgent)) return "ios";
  if (/\bMacintosh\b/.test(userAgent) && maxTouchPoints > 1) return "ios";
  return "desktop";
};

/**
 * Whether the browser hands the site an install prompt
 * (`beforeinstallprompt`) when the web app can be installed. Every Chromium
 * browser lists a "Chromium" brand in its client hints (Chrome, Edge, Samsung
 * Internet, Opera, Brave); Firefox and Safari send no client hints. An
 * Android WebView, which in-app browsers use, also reports Chromium but never
 * installs anything: it carries an "Android WebView" brand, and older ones
 * only the `; wv)` user agent marker.
 */
export const offersInstallPrompt = ({
  userAgent,
  userAgentData,
}: InstallPlatformSignals): boolean => {
  const brands = userAgentData?.brands?.map(({ brand }) => brand) ?? [];
  return (
    brands.includes("Chromium") &&
    !brands.includes("Android WebView") &&
    !/; wv\)/.test(userAgent)
  );
};

export type StandaloneDisplaySignals = {
  /** `matchMedia("(display-mode: standalone)").matches`. */
  readonly displayModeStandalone: boolean;
  /** iOS Safari's `navigator.standalone`, true in a home screen web app. */
  readonly navigatorStandalone: boolean | undefined;
};

/** Whether the page runs inside an installed web app. */
export const isStandaloneDisplay = ({
  displayModeStandalone,
  navigatorStandalone,
}: StandaloneDisplaySignals): boolean =>
  displayModeStandalone || navigatorStandalone === true;
