/** The device family that decides how the app installs. */
export type InstallPlatform = "android" | "ios" | "desktop";

/**
 * User-Agent Client Hints (`navigator.userAgentData`), which only Chromium
 * browsers expose. Declared here because the DOM library doesn't include it.
 */
type UserAgentClientHints = {
  readonly platform: string;
  readonly mobile: boolean;
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
