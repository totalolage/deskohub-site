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

    expect(events).toEqual(["connection", "load"]);
    expect(loadCustomerAccountPage).toHaveBeenCalledWith();
    expect(output).toMatchObject({
      type: AccountPage,
      props: { locale: "en-US", state: { kind: "unavailable" } },
    });
  });

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
