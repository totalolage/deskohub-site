import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { join } from "node:path";
import { testEmailAddress } from "@deskohub/test-email";
import React from "react";
import { getAccountScreenCopy } from "@/features/account/components/account-screen-copy";
import type { CustomerProfileInput } from "@/features/account/contracts";
import { type Locale, m } from "@/features/i18n";
import {
  workspaceRouterPush,
  workspaceRouterRefresh,
  workspaceRouterReplace,
  workspaceUseSearchParams,
} from "@/shared/testing/workspace-component-module-mocks";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";

const adaAddress = testEmailAddress("ada");

registerWorkspaceComponentTestEnv();
// @testing-library/react must load after the happy-dom registration, or
// React's synthetic change events never fire against controlled inputs.
const { act, cleanup, fireEvent, render, waitFor, within } = await import(
  "@testing-library/react"
);

let workspacePathname = "/en-US/account";

mock.module("next/navigation", () => ({
  usePathname: () => workspacePathname,
  useRouter: () => ({
    push: workspaceRouterPush,
    refresh: workspaceRouterRefresh,
    replace: workspaceRouterReplace,
  }),
  useSearchParams: workspaceUseSearchParams,
  unstable_rethrow: (cause: unknown) => {
    throw cause;
  },
}));

mock.module("@/shared/components/guarded-link", () => ({
  GuardedLink: ({
    children,
    href,
  }: {
    readonly children: React.ReactNode;
    readonly href: string;
  }) => <a href={href}>{children}</a>,
}));

const updateCustomerProfile = mock((input: CustomerProfileInput) => {
  void input;
  return Promise.resolve({ data: { status: "updated" } });
});

let legalScreenMountCount = 0;

mock.module("@/features/account/actions", () => ({
  acknowledgeSignupReferralNotice: mock(() =>
    Promise.resolve({ data: { status: "acknowledged" } })
  ),
  updateLocalePreference: () => Promise.resolve({ data: { status: "saved" } }),
  lookupAresBusiness: () =>
    Promise.resolve({ data: { status: "not-found", message: "" } }),
  completeCustomerProfile: () =>
    Promise.resolve({ data: { status: "completed" } }),
  deleteCustomerAccount: () => Promise.resolve({ data: { status: "deleted" } }),
  updateCustomerProfile,
}));

mock.module("@/features/account/avatar-actions", () => ({
  removeCustomerAvatar: () => Promise.resolve({ data: { status: "removed" } }),
  uploadCustomerAvatar: () =>
    Promise.resolve({
      data: {
        avatar: { url: "https://res.cloudinary.test/avatar.webp", version: 1 },
        status: "uploaded",
      },
    }),
}));

mock.module("@/features/account/auth.client", () => ({
  authClient: {
    signIn: { magicLink: () => Promise.resolve({ error: null }) },
    signOut: () => Promise.resolve({ error: null }),
  },
}));

mock.module("@/features/account/components/legal/legal-screen", () => ({
  LegalScreen: ({ locale }: { readonly locale: string }) => {
    React.useEffect(() => {
      legalScreenMountCount += 1;
      return () => {
        legalScreenMountCount -= 1;
      };
    }, []);

    return (
      <>
        <h2>Legal, privacy &amp; GDPR consents</h2>
        <a
          data-testid="privacy-policy-anchor"
          href={`/${locale}/privacy-policy`}
        >
          Privacy policy
        </a>
      </>
    );
  },
}));

mock.module("@/features/account/components/referral-screen", () => ({
  ReferralScreen: () => <div data-testid="referral-screen-mock" />,
}));

mock.module("@/shared/utils/use-workspace-action", () => ({
  useWorkspaceAction: (
    action: (input: CustomerProfileInput) => Promise<unknown>,
    options?: {
      readonly onSuccess?: (args: { readonly data?: unknown }) => void;
    }
  ) => {
    const [result, setResult] = React.useState<{
      readonly data?: { readonly status?: string };
      readonly serverError?: string;
      readonly validationErrors?: unknown;
    }>({});
    const [isExecuting, setExecuting] = React.useState(false);

    return {
      result,
      isExecuting,
      execute: (input: CustomerProfileInput) => {
        setExecuting(true);
        void action(input).then((outcome) => {
          setExecuting(false);
          const nextResult = (outcome ?? {}) as {
            readonly data?: { readonly status?: string };
            readonly serverError?: string;
            readonly validationErrors?: unknown;
          };
          setResult(nextResult);
          if (!nextResult.serverError && !nextResult.validationErrors) {
            options?.onSuccess?.({ data: nextResult.data });
          }
        });
      },
      reset: () => setResult({}),
    };
  },
}));

