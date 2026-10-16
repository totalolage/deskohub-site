import { beforeEach, describe, expect, mock, test } from "bun:test";
import { type ReactElement, Suspense } from "react";

const events: string[] = [];
const notFound = mock(() => {
  throw new Error("NEXT_NOT_FOUND");
});
const arePasskeysEnabled = mock(() => Promise.resolve(true));
const areReferralsEnabled = mock(() => Promise.resolve(true));
const connection = mock(() => Promise.resolve());
const loadCustomerAccountPage = mock(() =>
  Promise.resolve({ kind: "unavailable" as const })
);
const AccountPage = mock(() => null);
const AccountContentLoading = mock(() => null);

mock.module("next/navigation", () => ({ notFound }));
mock.module("next/server", () => ({ connection }));
mock.module("@/features/account/server/account-feature-flag.server", () => ({
  arePasskeysEnabled,
}));
mock.module("@/features/referrals/referral-feature-flag.server", () => ({
  areReferralsEnabled,
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
mock.module("@/features/account/components/account-screen-copy", () => ({
  getAccountScreenCopy: () => ({
    shell: { sections: { billing: "synthetic-billing" } },
  }),
}));
mock.module("@/features/i18n", () => ({
  m: {
    accountMetadataDescription: () => "synthetic-description",
    accountSectionMetadataTitle: ({ section }: { readonly section: string }) =>
      `${section} | synthetic-title`,
  },
}));

const { AccountSectionRoute, getAccountSectionMetadata } = await import(
  "./account-section-route"
);

type RouteContent = ReactElement<{
  readonly locale: "en-US";
  readonly section?: Promise<string>;
}>;

const renderContent = (section?: string) => {
  const route = AccountSectionRoute({
    locale: "en-US",
    section: section === undefined ? undefined : Promise.resolve(section),
  }) as ReactElement<{
    readonly children: RouteContent;
    readonly fallback: ReactElement<{ readonly locale: "en-US" }>;
  }>;
  const content = route.props.children;
  const Content = content.type as (
    props: RouteContent["props"]
  ) => Promise<unknown>;
  return { content: () => Content(content.props), route };
};

describe("customer account route boundary", () => {
  beforeEach(() => {
    events.length = 0;
    notFound.mockReset();
    notFound.mockImplementation(() => {
      throw new Error("NEXT_NOT_FOUND");
    });
    arePasskeysEnabled.mockReset();
    arePasskeysEnabled.mockImplementation(async () => {
      events.push("passkeys");
      return true;
    });
    areReferralsEnabled.mockReset();
    areReferralsEnabled.mockImplementation(async () => {
      events.push("referrals");
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

  test("loads private account data after connection", async () => {
    const { content, route } = renderContent();

    expect(route.type).toBe(Suspense);
    expect(route.props.fallback.type).toBe(AccountContentLoading);
    expect(route.props.fallback.props.locale).toBe("en-US");
    expect(events).toEqual([]);

    const output = await content();

    expect(events).toEqual(["connection", "load"]);
    expect(loadCustomerAccountPage).toHaveBeenCalledWith();
    expect(output).toMatchObject({
      type: AccountPage,
      props: { locale: "en-US", state: { kind: "unavailable" } },
    });
  });

  test("renders the same account page for a released section's path", async () => {
    const output = await renderContent("security").content();

    expect(events).toEqual(["connection", "passkeys", "referrals", "load"]);
    expect(output).toMatchObject({
      type: AccountPage,
      props: { locale: "en-US", state: { kind: "unavailable" } },
    });
  });

  test.each([
    "unknown",
    "Profile",
    "deleted",
    // Legal & Privacy is its own page; this route never renders it.
    "legal",
  ])(
    "returns not found for the %s segment before loading account data",
    async (section) => {
      await expect(renderContent(section).content()).rejects.toThrow(
        "NEXT_NOT_FOUND"
      );
      expect(events).toEqual(["connection"]);
      expect(loadCustomerAccountPage).not.toHaveBeenCalled();
    }
  );

  test.each([
    ["referrals", areReferralsEnabled, "referrals"],
    ["security", arePasskeysEnabled, "passkeys"],
  ] as const)(
    "returns not found for the withheld %s section",
    async (section, flag, event) => {
      flag.mockImplementation(async () => {
        events.push(event);
        return false;
      });

      await expect(renderContent(section).content()).rejects.toThrow(
        "NEXT_NOT_FOUND"
      );
      expect(loadCustomerAccountPage).not.toHaveBeenCalled();
    }
  );

  test("titles a section's page with the section's label", () => {
    expect(getAccountSectionMetadata("en-US", "billing")).toEqual({
      title: "synthetic-billing | synthetic-title",
      description: "synthetic-description",
      robots: { index: false, follow: false },
    });
    expect(() => getAccountSectionMetadata("en-US", "unknown")).toThrow(
      "NEXT_NOT_FOUND"
    );
    expect(() => getAccountSectionMetadata("en-US", "legal")).toThrow(
      "NEXT_NOT_FOUND"
    );
  });
});
