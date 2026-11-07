import { afterEach, expect, test } from "bun:test";
import { Option } from "effect";
import {
  clearReauthenticatingUser,
  loadReauthenticatingUser,
  saveReauthenticatingUser,
} from "./web-reauthentication-store";

const now = Date.UTC(2026, 10, 7, 12);

const useStorage = (storage: Partial<Storage>) =>
  Object.assign(globalThis, { localStorage: storage });

afterEach(() => {
  Reflect.deleteProperty(globalThis, "localStorage");
});

test("keeps the account for ten minutes", () => {
  const stored = new Map<string, string>();
  useStorage({
    getItem: (key) => stored.get(key) ?? null,
    setItem: (key, value) => void stored.set(key, value),
    removeItem: (key) => void stored.delete(key),
  });
  saveReauthenticatingUser("ada", now);
  expect(loadReauthenticatingUser(now + 10 * 60 * 1000 - 1)).toEqual(
    Option.some("ada")
  );
  expect(loadReauthenticatingUser(now + 10 * 60 * 1000)).toEqual(Option.none());
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
  expect(() => saveReauthenticatingUser("ada", now)).not.toThrow();
  expect(loadReauthenticatingUser(now)).toEqual(Option.none());
  Reflect.deleteProperty(globalThis, "localStorage");
  expect(loadReauthenticatingUser(now)).toEqual(Option.none());
});
