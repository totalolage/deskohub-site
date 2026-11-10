import { describe, expect, test } from "bun:test";
import {
  detectInstallGuide,
  type InstallGuide,
  installGuideArrow,
} from "./install-guide";
import { detectInstallPlatform } from "./install-platform";

// Real user agents; sources in the #1200 research notes (WebKit, Chromium,
// MDN, Microsoft, and sampled in-app browser strings).
const userAgents = {
  safariIos18:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1",
  // iOS 26 keeps the frozen 18_6 OS token; only Version/ moves.
  safariIos26:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1",
  safariIos26Point1:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Mobile/15E148 Safari/604.1",
  // iPadOS Safari asks for desktop sites by default and sends a Mac agent.
  ipadSafariDesktop:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15",
  // Narrow multitasking windows on iPad send the iPad agent.
  ipadSafariMobile:
    "Mozilla/5.0 (iPad; CPU OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1",
  chromeIphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 27_2_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/157.0.8103.37 Mobile/15E148 Safari/604.1",
  chromeIpad:
    "Mozilla/5.0 (iPad; CPU OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/141.0.7390.96 Mobile/15E148 Safari/604.1",
  firefoxIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 15_8_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/160.0 Mobile/15E148 Safari/605.1.15",
  // Edge on iOS also carries Safari's Version/ token.
  edgeIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_7_11 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 EdgiOS/156.4314.56 Mobile/15E148 Safari/605.1.15",
  duckDuckGoIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Ddg/18.6 Safari/604.1",
  instagramIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/23F84 Instagram 444.0.0.31.65 (iPhone16,2; iOS 26_1; en_US; en; scale=3.00; 1290x2796; IABMV/1; 803153880) Safari/604.1",
  facebookIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/530.0.0.41.105;FBBV/785224337;FBDV/iPhone16,2;FBMD/iPhone;FBSN/iOS;FBSV/26.1;FBSS/3;FBCR/;FBID/phone;FBLC/en_US;FBOP/5;FBRV/0]",
  googleAppIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) GSA/392.0.795637524 Mobile/15E148 Safari/604.1",
  // An app's own WKWebView: no Safari token at all.
  plainWebViewIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
  androidChrome:
    "Mozilla/5.0 (Linux; Android 15; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36",
  androidWebView:
    "Mozilla/5.0 (Linux; Android 15; Pixel 8 Build/AP4A.250205.002; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0.7390.122 Mobile Safari/537.36",
  androidInstagram:
    "Mozilla/5.0 (Linux; Android 15; Pixel 8 Build/AP4A.250205.002; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/141.0.7390.122 Mobile Safari/537.36 Instagram 404.0.0.48.76 Android (35/15; 420dpi; 1080x2400; Google/google; Pixel 8; shiba; shiba; en_US; 812345678)",
  androidFirefox:
    "Mozilla/5.0 (Android 15; Mobile; rv:144.0) Gecko/144.0 Firefox/144.0",
  macSafari:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15",
  unknown: "Mozilla/5.0 (compatible; ExampleBrowser/1.0)",
};

const phoneTouchPoints = 5;

/** Detects the guide the way the install bar does: platform first. */
const guideFor = (
  userAgent: string,
  maxTouchPoints = phoneTouchPoints
): InstallGuide =>
  detectInstallGuide({
    platform: detectInstallPlatform({ userAgent, maxTouchPoints }),
    userAgent,
    maxTouchPoints,
  });

