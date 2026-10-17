import { expect, mock, test } from "bun:test";

mock.module("@/features/i18n", () => ({
  m: {
    accountMetadataTitle: () => "synthetic-title",
    accountMetadataDescription: () => "synthetic-description",
  },
}));
mock.module("@/features/i18n/server/request-locale", () => ({
  runWithRequestLocale: (callback: (locale: "en-US") => unknown) =>
    callback("en-US"),
}));

const { default: CustomerAccountPageRoute, generateMetadata } = await import(
  "./page"
);

test("titles the bare account page after the account", async () => {
  expect(await generateMetadata()).toEqual({
    title: "synthetic-title",
    description: "synthetic-description",
    robots: { index: false, follow: false },
  });
});

test("leaves the account page to the sections' layout", () => {
  expect(CustomerAccountPageRoute()).toBeNull();
});
