import { beforeEach, describe, expect, mock, test } from "bun:test";
import { type ReactElement, Suspense } from "react";

const events: string[] = [];
const notFound = mock(() => {
  throw new Error("NEXT_NOT_FOUND");
});
const arePasskeysEnabled = mock(() => Promise.resolve(true));
const areReferralsEnabled = mock(() => Promise.resolve(true));
const connection = mock(() => Promise.resolve());
const getRequestPathname = mock(() =>
  Promise.resolve<string | undefined>("/en-US/account")
);
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
mock.module("@/shared/backend/utils/request-pathname", () => ({
  getRequestPathname,
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
const i18n = await import("@/features/i18n");
mock.module("@/features/i18n", () => ({
  ...i18n,
  m: {
    accountMetadataDescription: () => "synthetic-description",
    accountSectionBilling: () => "synthetic-billing",
    accountSectionMetadataTitle: ({ section }: { readonly section: string }) =>
      `${section} | synthetic-title`,
  },
}));

const { AccountSectionPathCheck, AccountSections, getAccountSectionMetadata } =
  await import("./account-section-route");

type SuspendedContent<Props> = ReactElement<{
  readonly children: ReactElement<Props>;
  readonly fallback: ReactElement<{ readonly locale?: "en-US" }> | null;
}>;

const renderSuspended = <Props>(boundary: SuspendedContent<Props>) => {
  const content = boundary.props.children;
  const Content = content.type as (props: Props) => Promise<unknown>;
  return () => Content(content.props);
};

const renderSections = () => {
  const route = AccountSections({ locale: "en-US" }) as SuspendedContent<{
    readonly locale: "en-US";
  }>;
  return { content: renderSuspended(route), route };
};

const renderPathCheck = (section: string) => {
  const route = AccountSectionPathCheck({
    section: Promise.resolve(section),
  }) as SuspendedContent<{ readonly section: Promise<string> }>;
  return { content: renderSuspended(route), route };
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
    getRequestPathname.mockReset();
    getRequestPathname.mockImplementation(async () => {
      events.push("pathname");
      return "/en-US/account";
    });
    loadCustomerAccountPage.mockClear();
    loadCustomerAccountPage.mockImplementation(async () => {
      events.push("load");
      return { kind: "unavailable" as const };
    });
    AccountPage.mockClear();
  });

  test("loads private account data after connection", async () => {
    const { content, route } = renderSections();

    expect(route.type).toBe(Suspense);
    expect(route.props.fallback?.type).toBe(AccountContentLoading);
    expect(route.props.fallback?.props.locale).toBe("en-US");
    expect(events).toEqual([]);

    const output = await content();

    expect(events).toEqual([
      "connection",
      "pathname",
      "passkeys",
      "referrals",
      "load",
    ]);
    expect(loadCustomerAccountPage).toHaveBeenCalledWith();
    expect(output).toMatchObject({
      type: AccountPage,
      props: { locale: "en-US", state: { kind: "unavailable" } },
    });
  });

  test.each([
    "/en-US/account/",
    "/en-US/account/security",
    "/en-US/account/referrals",
    "/en-US/account/danger",
  ])("loads the account page at %s", async (pathname) => {
    getRequestPathname.mockImplementation(async () => pathname);

    expect(await renderSections().content()).toMatchObject({
      type: AccountPage,
    });
  });

  // A signed-out visitor's account page redirects to sign-in, so the check
  // must settle before the account loads.
  test.each([
    ["an unknown section", "/en-US/account/unknown"],
    ["a section in another case", "/en-US/account/Profile"],
    ["a nested path", "/en-US/account/profile/extra"],
    ["another locale's account", "/cs-CZ/account/profile"],
    ["a request the proxy did not hand on", undefined],
  ])(
    "returns not found for %s without loading the account",
    async (_, pathname) => {
      getRequestPathname.mockImplementation(async () => pathname);

      await expect(renderSections().content()).rejects.toThrow(
        "NEXT_NOT_FOUND"
      );
      expect(loadCustomerAccountPage).not.toHaveBeenCalled();
      expect(AccountPage).not.toHaveBeenCalled();
    }
  );

  test.each([
    ["referrals", areReferralsEnabled],
    ["security", arePasskeysEnabled],
  ] as const)(
    "returns not found for the withheld %s section without loading the account",
    async (section, flag) => {
      getRequestPathname.mockImplementation(
        async () => `/en-US/account/${section}`
      );
      flag.mockImplementation(async () => false);

      await expect(renderSections().content()).rejects.toThrow(
        "NEXT_NOT_FOUND"
      );
      expect(loadCustomerAccountPage).not.toHaveBeenCalled();
    }
  );

  test("leaves a released section's path to the sections' account page", async () => {
    const { content, route } = renderPathCheck("security");

    expect(route.type).toBe(Suspense);
    expect(route.props.fallback).toBeNull();
    expect(await content()).toBeNull();
    expect(events).toEqual(["connection", "passkeys", "referrals"]);
    expect(loadCustomerAccountPage).not.toHaveBeenCalled();
  });

  test.each([
    "unknown",
    "Profile",
    "deleted",
    // Legal & Privacy is its own page; this route never renders it.
    "legal",
  ])("returns not found for the %s segment", async (section) => {
    await expect(renderPathCheck(section).content()).rejects.toThrow(
      "NEXT_NOT_FOUND"
    );
    expect(events).toEqual(["connection"]);
  });

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

      await expect(renderPathCheck(section).content()).rejects.toThrow(
        "NEXT_NOT_FOUND"
      );
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
