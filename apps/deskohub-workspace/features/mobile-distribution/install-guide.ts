import type { InstallPlatform } from "./install-platform";

/**
 * Which add-to-Home-Screen guide fits the visitor's browser. Guides with a
 * known toolbar point arrows at the real control; the rest show the steps
 * without arrows.
 *
 * - `safari`: Safari on iPhone or iPad. `liquid-glass` is Safari 26 and
 *   later, which hides Share behind ··· in its default Compact layout and
 *   adds the Open as Web App switch; `classic` is Safari 18 and earlier.
 * - `chrome-ios`: Chrome on iPhone or iPad, Share beside the address bar.
 * - `other-ios-browser`: any other iOS browser. Their menus differ, so the
 *   guide gives the Share steps without arrows and suggests Safari.
 * - `in-app-browser`: a browser built into another app (Instagram,
 *   Facebook, TikTok, an Android WebView, …), which usually can't add to
 *   the Home Screen at all.
 * - `android-browser`: an Android browser that offers no install prompt.
 * - `unidentified`: anything else.
 */
export type InstallGuide =
  | {
      readonly kind: "safari";
      readonly device: AppleDevice;
      readonly generation: SafariGeneration;
    }
  | { readonly kind: "chrome-ios"; readonly device: AppleDevice }
  | { readonly kind: "other-ios-browser" }
  | {
      readonly kind: "in-app-browser";
      readonly platform: Exclude<InstallPlatform, "desktop">;
    }
  | { readonly kind: "android-browser" }
  | { readonly kind: "unidentified" };

export type AppleDevice = "iphone" | "ipad";

export type SafariGeneration = "liquid-glass" | "classic";

export type InstallGuideSignals = {
  readonly platform: InstallPlatform;
  readonly userAgent: string;
  readonly maxTouchPoints: number;
};

/**
 * Tokens that browsers built into other apps add to the user agent. They
 * are hints: app user agents change, and some in-app browsers send plain
 * Safari's.
 */
const inAppBrowserPattern =
  /\b(?:FBAN|FBAV|FB_IAB|FBIOS|Instagram|musical_ly|trill_|BytedanceWebview|Line\/|GSA\/|LinkedInApp|Twitter|Snapchat|Pinterest|MicroMessenger)|; wv\)/;

/** iOS browsers other than Safari and Chrome that name themselves. */
const otherIosBrowserPattern =
  /\b(?:FxiOS|EdgiOS|OPiOS|OPT|DuckDuckGo|Ddg|YaBrowser|Brave|Focus|Vivaldi)\//;

const safariVersionPattern = /\bVersion\/(\d+)(?:\.\d+)*.*\bSafari\//;

const appleDevice = (userAgent: string): AppleDevice =>
  /\b(?:iPhone|iPod)\b/.test(userAgent) ? "iphone" : "ipad";

/**
 * Picks the guide for a browser that has no install prompt of its own.
 *
 * Safari's generation comes from its `Version/` token, because iOS 26 froze
 * the OS version in the user agent near 18. iPadOS Safari sends a Mac user
 * agent; `platform` already counts it as iOS, so a non-iPhone Apple device
 * is an iPad.
 */
export const detectInstallGuide = ({
  platform,
  userAgent,
}: InstallGuideSignals): InstallGuide => {
  if (platform === "desktop") return { kind: "unidentified" };
  if (inAppBrowserPattern.test(userAgent)) {
    return { kind: "in-app-browser", platform };
  }
  if (platform === "android") return { kind: "android-browser" };

  if (/\bCriOS\//.test(userAgent)) {
    return { kind: "chrome-ios", device: appleDevice(userAgent) };
  }
  if (otherIosBrowserPattern.test(userAgent)) {
    return { kind: "other-ios-browser" };
  }
  const safariVersion = safariVersionPattern.exec(userAgent)?.[1];
  if (safariVersion) {
    return {
      kind: "safari",
      device: appleDevice(userAgent),
      generation: Number(safariVersion) >= 26 ? "liquid-glass" : "classic",
    };
  }
  // A plain WebKit view with no Safari token is an app's embedded browser.
  if (/\bAppleWebKit\//.test(userAgent) && !/\bSafari\//.test(userAgent)) {
    return { kind: "in-app-browser", platform };
  }
  return { kind: "unidentified" };
};

export type ScreenOrientation = "portrait" | "landscape";

/**
 * Where the control for a guide's first step sits, at the edge of the
 * viewport next to the browser's toolbar.
 */
export type InstallGuideArrow = "bottom-right" | "bottom-center" | "top-right";

/**
 * The edge an arrow points to, or `undefined` where the toolbar layout isn't
 * known for that browser and orientation.
 *
 * - Safari 26 iPhone, portrait: ··· at the bottom right of the default
 *   Compact layout.
 * - Safari 18 iPhone, portrait: Share in the middle of the bottom toolbar.
 * - Safari iPad: Share at the top right of the window.
 * - Chrome iPhone: Share beside the address bar, which sits at the top by
 *   default and always in landscape.
 *
 * Safari on iPhone in landscape and Chrome on iPad move their controls in
 * ways we haven't confirmed, so they get no arrow.
 */
export const installGuideArrow = (
  guide: InstallGuide,
  orientation: ScreenOrientation
): InstallGuideArrow | undefined => {
  switch (guide.kind) {
    case "safari":
      if (guide.device === "ipad") return "top-right";
      if (orientation === "landscape") return undefined;
      return guide.generation === "liquid-glass"
        ? "bottom-right"
        : "bottom-center";
    case "chrome-ios":
      return guide.device === "iphone" ? "top-right" : undefined;
    default:
      return undefined;
  }
};
