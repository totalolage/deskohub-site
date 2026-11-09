import { afterEach, beforeEach, expect, mock, test } from "bun:test";
import { nativeReturnUri } from "../auth/auth-callback";
import {
  type NativeHandoffRequest,
  nativeHandoffRequestTtlMs,
} from "../auth/native-handoff-request";
import { saveNativeHandoffRequest } from "../auth/web-native-request-store";

// The browser prefers English, as Chrome does on a device whose system
// language differs from the app's.
mock.module("expo-localization", () => ({
  getLocales: () => [{ languageTag: "en-GB" }],
}));

const { readLaunchLocale } = await import("./launch-locale.web");

const request: NativeHandoffRequest = {
  codeChallenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
  state: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
  returnUri: nativeReturnUri,
  reauthenticate: false,
  locale: "cs-CZ",
};

beforeEach(() => {
  const stored = new Map<string, string>();
  Object.assign(globalThis, {
    localStorage: {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => void stored.set(key, value),
      removeItem: (key: string) => void stored.delete(key),
    } satisfies Partial<Storage>,
  });
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, "localStorage");
});

test("a page the app opened shows the app's locale", () => {
  saveNativeHandoffRequest(request, Date.now());
  expect(readLaunchLocale()).toBe("cs-CZ");
});

test("a page without a live app request shows the browser's locale", () => {
  expect(readLaunchLocale()).toBe("en-US");
  saveNativeHandoffRequest(request, Date.now() - nativeHandoffRequestTtlMs);
  expect(readLaunchLocale()).toBe("en-US");
});

test("an app request without a locale leaves the browser's", () => {
  const { locale: _, ...withoutLocale } = request;
  saveNativeHandoffRequest(withoutLocale, Date.now());
  expect(readLaunchLocale()).toBe("en-US");
});
