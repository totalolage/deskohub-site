import { beforeEach, describe, expect, mock, test } from "bun:test";
import { type ReactElement, Suspense } from "react";

const events: string[] = [];
const notFound = mock(() => {
  throw new Error("NEXT_NOT_FOUND");
});
const areAccountsEnabled = mock(() => Promise.resolve(true));
const connection = mock(() => Promise.resolve());
const loadCustomerAccountPage = mock(() =>
  Promise.resolve({ kind: "unavailable" as const })
);
const AccountPage = mock(() => null);
const AccountContentLoading = mock(() => null);

mock.module("next/navigation", () => ({ notFound }));
mock.module("next/server", () => ({ connection }));
mock.module("@/features/account/server/account-feature-flag.server", () => ({
  areAccountsEnabled,
}));
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
    notFound.mockReset();
    notFound.mockImplementation(() => {
      throw new Error("NEXT_NOT_FOUND");
    });
    areAccountsEnabled.mockReset();
    areAccountsEnabled.mockImplementation(async () => {
      events.push("gate");
      return true;
    });
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

  test("keeps the account route out of search indexes", async () => {
    const { generateMetadata } = await import("./page");

    expect(await generateMetadata()).toMatchObject({
      robots: { index: false, follow: false },
    });
  });

  test("checks the account gate after connection and before loading private account data", async () => {
    const { default: CustomerAccountPageRoute } = await import("./page");

    const route = (await CustomerAccountPageRoute()) as ReactElement<{
      readonly children: ReactElement<{ readonly locale: "en-US" }>;
      readonly fallback: ReactElement<{ readonly locale: "en-US" }>;
    }>;
    expect(route.type).toBe(Suspense);
    expect(route.props.fallback.type).toBe(AccountContentLoading);
    expect(route.props.fallback.props.locale).toBe("en-US");
    expect(events).toEqual([]);
    expect(areAccountsEnabled).not.toHaveBeenCalled();
    expect(connection).not.toHaveBeenCalled();
    expect(loadCustomerAccountPage).not.toHaveBeenCalled();

    const content = route.props.children;
    const Content = content.type as (props: {
      readonly locale: "en-US";
    }) => Promise<unknown>;
    const output = await Content(content.props);

    expect(events).toEqual(["connection", "gate", "load"]);
    expect(loadCustomerAccountPage).toHaveBeenCalledWith("en-US");
    expect(output).toMatchObject({
      type: AccountPage,
      props: { locale: "en-US", state: { kind: "unavailable" } },
    });
  });

  test("returns not found without touching private account data when disabled", async () => {
    areAccountsEnabled.mockImplementation(async () => {
      events.push("gate");
      return false;
    });
    const { default: CustomerAccountPageRoute } = await import("./page");
    const route = await CustomerAccountPageRoute();
    const content = route.props.children;
    const Content = content.type as (props: {
      readonly locale: "en-US";
    }) => Promise<unknown>;

    await expect(Content(content.props)).rejects.toThrow("NEXT_NOT_FOUND");
    expect(events).toEqual(["connection", "gate"]);
    expect(loadCustomerAccountPage).not.toHaveBeenCalled();
  });
});
