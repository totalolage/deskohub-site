import { expect, mock, test } from "bun:test";
import type { ReactElement } from "react";

const AccountSections = mock(() => null);

mock.module("@/features/account/components/account-section-route", () => ({
  AccountSections,
}));
mock.module("@/features/i18n/server/request-locale", () => ({
  runWithRequestLocale: (callback: (locale: "cs-CZ") => unknown) =>
    callback("cs-CZ"),
}));

const { default: AccountSectionsLayout } = await import("./layout");

test("renders the account page beside the path's own page", () => {
  const page = "synthetic-page";
  const layout = AccountSectionsLayout({ children: page }) as ReactElement<{
    readonly children: readonly [
      ReactElement<{ readonly locale: string }>,
      string,
    ];
  }>;
  const [sections, children] = layout.props.children;

  expect(sections.type).toBe(AccountSections);
  expect(sections.props.locale).toBe("cs-CZ");
  expect(children).toBe(page);
});
