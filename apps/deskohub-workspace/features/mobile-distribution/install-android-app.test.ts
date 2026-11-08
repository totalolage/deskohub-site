import { describe, expect, test } from "bun:test";
import { nativeApp } from "@/features/account/backend/auth/native-app";
import { androidAppIntentUrl, includesAndroidApp } from "./install-android-app";

describe("androidAppIntentUrl", () => {
  test("opens the account page in the app's package over https", () => {
    const [target, fragment] = androidAppIntentUrl.split("#");

    expect(target).toBe("intent://workspace.deskohub.cz/account");
    const parts = fragment?.split(";") ?? [];
    expect(parts[0]).toBe("Intent");
    expect(parts.at(-1)).toBe("end");
    expect(parts).toContain("scheme=https");
    expect(parts).toContain(`package=${nativeApp.applicationId}`);
  });

  test("falls back to the encoded locale-agnostic download page", () => {
    const fallback = androidAppIntentUrl
      .split(";")
      .find((part) => part.startsWith("S.browser_fallback_url="))
      ?.slice("S.browser_fallback_url=".length);

    expect(fallback).toBe(
      encodeURIComponent("https://workspace.deskohub.cz/android")
    );
    expect(fallback).not.toContain(";");
    expect(fallback).not.toContain("/");
  });
});

describe("includesAndroidApp", () => {
  test("matches only the app's Play package", () => {
    expect(
      includesAndroidApp([{ platform: "play", id: nativeApp.applicationId }])
    ).toBe(true);
    expect(
      includesAndroidApp([
        { platform: "webapp", id: nativeApp.applicationId },
        { platform: "play", id: "com.example.other" },
      ])
    ).toBe(false);
    expect(includesAndroidApp([])).toBe(false);
  });
});