describe("detectInstallGuide", () => {
  test("tells Safari 26 from Safari 18 by Safari's version, not the frozen iOS version", () => {
    expect(guideFor(userAgents.safariIos18)).toEqual({
      kind: "safari",
      device: "iphone",
      generation: "classic",
    });
    expect(guideFor(userAgents.safariIos26)).toEqual({
      kind: "safari",
      device: "iphone",
      generation: "liquid-glass",
    });
    expect(guideFor(userAgents.safariIos26Point1)).toEqual({
      kind: "safari",
      device: "iphone",
      generation: "liquid-glass",
    });
  });

  test("recognises iPad Safari behind its Mac user agent by the touch screen", () => {
    expect(guideFor(userAgents.ipadSafariDesktop)).toEqual({
      kind: "safari",
      device: "ipad",
      generation: "liquid-glass",
    });
    expect(guideFor(userAgents.ipadSafariMobile)).toEqual({
      kind: "safari",
      device: "ipad",
      generation: "classic",
    });
  });

  test("leaves a Mac without a touch screen to the desktop flow", () => {
    expect(guideFor(userAgents.macSafari, 0)).toEqual({
      kind: "unidentified",
    });
  });

  test("recognises Chrome on iPhone and iPad", () => {
    expect(guideFor(userAgents.chromeIphone)).toEqual({
      kind: "chrome-ios",
      device: "iphone",
    });
    expect(guideFor(userAgents.chromeIpad)).toEqual({
      kind: "chrome-ios",
      device: "ipad",
    });
  });

  test("gives other iOS browsers the generic guide, even when they carry Safari's tokens", () => {
    for (const userAgent of [
      userAgents.firefoxIos,
      userAgents.edgeIos,
      userAgents.duckDuckGoIos,
    ]) {
      expect(guideFor(userAgent)).toEqual({ kind: "other-ios-browser" });
    }
  });

  test("recognises in-app browsers on iOS", () => {
    for (const userAgent of [
      userAgents.instagramIos,
      userAgents.facebookIos,
      userAgents.googleAppIos,
      userAgents.plainWebViewIos,
    ]) {
      expect(guideFor(userAgent)).toEqual({
        kind: "in-app-browser",
        platform: "ios",
      });
    }
  });

  test("recognises in-app browsers and WebViews on Android", () => {
    for (const userAgent of [
      userAgents.androidWebView,
      userAgents.androidInstagram,
    ]) {
      expect(guideFor(userAgent)).toEqual({
        kind: "in-app-browser",
        platform: "android",
      });
    }
  });

  test("gives Android browsers the Android menu guide, never the iOS Share steps", () => {
    expect(guideFor(userAgents.androidFirefox)).toEqual({
      kind: "android-browser",
    });
    expect(guideFor(userAgents.androidChrome)).toEqual({
      kind: "android-browser",
    });
  });

  test("falls back to the generic guide for an unknown browser", () => {
    expect(guideFor(userAgents.unknown, 0)).toEqual({ kind: "unidentified" });
    expect(
      detectInstallGuide({
        platform: "ios",
        userAgent: userAgents.unknown,
        maxTouchPoints: phoneTouchPoints,
      })
    ).toEqual({ kind: "unidentified" });
  });
});

describe("installGuideArrow", () => {
  const cases: ReadonlyArray<
    readonly [
      InstallGuide,
      ReturnType<typeof installGuideArrow>,
      ReturnType<typeof installGuideArrow>,
    ]
  > = [
    [
      { kind: "safari", device: "iphone", generation: "liquid-glass" },
      "bottom-right",
      undefined,
    ],
    [
      { kind: "safari", device: "iphone", generation: "classic" },
      "bottom-center",
      undefined,
    ],
    [
      { kind: "safari", device: "ipad", generation: "liquid-glass" },
      "top-right",
      "top-right",
    ],
    [
      { kind: "safari", device: "ipad", generation: "classic" },
      "top-right",
      "top-right",
    ],
    [{ kind: "chrome-ios", device: "iphone" }, "top-right", "top-right"],
    [{ kind: "chrome-ios", device: "ipad" }, undefined, undefined],
    [{ kind: "other-ios-browser" }, undefined, undefined],
    [{ kind: "in-app-browser", platform: "ios" }, undefined, undefined],
    [{ kind: "in-app-browser", platform: "android" }, undefined, undefined],
    [{ kind: "android-browser" }, undefined, undefined],
    [{ kind: "unidentified" }, undefined, undefined],
  ];

  test.each(cases)(
    "points at the known control in each orientation: %o",
    (guide, portrait, landscape) => {
      expect(installGuideArrow(guide, "portrait")).toBe(portrait);
      expect(installGuideArrow(guide, "landscape")).toBe(landscape);
    }
  );
});
