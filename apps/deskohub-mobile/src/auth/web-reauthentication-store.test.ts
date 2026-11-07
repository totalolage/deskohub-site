import { afterEach, expect, test } from "bun:test";
import { Option } from "effect";
import {
  clearReauthenticatingUser,
  loadReauthenticatingUser,
  reauthenticationMarkerTtlMs,
  saveReauthenticatingUser,
} from "./web-reauthentication-store";

// The server's magic links last ten minutes (betterAuthMagicLinkOptions).
const magicLinkLifetimeMs = 10 * 60 * 1000;

const now = Date.UTC(2026, 10, 7, 12);

const useStorage = (storage: Partial<Storage>) =>
  Object.assign(globalThis, { localStorage: storage });

afterEach(() => {
  Reflect.deleteProperty(globalThis, "localStorage");
});

test("outlives the sign-in link it guards", () => {
  expect(reauthenticationMarkerTtlMs).toBeGreaterThan(magicLinkLifetimeMs);
});

test("keeps the account until it expires", () => {
  const stored = new Map<string, string>();
  useStorage({
    getItem: (key) => stored.get(key) ?? null,
    setItem: (key, value) => void stored.set(key, value),
    removeItem: (key) => void stored.delete(key),
  });
  expect(saveReauthenticatingUser("ada", now)).toBe(true);
  expect(
    loadReauthenticatingUser(now + reauthenticationMarkerTtlMs - 1)
  ).toEqual(Option.some("ada"));
  expect(loadReauthenticatingUser(now + reauthenticationMarkerTtlMs)).toEqual(
    Option.none()
  );
  clearReauthenticatingUser();
  expect(loadReauthenticatingUser(now)).toEqual(Option.none());
});

test("reads refused or missing storage as no account", () => {
  useStorage({
    getItem: () => {
      throw new DOMException("denied", "SecurityError");
    },
    setItem: () => {
      throw new DOMException("denied", "SecurityError");
    },
  });
  expect(saveReauthenticatingUser("ada", now)).toBe(false);
  expect(loadReauthenticatingUser(now)).toEqual(Option.none());
  Reflect.deleteProperty(globalThis, "localStorage");
  expect(loadReauthenticatingUser(now)).toEqual(Option.none());
});
