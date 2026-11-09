import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { nativeApp } from "@/features/account/backend/auth/native-app";
import { androidAppIntentUrl, includesAndroidApp } from "./install-android-app";

type AppLinkFilter = {
  data: { scheme: string; host: string; pathPrefix?: string }[];
};

/** The https links the Android app's manifest claims, from its app.json. */
const appLinkFilters = async (): Promise<AppLinkFilter[]> => {
  const { expo }: { expo: { android: { intentFilters: AppLinkFilter[] } } } =
    await Bun.file(
      join(import.meta.dir, "../../../deskohub-mobile/app.json")
    ).json();
  return expo.android.intentFilters;
};

describe("androidAppIntentUrl", () => {
  test("opens the account page in the app's package over https", () => {
    const [target, fragment] = androidAppIntentUrl.split("#");

    expect(target).toBe("intent://workspace.deskohub.cz/app/account");
    const parts = fragment?.split(";") ?? [];
    expect(parts[0]).toBe("Intent");
    expect(parts.at(-1)).toBe("end");
    expect(parts).toContain("scheme=https");
    expect(parts).toContain(`package=${nativeApp.applicationId}`);
  });

  test("targets a link the app's intent filters claim", async () => {
    const target = new URL(
      androidAppIntentUrl.split("#")[0]?.replace(/^intent:/, "https:") ?? ""
    );
    const claimed = (await appLinkFilters()).some(({ data }) =>
      data.some(
        (entry) =>
          entry.scheme === "https" &&
          entry.host === target.host &&
          target.pathname.startsWith(entry.pathPrefix ?? "/")
      )
    );

    expect({ target: target.href, claimed }).toEqual({
      target: target.href,
      claimed: true,
    });
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
