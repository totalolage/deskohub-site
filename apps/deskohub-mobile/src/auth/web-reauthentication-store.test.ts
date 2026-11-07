import { afterEach, expect, test } from "bun:test";
import { Option } from "effect";
import {
  clearReauthenticatingUser,
  loadReauthenticatingUser,
  loadReauthentication,
  reauthenticationMarkerTtlMs,
  saveReauthenticatingUser,
} from "./web-reauthentication-store";

// The server's magic links last ten minutes (betterAuthMagicLinkOptions).
const magicLinkLifetimeMs = 10 * 60 * 1000;

const now = Date.UTC(2026, 10, 7, 12);

const useStorage = (storage: Partial<Storage>) =>
  Object.assign(globalThis, { localStorage: storage });

const useMemoryStorage = () => {
  const stored = new Map<string, string>();
  useStorage({
    getItem: (key) => stored.get(key) ?? null,
    setItem: (key, value) => void stored.set(key, value),
    removeItem: (key) => void stored.delete(key),
  });
  return stored;
};

afterEach(() => {
  Reflect.deleteProperty(globalThis, "localStorage");
});

test("outlives the sign-in link it guards", () => {
  expect(reauthenticationMarkerTtlMs).toBeGreaterThan(magicLinkLifetimeMs);
});

test("keeps the account until it expires", () => {
  useMemoryStorage();
  expect(
    saveReauthenticatingUser({ userId: "ada", returnPath: "/account" }, now)
  ).toBe(true);
  expect(
    loadReauthenticatingUser(now + reauthenticationMarkerTtlMs - 1)
  ).toEqual(Option.some("ada"));
  expect(loadReauthenticatingUser(now + reauthenticationMarkerTtlMs)).toEqual(
    Option.none()
  );
  clearReauthenticatingUser();
  expect(loadReauthenticatingUser(now)).toEqual(Option.none());
});

test("keeps the screen the reauthentication returns to", () => {
  useMemoryStorage();
  saveReauthenticatingUser(
    { userId: "ada", returnPath: "/account/passkeys" },
    now
  );
  expect(loadReauthentication(now)).toEqual(
    Option.some({ userId: "ada", returnPath: Option.some("/account/passkeys") })
  );
  expect(loadReauthentication(now + reauthenticationMarkerTtlMs)).toEqual(
    Option.none()
  );
});

test("reads an unsafe or missing return path as none", () => {
  const stored = useMemoryStorage();
  const expiresAt = now + reauthenticationMarkerTtlMs;
  for (const raw of [
    { userId: "ada", expiresAt, returnPath: "//evil.test" },
    { userId: "ada", expiresAt, returnPath: "/sign-in" },
    { userId: "ada", expiresAt, returnPath: 7 },
    { userId: "ada", expiresAt },
  ]) {
    stored.set("deskohub.reauthentication", JSON.stringify(raw));
    expect(loadReauthentication(now)).toEqual(
      Option.some({ userId: "ada", returnPath: Option.none() })
    );
  }
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
  expect(
    saveReauthenticatingUser({ userId: "ada", returnPath: "/account" }, now)
  ).toBe(false);
  expect(loadReauthenticatingUser(now)).toEqual(Option.none());
  Reflect.deleteProperty(globalThis, "localStorage");
  expect(loadReauthenticatingUser(now)).toEqual(Option.none());
});