function getDesktopSectionNavigation(view: {
  readonly container: HTMLElement;
}) {
  const navigation = view.container.querySelector<HTMLDivElement>("div.hidden");
  if (!navigation)
    throw new Error("Desktop account navigation was not rendered");
  return within(navigation);
}

const profile = {
  firstName: "Ada",
  lastName: "Lovelace",
  phone: "+420601111222",
  billing: {
    kind: "business" as const,
    addressLine1: "Original Street 1",
    addressLine2: "Original Suite",
    city: "Prague",
    zip: "11000",
    country: "CZ",
    companyName: "Original Company",
    companyId: "12345678",
    vatId: "CZ12345678",
  },
};
const hiddenAvatarPresentation = { kind: "hidden" } as const;
const locale = "en-US";
const sectionLabels = {
  group: m.accountSectionLabel({}, { locale }),
  reservations: new RegExp(`^${m.accountSectionReservations({}, { locale })}`),
  profile: m.accountSectionProfile({}, { locale }),
  security: m.accountSectionSecurity({}, { locale }),
  billing: m.accountSectionBilling({}, { locale }),
  legal: m.accountSectionLegal({}, { locale }),
  danger: m.accountSectionDanger({}, { locale }),
};

const history = {
  kind: "available" as const,
  groups: {
    current: [
      {
        id: "current-1",
        product: { kind: "other" as const },
        startsAt: null,
        endsAt: null,
        seats: null,
        status: "confirmed" as const,
      },
    ],
    past: [],
    unavailable: [],
  },
};

const { AccountLayoutShell, useAccountLayout } = await import(
  "./account-layout-shell"
);
const { ReservationHistory } = await import("./reservation-history");

const reservations = (
  <ReservationHistory
    copy={getAccountScreenCopy(locale).reservations}
    history={history}
    locale={locale}
  />
);

function withAccountLayout(
  children: React.ReactNode,
  {
    locale = "en-US",
    passkeysEnabled = false,
  }: { readonly locale?: Locale; readonly passkeysEnabled?: boolean } = {}
) {
  return (
    <AccountLayoutShell
      locale={locale}
      passkeysEnabled={passkeysEnabled}
      referralsEnabled
      signedIn
    >
      {children}
    </AccountLayoutShell>
  );
}

function ActivityAccountSectionProbe() {
  const { activeSection } = useAccountLayout();
  return (
    <output
      data-active-section={activeSection}
      data-testid="activity-account-section"
    >
      {activeSection}
    </output>
  );
}

