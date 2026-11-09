import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import {
  readSessionStorageItem,
  writeSessionStorageItem,
} from "./session-storage";

const storageKey = "workspace-test-session-storage-item";
let originalSessionStorage: PropertyDescriptor | undefined;

describe("session storage helpers", () => {
  beforeAll(() => {
    GlobalRegistrator.register();
  });

  beforeEach(() => {
    originalSessionStorage = Object.getOwnPropertyDescriptor(
      globalThis,
      "sessionStorage"
    );
  });

  afterEach(() => {
    if (originalSessionStorage) {
      Object.defineProperty(
        globalThis,
        "sessionStorage",
        originalSessionStorage
      );
    } else {
      Reflect.deleteProperty(globalThis, "sessionStorage");
    }
    originalSessionStorage = undefined;
    globalThis.sessionStorage.clear();
  });

  afterAll(() => {
    GlobalRegistrator.unregister();
  });

  test("writes and reads an item", () => {
    writeSessionStorageItem(storageKey, "stored value");

    expect(readSessionStorageItem(storageKey)).toBe("stored value");
  });

  test("removes an item when written with null", () => {
    writeSessionStorageItem(storageKey, "stored value");

    writeSessionStorageItem(storageKey, null);

    expect(readSessionStorageItem(storageKey)).toBeNull();
  });

  test("returns null for an absent key", () => {
    expect(readSessionStorageItem(storageKey)).toBeNull();
  });

  test("returns null and drops writes when sessionStorage methods throw", () => {
    const throwingSessionStorage = {
      getItem: () => {
        throw new Error("sessionStorage unavailable");
      },
      setItem: () => {
        throw new Error("sessionStorage unavailable");
      },
      removeItem: () => {
        throw new Error("sessionStorage unavailable");
      },
    };

    Object.defineProperty(globalThis, "sessionStorage", {
      configurable: true,
      get: () => throwingSessionStorage,
    });

    expect(readSessionStorageItem(storageKey)).toBeNull();
    expect(() =>
      writeSessionStorageItem(storageKey, "stored value")
    ).not.toThrow();
    expect(() => writeSessionStorageItem(storageKey, null)).not.toThrow();
  });
});
