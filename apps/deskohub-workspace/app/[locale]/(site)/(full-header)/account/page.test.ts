import { beforeEach, describe, expect, mock, test } from "bun:test";
import { type ReactElement, Suspense } from "react";

const events: string[] = [];
const connection = mock(() => Promise.resolve());
const loadCustomerAccountPage = mock(() =>
  Promise.resolve({ kind: "unavailable" as const })
);
const AccountPage = mock(() => null);
const AccountContentLoading = mock(() => null);

mock.module("next/server", () => ({ connection }));
mock.module("@/features/account/page-data.server", () => ({
  loadCustomerAccountPage,
}));
mock.module("@/features/account/components/account-page", () => ({
  AccountPage,
}));
mock.module("@/features/account/components/account-loading", () => ({
  AccountContentLoading,
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

describe("customer account route boundary", () => {
  beforeEach(() => {
    events.length = 0;
    connection.mockReset();
    connection.mockImplementation(async () => {
      events.push("connection");
    });
    loadCustomerAccountPage.mockClear();
    loadCustomerAccountPage.mockImplementation(async () => {
      events.push("load");
      return { kind: "unavailable" as const };
    });
    AccountPage.mockClear();
  });

  test("loads private account data after connection inside the suspense boundary", async () => {
    const { default: CustomerAccountPageRoute } = await import("./page");

    const route = (await CustomerAccountPageRoute()) as ReactElement<{
      readonly children: ReactElement<{ readonly locale: "en-US" }>;
      readonly fallback: ReactElement<{ readonly locale: "en-US" }>;
    }>;
    expect(route.type).toBe(Suspense);
    expect(route.props.fallback.type).toBe(AccountContentLoading);
    expect(route.props.fallback.props.locale).toBe("en-US");
    expect(events).toEqual([]);
    expect(connection).not.toHaveBeenCalled();
    expect(loadCustomerAccountPage).not.toHaveBeenCalled();

    const content = route.props.children;
    const Content = content.type as (props: {
      readonly locale: "en-US";
    }) => Promise<unknown>;
    const output = await Content(content.props);

    expect(events).toEqual(["connection", "load"]);
    expect(loadCustomerAccountPage).toHaveBeenCalledWith();
    expect(output).toMatchObject({
      type: AccountPage,
      props: { locale: "en-US", state: { kind: "unavailable" } },
    });
  });
});