describe("LinkedAccount", () => {
  test("leaves reservation history, and its Intl dates, out of the client bundle", async () => {
    // Node and browsers space Intl dates differently (Node's narrow no-break
    // spaces against Chromium's plain ones), so dates formatted again in the
    // client tree fail hydration of the server HTML. The page renders the
    // history on the server and passes it in.
    const build = await Bun.build({
      entrypoints: [join(import.meta.dir, "linked-account.tsx")],
      metafile: true,
      packages: "external",
      target: "browser",
    });

    expect(build.success).toBe(true);
    const inputs = Object.keys(build.metafile?.inputs ?? {});
    expect(inputs.some((input) => input.endsWith("/linked-account.tsx"))).toBe(
      true
    );
    expect(
      inputs.filter((input) => input.endsWith("/reservation-history.tsx"))
    ).toEqual([]);
  });

  beforeAll(() => {
    registerWorkspaceComponentTestEnv();
  });

  afterEach(() => {
    cleanup();
    legalScreenMountCount = 0;
    updateCustomerProfile.mockClear();
    workspaceRouterPush.mockClear();
    workspaceRouterRefresh.mockClear();
    workspaceUseSearchParams.mockReturnValue(new URLSearchParams());
    workspacePathname = "/en-US/account";
  });

  afterAll(async () => {
    await unregisterWorkspaceComponentTestEnv();
  });

  test("mounts each panel once and keeps one profile form across navigation", async () => {
    const { LinkedAccount } = await import("./linked-account");
    const view = render(
      withAccountLayout(
        <LinkedAccount
          referralsEnabled
          avatarPresentation={hiddenAvatarPresentation}
          email={adaAddress}
          reservationCount={history.groups.current.length}
          reservations={reservations}
          locale="en-US"
          profile={profile}
        />
      )
    );
    const sectionNavigation = within(
      view.getByRole("group", { name: sectionLabels.group })
    );
    const desktopSectionNavigation = getDesktopSectionNavigation(view);

    expect(
      sectionNavigation.getByRole("link", {
        name: sectionLabels.reservations,
      })
    ).toBeTruthy();
    expect(
      desktopSectionNavigation.getByRole("link", {
        name: sectionLabels.reservations,
      }).textContent
    ).toContain("1");
    expect(
      view.container.querySelectorAll("#account-profile-form")
    ).toHaveLength(1);
    const helpHeadings = view.getAllByRole("heading", {
      level: 2,
      name: m.accountHelpTitle({}, { locale }),
    });
    expect(helpHeadings).toHaveLength(2);
    expect(view.container.textContent).toContain(
      m.accountHelpBody(
        { contact: m.accountHelpContact({}, { locale }) },
        { locale }
      )
    );
    expect(view.container.textContent).not.toContain(
      m.accountSupportTitle({}, { locale })
    );
    const contactLinks = view.getAllByRole("link", {
      name: m.accountHelpContact({}, { locale }),
    });
    expect(contactLinks).toHaveLength(2);
    expect(contactLinks.map((link) => link.getAttribute("href"))).toEqual([
      "/en-US/contact",
      "/en-US/contact",
    ]);

    fireEvent.click(
      sectionNavigation.getByRole("link", { name: sectionLabels.profile })
    );
    fireEvent.click(
      sectionNavigation.getByRole("link", { name: sectionLabels.billing })
    );
    expect(
      view.container.querySelector("[data-screen='profile-screen']")
        ?.parentElement?.hidden
    ).toBe(true);
    expect(
      view.container.querySelectorAll("#account-profile-feedback")
    ).toHaveLength(1);
    expect(
      view.container.querySelectorAll("#account-profile-submit")
    ).toHaveLength(1);

    fireEvent.click(
      sectionNavigation.getByRole("link", {
        name: sectionLabels.reservations,
      })
    );
    expect(
      view.container.querySelector("#account-profile-form")?.parentElement
        ?.hidden
    ).toBe(true);
    fireEvent.click(
      sectionNavigation.getByRole("link", { name: sectionLabels.legal })
    );
    expect(workspaceRouterPush).toHaveBeenCalledWith("/en-US/account/legal");
    fireEvent.click(
      sectionNavigation.getByRole("link", { name: sectionLabels.danger })
    );
    expect(
      view.getByText(m.accountDeletionButton({}, { locale }))
    ).toBeTruthy();
  });

  test("publishes the rounded-up referral discount as a navigation badge, hidden at 0%", async () => {
    const { LinkedAccount } = await import("./linked-account");
    const { parseReferralCode } = await import("@/features/referrals/client");
    const code = parseReferralCode("RFL12345");
    if (code === undefined) throw new Error("Invalid referral test code");
    const referralsWith = (discount: string) => ({
      summary: {
        code,
        inviteeCount: 5,
        eligibleInviteeCount: discount === "0" ? 0 : 3,
        discount,
        savings: [],
      },
      shareUrl: "https://workspace.example/account?ref=RFL12345",
    });
    const renderLinked = (discount: string) =>
      withAccountLayout(
        <LinkedAccount
          referralsEnabled
          avatarPresentation={hiddenAvatarPresentation}
          email={adaAddress}
          reservationCount={history.groups.current.length}
          reservations={reservations}
          locale="en-US"
          profile={profile}
          referrals={referralsWith(discount)}
        />
      );
    const referralBadge = () =>
      getDesktopSectionNavigation(view)
        .getByRole("link", {
          name: new RegExp(`^${m.accountSectionReferrals({}, { locale })}`),
        })
        .querySelector("span.ml-auto");
    const view = render(renderLinked("14.2625"));

    expect(referralBadge()?.textContent).toBe("-15%15% referral discount");

    view.rerender(renderLinked("0"));
    expect(referralBadge()).toBeNull();

    view.rerender(renderLinked("5"));
    expect(referralBadge()?.textContent).toBe("-5%5% referral discount");
    view.rerender(withAccountLayout(<p>Legal content</p>));
    expect(referralBadge()).toBeNull();
  });

  test("leaves legal to its own page in every section", async () => {
    const { LinkedAccount } = await import("./linked-account");

    for (const section of [
      "reservations",
      "profile",
      "billing",
      "danger",
      "legal",
    ] as const) {
      workspacePathname = `/en-US/account/${section}`;
      const view = render(
        withAccountLayout(
          <LinkedAccount
            referralsEnabled
            avatarPresentation={hiddenAvatarPresentation}
            email={adaAddress}
            reservationCount={history.groups.current.length}
            reservations={reservations}
            locale="en-US"
            profile={profile}
          />
        )
      );

      expect(legalScreenMountCount).toBe(0);
      view.unmount();
    }
  });

  test.each([
    ["en-US", "/en-US/account/profile", "/en-US/account/legal/"],
    ["cs-CZ", "/cs-CZ/account/profile/", "/cs-CZ/account/legal"],
  ] as const)(
    "does not retain private legal content when public legal replaces it for %s",
    async (locale, privatePathname, publicLegalPathname) => {
      const { LinkedAccount } = await import("./linked-account");
      const { PublicAccountLegal } = await import("./public-account-legal");

      workspacePathname = privatePathname;
      const privateAccount = (
        <div data-testid="cached-private-account">
          <LinkedAccount
            referralsEnabled
            avatarPresentation={hiddenAvatarPresentation}
            email={adaAddress}
            reservationCount={history.groups.current.length}
            reservations={reservations}
            locale={locale}
            profile={profile}
          />
          <ActivityAccountSectionProbe />
        </div>
      );
      const view = render(
        withAccountLayout(
          <>
            <React.Activity mode="visible">{privateAccount}</React.Activity>
            <div data-testid="public-account-legal-peer" />
          </>,
          { locale }
        )
      );

      workspacePathname = publicLegalPathname;
      view.rerender(
        withAccountLayout(
          <>
            <React.Activity mode="hidden">{privateAccount}</React.Activity>
            <div data-testid="public-account-legal-peer">
              <PublicAccountLegal locale={locale} />
            </div>
          </>,
          { locale }
        )
      );

      await waitFor(() => {
        expect(
          view
            .getByTestId("activity-account-section")
            .getAttribute("data-active-section")
        ).toBe("legal");
      });

      const privacyPolicySelector =
        "a[data-testid='privacy-policy-anchor'][href$='/privacy-policy']";
      expect(
        view.container.querySelectorAll(privacyPolicySelector)
      ).toHaveLength(1);
      expect(
        view
          .getByTestId("cached-private-account")
          .querySelectorAll(privacyPolicySelector)
      ).toHaveLength(0);
      expect(
        view
          .getByTestId("public-account-legal-peer")
          .querySelectorAll(privacyPolicySelector)
      ).toHaveLength(1);
    }
  );

  test("confirms legal navigation before leaving a dirty profile form", async () => {
    const { UnsavedChangesProvider } = await import(
      "@/shared/components/unsaved-changes-guard"
    );
    const { LinkedAccount } = await import("./linked-account");
    const originalConfirm = window.confirm;
    const confirmDiscardChanges = mock(() => false);
    window.confirm = confirmDiscardChanges;

    try {
      const view = render(
        <UnsavedChangesProvider>
          {withAccountLayout(
            <LinkedAccount
              referralsEnabled
              avatarPresentation={hiddenAvatarPresentation}
              email={adaAddress}
              reservationCount={history.groups.current.length}
              reservations={reservations}
              locale="en-US"
              profile={profile}
            />
          )}
        </UnsavedChangesProvider>
      );
      const sectionNavigation = getDesktopSectionNavigation(view);

      fireEvent.click(
        sectionNavigation.getByRole("link", {
          name: sectionLabels.profile,
        })
      );
      await act(async () => {
        fireEvent.input(
          view.getByLabelText(m.accountProfileFirstNameLabel({}, { locale })),
          {
            target: { value: "Grace" },
          }
        );
      });
      const firstName = view.getByLabelText(
        m.accountProfileFirstNameLabel({}, { locale })
      ) as HTMLInputElement;

      fireEvent.click(
        sectionNavigation.getByRole("link", { name: sectionLabels.legal })
      );

      expect(confirmDiscardChanges).toHaveBeenCalledTimes(1);
      expect(workspaceRouterPush).not.toHaveBeenCalled();
      expect(firstName.value).toBe("Grace");
      expect(
        sectionNavigation
          .getByRole("link", { name: sectionLabels.profile })
          .getAttribute("aria-current")
      ).toBe("page");
      expect(updateCustomerProfile).not.toHaveBeenCalled();

      confirmDiscardChanges.mockImplementation(() => true);
      fireEvent.click(
        sectionNavigation.getByRole("link", { name: sectionLabels.legal })
      );

      expect(confirmDiscardChanges).toHaveBeenCalledTimes(2);
      expect(workspaceRouterPush).toHaveBeenCalledWith("/en-US/account/legal");
      expect(firstName.value).toBe("Grace");
    } finally {
      window.confirm = originalConfirm;
    }
  });

  test("reconciles section path changes without resetting the profile form", async () => {
    const { UnsavedChangesProvider } = await import(
      "@/shared/components/unsaved-changes-guard"
    );
    const { LinkedAccount } = await import("./linked-account");
    workspacePathname = "/en-US/account/profile";

    const renderAccount = () => (
      <UnsavedChangesProvider>
        {withAccountLayout(
          <LinkedAccount
            referralsEnabled
            avatarPresentation={hiddenAvatarPresentation}
            email={adaAddress}
            reservationCount={history.groups.current.length}
            reservations={reservations}
            locale="en-US"
            profile={profile}
          />
        )}
      </UnsavedChangesProvider>
    );
    const view = render(renderAccount());
    const sectionNavigation = getDesktopSectionNavigation(view);
    const firstName = view.getByLabelText(
      m.accountProfileFirstNameLabel({}, { locale })
    ) as HTMLInputElement;

    await act(async () => {
      fireEvent.input(firstName, { target: { value: "Grace" } });
    });
    expect(firstName.value).toBe("Grace");

    workspacePathname = "/en-US/account/billing";
    await act(async () => {
      view.rerender(renderAccount());
    });
    expect(
      sectionNavigation
        .getByRole("link", { name: sectionLabels.billing })
        .getAttribute("aria-current")
    ).toBe("page");
    expect(firstName.value).toBe("Grace");

    workspacePathname = "/en-US/account/legal";
    await act(async () => {
      view.rerender(renderAccount());
    });
    expect(
      sectionNavigation
        .getByRole("link", { name: sectionLabels.legal })
        .getAttribute("aria-current")
    ).toBe("page");
    expect(firstName.value).toBe("Grace");

    workspacePathname = "/en-US/account/profile";
    await act(async () => {
      view.rerender(renderAccount());
    });
    expect(
      sectionNavigation
        .getByRole("link", { name: sectionLabels.profile })
        .getAttribute("aria-current")
    ).toBe("page");
    expect(firstName.value).toBe("Grace");
    expect(updateCustomerProfile).not.toHaveBeenCalled();
  });

  test("shows no referral screen, badge, or completion notice while the program is withheld", async () => {
    workspacePathname = "/en-US/account/referrals";
    const { LinkedAccount } = await import("./linked-account");
    const { parseReferralCode } = await import("@/features/referrals/client");
    const code = parseReferralCode("RFL12345");
    if (code === undefined) throw new Error("Invalid referral test code");
    const view = render(
      <AccountLayoutShell locale="en-US" referralsEnabled={false} signedIn>
        <LinkedAccount
          avatarPresentation={hiddenAvatarPresentation}
          email={adaAddress}
          reservationCount={history.groups.current.length}
          reservations={reservations}
          locale="en-US"
          profile={profile}
          referrals={{
            summary: {
              code,
              inviteeCount: 5,
              eligibleInviteeCount: 3,
              discount: "14.2625",
              savings: [],
            },
            shareUrl: "https://workspace.example/account?ref=RFL12345",
          }}
          referralsEnabled={false}
          signupReferral={{ status: "applied" }}
        />
      </AccountLayoutShell>
    );

    expect(view.queryByTestId("referral-screen-mock")).toBeNull();
    expect(view.queryByText(/-15%/)).toBeNull();
    expect(
      view.queryByRole("button", {
        name: m.accountProfileReferralNoticeDismiss({}, { locale }),
      })
    ).toBeNull();
    expect(
      getDesktopSectionNavigation(view).queryByRole("link", {
        name: new RegExp(`^${m.accountSectionReferrals({}, { locale })}`),
      })
    ).toBeNull();
    expect(
      getDesktopSectionNavigation(view)
        .getByRole("link", { name: sectionLabels.reservations })
        .getAttribute("aria-current")
    ).toBe("page");
  });

  test("keeps the unsaved-changes guard registered when the form is hidden", async () => {
    const { UnsavedChangesProvider } = await import(
      "@/shared/components/unsaved-changes-guard"
    );
    const { LinkedAccount } = await import("./linked-account");
    const originalConfirm = window.confirm;
    const confirm = mock(() => false);
    window.confirm = confirm;

    try {
      const view = render(
        <UnsavedChangesProvider>
          {withAccountLayout(
            <LinkedAccount
              referralsEnabled
              avatarPresentation={hiddenAvatarPresentation}
              email={adaAddress}
              reservationCount={history.groups.current.length}
              reservations={reservations}
              locale="en-US"
              profile={profile}
            />
          )}
        </UnsavedChangesProvider>
      );
      const sectionNavigation = within(
        view.getByRole("group", { name: sectionLabels.group })
      );

      fireEvent.click(
        sectionNavigation.getByRole("link", { name: sectionLabels.profile })
      );
      await act(async () => {
        fireEvent.input(
          view.getByLabelText(m.accountProfileFirstNameLabel({}, { locale })),
          {
            target: { value: "Grace" },
          }
        );
      });
      fireEvent.click(
        sectionNavigation.getByRole("link", {
          name: sectionLabels.reservations,
        })
      );

      const profilePanel = view.container.querySelector(
        "#account-profile-form"
      )?.parentElement;
      expect(profilePanel?.hidden).toBe(true);
      expect(
        (
          view.getByLabelText(
            m.accountProfileFirstNameLabel({}, { locale })
          ) as HTMLInputElement
        ).value
      ).toBe("Grace");

      const beforeUnload = new Event("beforeunload", { cancelable: true });
      window.dispatchEvent(beforeUnload);
      expect(beforeUnload.defaultPrevented).toBe(true);
      expect(confirm).not.toHaveBeenCalled();
    } finally {
      window.confirm = originalConfirm;
    }
  });

  test("lists the account's passkeys under Sign-in & security while passkeys are on", async () => {
    const { LinkedAccount } = await import("./linked-account");
    const view = render(
      withAccountLayout(
        <LinkedAccount
          referralsEnabled
          avatarPresentation={hiddenAvatarPresentation}
          email={adaAddress}
          reservationCount={history.groups.current.length}
          reservations={reservations}
          locale="en-US"
          passkeys={{
            accountId: "account-1",
            passkeys: [
              {
                id: "passkey-1",
                name: "Work laptop",
                provider: "Google Password Manager",
                createdAt: "2026-10-14T16:40:00.000Z",
              },
              {
                id: "passkey-2",
                name: undefined,
                provider: undefined,
                createdAt: "2026-10-15T08:00:00.000Z",
              },
            ],
          }}
          profile={profile}
        />,
        { passkeysEnabled: true }
      )
    );

    fireEvent.click(
      within(view.getByRole("group", { name: sectionLabels.group })).getByRole(
        "link",
        { name: sectionLabels.security }
      )
    );

    const list = view.getByRole("list", {
      name: m.accountSecurityPasskeysTitle({}, { locale }),
    });
    expect(within(list).getByText("Work laptop")).toBeTruthy();
    expect(
      within(list).getByText(
        m.accountSecurityPasskeyDefaultName({}, { locale })
      )
    ).toBeTruthy();
    expect(
      view.getByRole("button", {
        name: m.accountSecurityPasskeyDeleteLabel(
          { name: "Work laptop" },
          { locale }
        ),
      })
    ).toBeTruthy();
    expect(
      view.getByText(m.accountSecurityEmailTitle({}, { locale }))
    ).toBeTruthy();
  });

  test("shows no Sign-in & security panel without passkey settings", async () => {
    const { LinkedAccount } = await import("./linked-account");
    const view = render(
      withAccountLayout(
        <LinkedAccount
          referralsEnabled
          avatarPresentation={hiddenAvatarPresentation}
          email={adaAddress}
          reservationCount={history.groups.current.length}
          reservations={reservations}
          locale="en-US"
          profile={profile}
        />
      )
    );

    expect(
      view.queryByRole("link", { name: sectionLabels.security })
    ).toBeNull();
    expect(
      view.queryByText(m.accountSecurityPasskeysTitle({}, { locale }))
    ).toBeNull();
  });
});
