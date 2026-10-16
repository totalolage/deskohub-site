import { expect, mock, test } from "bun:test";
import type { ReactElement } from "react";

const AccountSectionRoute = mock(() => null);

mock.module("@/features/account/components/account-section-route", () => ({
  AccountSectionRoute,
}));
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

const { default: CustomerAccountPageRoute } = await import("./page");

test("renders the default section's account page without a section", async () => {
  const route = (await CustomerAccountPageRoute()) as ReactElement<{
    readonly locale: string;
    readonly section?: Promise<string>;
  }>;

  expect(route.type).toBe(AccountSectionRoute);
  expect(route.props).toEqual({ locale: "en-US" });
});
