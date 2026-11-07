import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Option } from "effect";
import { capturedAuthCallback, prepareAuthLocation } from "./auth-location.web";
import { nativeSignInUrl } from "./native-handoff-request";
import { loadNativeHandoffRequest } from "./web-native-request-store";

const origin = "https://workspace.deskohub.cz";
const request = {
  codeChallenge: "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
  state: "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk",
  returnUri: "deskohub://auth/callback",
  reauthenticate: false,
};

/** A browser address bar and storage the capture reads and rewrites. */
const openPage = (href: string) => {
  let current = new URL(href);
  const stored = new Map<string, string>();
  Object.assign(globalThis, {
    location: {
      get href() {
        return current.href;
      },
      get pathname() {
        return current.pathname;
      },
      get search() {
        return current.search;
      },
      get origin() {
        return current.origin;
      },
    },
    history: {
      state: null,
      replaceState: (_state: unknown, _title: string, url: string) => {
        current = new URL(url, current);
      },
    },
    localStorage: {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
      removeItem: (key: string) => stored.delete(key),
    },
  });
  return () => current.href;
};

afterEach(() => {
  for (const name of ["location", "history", "localStorage"]) {
    Reflect.deleteProperty(globalThis, name);
  }
});

describe("app entry", () => {
  test("captures sign-in secrets before Expo Router loads", () => {
    const entry = readFileSync(
      new URL("../../index.ts", import.meta.url),
      "utf8"
    );
    const imports = [...entry.matchAll(/^import\s+"([^"]+)";/gm)].map(
      (match) => match[1]
    );
    expect(imports).toEqual([
      "./src/auth/auth-location-entry",
      "expo-router/entry",
    ]);
    const packageJson = JSON.parse(
      readFileSync(new URL("../../package.json", import.meta.url), "utf8")
    ) as { readonly main: string };
    expect(packageJson.main).toBe("./index.ts");
  });
});

describe("prepareAuthLocation", () => {
  test("keeps the callback in memory and strips it from the address bar", () => {
    const address = openPage(
      `${origin}/app/auth/callback?token=secret-token&utm_source=mail`
    );
    prepareAuthLocation();
    expect(address()).toBe(`${origin}/app/auth/callback?utm_source=mail`);
    expect(capturedAuthCallback()).toEqual({
      kind: "token",
      token: "secret-token",
    });
  });

  test("strips a handoff code and state", () => {
    const address = openPage(
      `${origin}/app/auth/callback?code=secret-code&state=${request.state}`
    );
    prepareAuthLocation();
    expect(address()).toBe(`${origin}/app/auth/callback`);
    expect(capturedAuthCallback()).toEqual({
      kind: "handoff",
      code: "secret-code",
      state: request.state,
    });
  });

  test("moves a native sign-in request into storage", () => {
    const address = openPage(nativeSignInUrl(origin, request));
    prepareAuthLocation();
    expect(address()).toBe(`${origin}/app/sign-in`);
    expect(loadNativeHandoffRequest(Date.now())).toEqual(Option.some(request));
  });

  test("leaves other pages alone", () => {
    const address = openPage(`${origin}/app/account?tab=passkeys`);
    prepareAuthLocation();
    expect(address()).toBe(`${origin}/app/account?tab=passkeys`);
  });
});
