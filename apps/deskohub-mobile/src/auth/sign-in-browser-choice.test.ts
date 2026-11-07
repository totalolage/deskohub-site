import { describe, expect, test } from "bun:test";
import type { TrustedWebActivityProvider } from "../../modules/trusted-web-activity";
import { chooseSignInBrowser, SignInBrowser } from "./sign-in-browser-choice";

const chrome: TrustedWebActivityProvider = {
  packageName: "com.android.chrome",
  launchMode: "trusted-web-activity",
};

describe("chooseSignInBrowser", () => {
  test("iOS keeps the auth session without looking for a browser", () => {
    let lookups = 0;
    const choice = chooseSignInBrowser({
      platform: "ios",
      findProvider: () => {
        lookups += 1;
        return chrome;
      },
    });
    expect(choice).toEqual(SignInBrowser.AuthSession());
    expect(lookups).toBe(0);
  });

  test("Android opens a Trusted Web Activity in a browser that supports one", () => {
    expect(
      chooseSignInBrowser({ platform: "android", findProvider: () => chrome })
    ).toEqual(SignInBrowser.TrustedWebActivity({ provider: chrome }));
  });

  test.each([
    ["only a Custom Tabs browser", "custom-tab"],
    ["only a plain browser", "browser"],
  ] as const)("Android with %s keeps the auth session", (_, launchMode) => {
    expect(
      chooseSignInBrowser({
        platform: "android",
        findProvider: () => ({
          packageName: "org.example.browser",
          launchMode,
        }),
      })
    ).toEqual(SignInBrowser.AuthSession());
  });

  test("Android without a browser keeps the auth session", () => {
    expect(
      chooseSignInBrowser({ platform: "android", findProvider: () => null })
    ).toEqual(SignInBrowser.AuthSession());
  });

  test("Android keeps the auth session when the browser lookup fails", () => {
    expect(
      chooseSignInBrowser({
        platform: "android",
        findProvider: () => {
          throw new Error("Cannot find native module 'TrustedWebActivity'");
        },
      })
    ).toEqual(SignInBrowser.AuthSession());
  });
});
