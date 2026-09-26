import { describe, expect, mock, test } from "bun:test";
import { createElement, type ReactElement } from "react";

const AccountContentLoading = (props: { readonly locale: string }) =>
  createElement("account-content-loading", props);

mock.module("@/features/account/components/account-loading", () => ({
  AccountContentLoading,
}));
mock.module("@/features/i18n/server/request-locale", () => ({
  runWithRequestLocale: (callback: (locale: "en-US") => unknown) =>
    callback("en-US"),
}));

describe("account route loading boundary", () => {
  test("renders the localized account content fallback without replacing the shell", async () => {
    const { default: AccountRouteLoading } = await import("./loading");
    const output = AccountRouteLoading() as ReactElement<{
      readonly locale: string;
    }>;

    expect(output.type).toBe(AccountContentLoading);
    expect(output.props.locale).toBe("en-US");
  });
});
