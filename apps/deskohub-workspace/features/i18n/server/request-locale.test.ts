import { beforeEach, expect, mock, test } from "bun:test";

let requestedLocale: string | undefined;
const notFoundError = new Error("not found");

mock.module("next/root-params", () => ({
  locale: () => Promise.resolve(requestedLocale),
}));

mock.module("next/navigation", () => ({
  notFound: () => {
    throw notFoundError;
  },
  unstable_rethrow: (error: unknown) => {
    throw error;
  },
}));

beforeEach(() => {
  requestedLocale = "en-US";
});

test("resolves a supported locale from the root route parameter", async () => {
  const { getRequestLocale } = await import("./request-locale");

  await expect(getRequestLocale()).resolves.toBe("en-US");
});

test("rejects a missing or unsupported root route parameter", async () => {
  const { getRequestLocale } = await import("./request-locale");

  for (const value of [undefined, "sk-SK"]) {
    requestedLocale = value;
    await expect(getRequestLocale()).rejects.toBe(notFoundError);
  }
});

test("provides the validated locale to the request scope", async () => {
  const { getLocale } = await import("../paraglide/runtime.js");
  const { runWithRequestLocale } = await import("./request-locale");
  requestedLocale = "cs-CZ";

  await expect(
    runWithRequestLocale(async (locale) => {
      await Promise.resolve();

      return { locale, storedLocale: getLocale() };
    })
  ).resolves.toEqual({ locale: "cs-CZ", storedLocale: "cs-CZ" });
});
