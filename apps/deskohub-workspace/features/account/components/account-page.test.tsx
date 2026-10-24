import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import { useState } from "react";
import type {
  CustomerProfileInput,
  CustomerReservationHistory,
} from "@/features/account/contracts";
import { type Locale, m } from "@/features/i18n";
import {
  formatReferralInvitationDiscount,
  parseReferralCode,
} from "@/features/referrals/client";
import {
  workspaceRouterPush,
  workspaceRouterRefresh,
  workspaceRouterReplace,
  workspaceUseSearchParams,
} from "@/shared/testing/workspace-component-module-mocks";
import {
  flushWorkspaceComponentWork,
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import type { CustomerAccountPageState } from "../page-data.server";

registerWorkspaceComponentTestEnv();
const { act, cleanup, fireEvent, render, waitFor, within } = await import(
  "@testing-library/react"
);

const adaAddress = testEmailAddress("ada");

const signInMagicLink = mock(() => Promise.resolve({ error: null }));
const getSession = mock(() => Promise.resolve({ data: null, error: null }));
const beginAnalyticsAccountTransition = mock(() => undefined);
const completeAnalyticsAccountSignOut = mock(() => undefined);
const refreshAnalyticsAccountIdentity = mock(() => Promise.resolve());
const acknowledgeSignupReferralNotice = mock(() =>
  Promise.resolve({ data: { status: "acknowledged" } } as never)
);
const completeCustomerProfile = mock((_input: CustomerProfileInput) =>
  Promise.resolve({ data: { status: "completed" } })
);
const executedWorkspaceActionNames: string[] = [];
mock.module("@/features/account/analytics-identity", () => ({
  beginAnalyticsAccountTransition,
  completeAnalyticsAccountSignOut,
  getAnalyticsAccountIdentity: () => ({ status: "anonymous" }),
  refreshAnalyticsAccountIdentity,
  subscribeAnalyticsAccountIdentity: () => () => undefined,
}));
mock.module("next/navigation", () => ({
  unstable_rethrow: (cause: unknown) => {
    throw cause;
  },
  usePathname: () => "/en-US/account",
  useRouter: () => ({
    push: workspaceRouterPush,
    refresh: workspaceRouterRefresh,
    replace: workspaceRouterReplace,
  }),
  useSearchParams: workspaceUseSearchParams,
}));
mock.module("@/shared/utils/use-workspace-action", () => ({
  useWorkspaceAction: (
    action: (input: never) => Promise<unknown>,
    options?: {
      readonly actionName?: string;
      readonly onSuccess?: (args: { readonly data?: unknown }) => void;
    }
  ) => {
    const [result, setResult] = useState<{
      readonly data?: unknown;
      readonly serverError?: string;
      readonly validationErrors?: unknown;
    }>({});
    const [isExecuting, setExecuting] = useState(false);
    return {
      result,
      isExecuting,
      execute: (input: never) => {
        if (options?.actionName !== undefined) {
          executedWorkspaceActionNames.push(options.actionName);
        }
        setExecuting(true);
        void action(input).then((outcome) => {
          setExecuting(false);
          const nextResult = outcome as {
            readonly data?: unknown;
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
mock.module("@/features/account/actions", () => ({
  acknowledgeSignupReferralNotice,
  lookupAresBusiness: () =>
    Promise.resolve({ data: { status: "not-found", message: "" } }),
  completeCustomerProfile,
  updateCustomerProfile: () => Promise.resolve({ data: { status: "updated" } }),
  updateLocalePreference: () => Promise.resolve({ data: { status: "saved" } }),
  deleteCustomerAccount: () => Promise.resolve({ data: { status: "deleted" } }),
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
type MarketingPreferenceSaveInput = {
  readonly confirmed: true;
  readonly context: string;
  readonly granted: boolean;
  readonly locale: Locale;
  readonly source: "link" | "account";
};

type MarketingManagementInput = {
  readonly context: string;
};

type LegalActionResult = {
  readonly data?: { readonly status: string };
  readonly serverError?: string;
  readonly validationErrors?: unknown;
};

const saveMarketingPreferencesAction = mock(
  (_input: MarketingPreferenceSaveInput): Promise<LegalActionResult> =>
    Promise.resolve({ data: { status: "saved" } })
);
const confirmMarketingManagementAction = mock(
  (_input: MarketingManagementInput): Promise<LegalActionResult> =>
    Promise.resolve({ data: { status: "confirmed" } })
);
const clearMarketingManagementAction = mock(
  (_input: MarketingManagementInput): Promise<LegalActionResult> =>
    Promise.resolve({ data: { status: "cleared" } })
);

mock.module("@/features/legal/actions", () => ({
  clearMarketingManagementAction,
  confirmMarketingManagementAction,
  saveMarketingPreferencesAction,
}));
mock.module("@/features/account/auth.client", () => ({
  authClient: {
    getSession,
    signIn: { magicLink: signInMagicLink },
    signOut: () => Promise.resolve({ error: null }),
  },
}));

class TestResizeObserver implements ResizeObserver {
  readonly callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }

  disconnect() {}

  observe(_target: Element) {}

  unobserve(_target: Element) {}
}

const originalResizeObserver = globalThis.ResizeObserver;
const en = { locale: "en-US" } as const;

const linkedState = {
  kind: "linked",
  email: adaAddress,
  profile: {
    firstName: "Ada",
    lastName: "Lovelace",
    phone: null,
    billing: null,
  },
  history: {
    kind: "available",
    groups: { current: [], past: [], unavailable: [] },
  },
  avatar: { kind: "hidden" },
  referralsEnabled: true,
} as const;

describe("AccountPage states", () => {
  beforeAll(() => {
    registerWorkspaceComponentTestEnv();
    globalThis.ResizeObserver = TestResizeObserver;
  });

  afterEach(() => {
    cleanup();
    completeCustomerProfile.mockClear();
    executedWorkspaceActionNames.length = 0;
    workspaceRouterRefresh.mockClear();
    workspaceRouterRefresh.mockImplementation(() => undefined);
    workspaceRouterReplace.mockClear();
    beginAnalyticsAccountTransition.mockClear();
    completeAnalyticsAccountSignOut.mockClear();
    refreshAnalyticsAccountIdentity.mockClear();
    workspaceUseSearchParams.mockReturnValue(new URLSearchParams());
    getSession.mockClear();
  });

  afterAll(async () => {
    cleanup();
    await flushWorkspaceComponentWork();
    globalThis.ResizeObserver = originalResizeObserver;
    await unregisterWorkspaceComponentTestEnv();
  });

  const renderState = async (
    state: CustomerAccountPageState,
    locale: "en-US" | "cs-CZ" = "en-US"
  ) => {
    const { AccountPage } = await import("./account-page");
    if (state.kind === "unauthenticated") {
      return render(<AccountPage locale={locale} state={state} />);
    }

    const { AccountLayoutShell } = await import("./account-layout-shell");
    const signedIn =
      state.kind !== "unauthenticated" && state.kind !== "unavailable";
    const view = render(
      <AccountLayoutShell
        locale={locale}
        passkeysEnabled={"passkeys" in state && state.passkeys !== undefined}
        referralsEnabled
        signedIn={signedIn}
      >
        <AccountPage locale={locale} state={state} />
      </AccountLayoutShell>
    );

    expect(view.container.querySelectorAll("main")).toHaveLength(1);
    expect(
      within(view.container).getAllByRole("heading", { level: 1 })
    ).toHaveLength(1);
    expect(
      within(view.container).getAllByText(m.accountTitle({}, { locale }))
    ).toHaveLength(1);
    expect(view.container.querySelectorAll("#account-sign-out")).toHaveLength(
      signedIn ? 1 : 0
    );

    return view;
  };

  test("asks for profile completion with the read-only verified email", async () => {
    const view = await renderState({
      kind: "completion-required",
      referralsEnabled: true,
      email: adaAddress,
    });

    expect(
      view.getByRole("heading", {
        level: 2,
        name: m.accountCompletionTitle({}, en),
      })
    ).toBeTruthy();
    const email = view.getByLabelText(
      m.accountProfileEmailLabel({}, en)
    ) as HTMLInputElement;
    expect(email.value).toBe(adaAddress);
    expect(email.readOnly).toBe(true);
    expect(
      view.getByLabelText(m.accountProfileFirstNameLabel({}, en))
    ).toBeTruthy();
    expect(view.getByText(m.accountSignOut({}, en))).toBeTruthy();
    await act(async () => {
      fireEvent.click(
        view.getByRole("button", { name: m.accountDeletionButton({}, en) })
      );
    });
    expect(
      view.getByRole("button", { name: m.accountDeletionConfirm({}, en) })
    ).toBeTruthy();
  });

  const authoredHistory: CustomerReservationHistory = {
    kind: "available",
    groups: {
      current: [
        {
          id: "workspace-reservation-1",
          workspaceReservationId: "workspace-reservation-1",
          party: { kind: "booked-for", customerName: "Karla Ukázková" },
          product: { kind: "meeting-room" },
          startsAt: "2999-01-01T10:00:00.000Z",
          endsAt: "2999-01-01T11:00:00.000Z",
          seats: 4,
          status: "confirmed",
        },
      ],
      past: [],
      unavailable: [],
    },
  };

  test("shows the reservation an account booked for someone else beside profile completion", async () => {
    const view = await renderState({
      kind: "completion-required",
      referralsEnabled: true,
      email: adaAddress,
      history: authoredHistory,
    });

    expect(
      view.getByText(
        m.accountReservationBookedFor({ name: "Karla Ukázková" }, en)
      )
    ).toBeTruthy();
    expect(
      view.getByRole("heading", {
        level: 2,
        name: m.accountCompletionTitle({}, en),
      })
    ).toBeTruthy();
  });

  test("shows the reservation an account booked for someone else beside the support notice", async () => {
    const view = await renderState({
      kind: "support-required",
      email: adaAddress,
      history: authoredHistory,
    });

    expect(
      view.getByText(
        m.accountReservationBookedFor({ name: "Karla Ukázková" }, en)
      )
    ).toBeTruthy();
    expect(
      view.getByRole("heading", {
        level: 2,
        name: m.accountSupportTitle({}, en),
      })
    ).toBeTruthy();
    expect(view.queryByText(m.accountProfileSave({}, en))).toBeNull();
  });

  test("shows a review account's sandbox reservations beside its card, without profile completion or PIN links", async () => {
    const view = await renderState({
      kind: "review-account",
      email: adaAddress,
      history: {
        kind: "available",
        groups: {
          current: [
            {
              id: "review-sample-order",
              workspaceReservationId: "review-sample-order",
              reviewSandbox: true,
              product: { kind: "meeting-room" },
              startsAt: "2999-01-01T10:00:00.000Z",
              endsAt: "2999-01-01T11:00:00.000Z",
              seats: 1,
              status: "confirmed",
            },
          ],
          past: [],
          unavailable: [],
        },
      },
    });
    const hrefs = view
      .getAllByRole("link")
      .map((link) => link.getAttribute("href") ?? "");

    expect(
      view.container.querySelector("#account-review-account")
    ).toBeTruthy();
    expect(
      view.container.querySelector("#account-completion-required")
    ).toBeNull();
    expect(
      hrefs.some((href) =>
        href.endsWith("/reservation/status/review-sample-order")
      )
    ).toBe(true);
    expect(hrefs.some((href) => href.includes("/reservation/access/"))).toBe(
      false
    );
  });

  test("offers a review account no account deletion", async () => {
    const view = await renderState({
      kind: "review-account",
      email: adaAddress,
      history: {
        kind: "available",
        groups: { current: [], past: [], unavailable: [] },
      },
    });

    expect(
      view.container.querySelector("#account-review-account")
    ).toBeTruthy();
    expect(view.container.querySelector("#delete-account-trigger")).toBeNull();
  });

  test("offers no account deletion while deletion eligibility is unknown", async () => {
    const view = await renderState({
      kind: "authenticated-unavailable",
      email: adaAddress,
      deletionUnavailable: true,
    });

    expect(
      view.container.querySelector("#account-profile-unavailable")
    ).toBeTruthy();
    expect(view.container.querySelector("#delete-account-trigger")).toBeNull();
  });

  test("renders the linked account with profile, reservations, sign out, and deletion", async () => {
    const view = await renderState(linkedState);
    const sectionNavigation = within(
      view.getByRole("group", { name: m.accountSectionLabel({}, en) })
    );

    expect(view.getByText(m.accountTitle({}, en))).toBeTruthy();
    expect(
      sectionNavigation.getByRole("link", {
        name: new RegExp(`^${m.accountSectionReservations({}, en)}`),
      })
    ).toBeTruthy();
    expect(view.getByText(m.accountDeletionButton({}, en))).toBeTruthy();
    expect(view.getByText(m.accountSignOut({}, en))).toBeTruthy();
    expect(view.container.querySelectorAll("main")).toHaveLength(1);

    fireEvent.click(
      sectionNavigation.getByRole("link", {
        name: m.accountSectionProfile({}, en),
      })
    );
    expect(view.getByText(m.accountProfileSave({}, en))).toBeTruthy();
    expect(view.getByText("Ada Lovelace")).toBeTruthy();
    expect(view.getByText(adaAddress)).toBeTruthy();

    fireEvent.click(
      sectionNavigation.getByRole("link", {
        name: m.accountSectionBilling({}, en),
      })
    );
    expect(view.getByText(m.accountBillingDetailsTitle({}, en))).toBeTruthy();
    expect(view.getByText(m.accountProfileSave({}, en))).toBeTruthy();
  });

  test("submits the remembered referral code with completion and shows its outcome after the refresh", async () => {
    completeCustomerProfile.mockImplementationOnce(() =>
      Promise.resolve({
        data: { status: "completed", referral: { status: "applied" } },
      } as never)
    );
    const referralCode = parseReferralCode("RFL12345");
    if (referralCode === undefined) throw new Error("invalid referral code");
    let refreshLinkedAccount!: () => void;
    function ProfileCompletionRefreshJourney() {
      const [state, setState] = useState<CustomerAccountPageState>({
        kind: "completion-required",
        referralsEnabled: true,
        email: adaAddress,
        referralCode,
      });
      refreshLinkedAccount = () =>
        setState({ ...linkedState, signupReferral: { status: "applied" } });

      return (
        <AccountLayoutShell locale="en-US" signedIn>
          <AccountPage locale="en-US" state={state} />
        </AccountLayoutShell>
      );
    }

    const { AccountLayoutShell } = await import("./account-layout-shell");
    const { AccountPage } = await import("./account-page");
    workspaceRouterRefresh.mockImplementation(() => refreshLinkedAccount());
    const view = render(<ProfileCompletionRefreshJourney />);
    const field = view.container.querySelector(
      "#profile-referral-code"
    ) as HTMLInputElement;
    expect(field.value).toBe("RFL12345");

    fireEvent.change(
      view.getByLabelText(m.accountProfileFirstNameLabel({}, en)),
      { target: { value: "Ada" } }
    );
    await act(async () => {
      fireEvent.submit(view.container.querySelector("#account-profile-form")!);
    });

    await waitFor(() => {
      expect(completeCustomerProfile).toHaveBeenCalledWith({
        firstName: "Ada",
        referralCode: "RFL12345",
        prefilledReferralCode: "RFL12345",
      });
      expect(workspaceRouterRefresh).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(
        view.container.querySelector('[data-screen="referrals-screen"]')
      ).toBeTruthy();
    });
    expect(
      view.getByText(
        m.accountProfileReferralApplied(
          { discount: formatReferralInvitationDiscount(en.locale) },
          en
        )
      )
    ).toBeTruthy();
    expect(view.container.querySelector("#profile-referral-code")).toBeNull();
    expect(view.queryByRole("button", { name: /accept/i })).toBeNull();
  });

  test("supersedes pending completion feedback when the refresh settles the stored code", async () => {
    completeCustomerProfile.mockImplementationOnce(() =>
      Promise.resolve({
        data: { status: "completed", referral: { status: "pending" } },
      } as never)
    );
    let refreshLinkedAccount!: () => void;
    function PendingCompletionJourney() {
      const [state, setState] = useState<CustomerAccountPageState>({
        kind: "completion-required",
        referralsEnabled: true,
        email: adaAddress,
      });
      refreshLinkedAccount = () =>
        setState((current) =>
          current.kind === "linked"
            ? linkedState
            : { ...linkedState, signupReferral: { status: "applied" } }
        );

      return (
        <AccountLayoutShell locale="en-US" signedIn>
          <AccountPage locale="en-US" state={state} />
        </AccountLayoutShell>
      );
    }

    const { AccountLayoutShell } = await import("./account-layout-shell");
    const { AccountPage } = await import("./account-page");
    workspaceRouterRefresh.mockImplementation(() => refreshLinkedAccount());
    const view = render(<PendingCompletionJourney />);
    fireEvent.change(
      view.getByLabelText(m.accountProfileFirstNameLabel({}, en)),
      { target: { value: "Ada" } }
    );
    fireEvent.change(view.container.querySelector("#profile-referral-code")!, {
      target: { value: "RFLTYPED1" },
    });
    await act(async () => {
      fireEvent.submit(view.container.querySelector("#account-profile-form")!);
    });

    await waitFor(() => {
      expect(
        view.container.querySelector('[data-screen="referrals-screen"]')
      ).toBeTruthy();
    });
    expect(
      view.getByText(
        m.accountProfileReferralApplied(
          { discount: formatReferralInvitationDiscount(en.locale) },
          en
        )
      )
    ).toBeTruthy();
    expect(
      view.queryByText(m.accountProfileReferralPending({}, en))
    ).toBeNull();

    // A later refresh with no stored outcome (it was acknowledged) never
    // brings back the completion's pending feedback.
    await act(async () => {
      refreshLinkedAccount();
    });
    expect(
      view.queryByText(m.accountProfileReferralPending({}, en))
    ).toBeNull();
    expect(view.getByRole("status").textContent).toBe("");
  });

  test.each([
    [
      "applied",
      { status: "applied" },
      () =>
        m.accountProfileReferralApplied(
          { discount: formatReferralInvitationDiscount(en.locale) },
          en
        ),
    ],
    [
      "rejected",
      { status: "not-applied", reason: "not-eligible" },
      () => m.accountProfileReferralNotEligible({}, en),
    ],
  ] as const)(
    "shows a stored code settled as %s from server state, and nothing once acknowledged",
    async (_name, signupReferral, message) => {
      const settlingVisit = await renderState({
        ...linkedState,
        signupReferral,
      });
      expect(settlingVisit.getByText(message())).toBeTruthy();
      settlingVisit.unmount();

      const freshVisit = await renderState(linkedState);
      expect(freshVisit.queryByText(message())).toBeNull();
      expect(freshVisit.getByRole("status").textContent).toBe("");
    }
  );

  test("forgets the remembered referral code only on a linked visit that used it", async () => {
    const { referralCodeCookieName } = await import(
      "@/features/referrals/referral-code-cookie"
    );
    const rememberedCookie = `${referralCodeCookieName}=RFL12345`;
    const originalUrl = window.location.href;
    window.happyDOM.setURL("https://deskohub.test/en-US/account");
    try {
      // biome-ignore lint/suspicious/noDocumentCookie: The browser test needs to remember a code synchronously.
      document.cookie = `${rememberedCookie}; Path=/`;

      const openVisit = await renderState(linkedState);
      await act(async () => undefined);
      expect(document.cookie).toContain(rememberedCookie);
      openVisit.unmount();

      await renderState({ ...linkedState, rememberedReferralCodeUsed: true });
      await act(async () => undefined);
      expect(document.cookie).not.toContain(referralCodeCookieName);
    } finally {
      // biome-ignore lint/suspicious/noDocumentCookie: The browser test needs to clear the code synchronously.
      document.cookie = `${referralCodeCookieName}=; Path=/; Max-Age=0`;
      window.happyDOM.setURL(originalUrl);
    }
  });

  test.each([
    [
      "applied",
      { status: "applied" },
      () =>
        m.accountProfileReferralApplied(
          { discount: formatReferralInvitationDiscount(en.locale) },
          en
        ),
    ],
    [
      "rejected",
      { status: "not-applied", reason: "not-eligible" },
      () => m.accountProfileReferralNotEligible({}, en),
    ],
  ] as const)(
    "never revives pending feedback on a mounted notice after the code settles as %s",
    async (_name, settled, message) => {
      const { AccountLayoutShell } = await import("./account-layout-shell");
      const { AccountPage } = await import("./account-page");
      const page = (state: CustomerAccountPageState) => (
        <AccountLayoutShell locale="en-US" signedIn>
          <AccountPage locale="en-US" state={state} />
        </AccountLayoutShell>
      );
      const pendingMessage = m.accountProfileReferralPending({}, en);
      const view = render(
        page({ ...linkedState, signupReferral: { status: "pending" } })
      );
      expect(view.getByText(pendingMessage)).toBeTruthy();
      expect(
        view.queryByRole("button", {
          name: m.accountProfileReferralNoticeDismiss({}, en),
        })
      ).toBeNull();

      view.rerender(page({ ...linkedState, signupReferral: settled }));
      expect(view.getByText(message())).toBeTruthy();

      // A later refresh, such as after an avatar change, still loads the
      // stored outcome.
      view.rerender(page({ ...linkedState, signupReferral: settled }));
      expect(view.getByText(message())).toBeTruthy();
      expect(view.queryByText(pendingMessage)).toBeNull();

      // Once acknowledged, a refresh carries no outcome and nothing returns.
      view.rerender(page(linkedState));
      expect(view.queryByText(message())).toBeNull();
      expect(view.queryByText(pendingMessage)).toBeNull();
    }
  );

  test("dismisses a settled outcome through the account and reloads its state", async () => {
    acknowledgeSignupReferralNotice.mockClear();
    workspaceRouterRefresh.mockClear();
    const view = await renderState({
      ...linkedState,
      signupReferral: { status: "not-applied", reason: "already-referred" },
    });

    await act(async () => {
      fireEvent.click(
        view.getByRole("button", {
          name: m.accountProfileReferralNoticeDismiss({}, en),
        })
      );
    });

    await waitFor(() => {
      expect(acknowledgeSignupReferralNotice).toHaveBeenCalledWith({});
      expect(workspaceRouterRefresh).toHaveBeenCalledTimes(1);
    });
  });

  test("offers no completion referral field while the program is withheld", async () => {
    const view = await renderState({
      kind: "completion-required",
      referralsEnabled: false,
      email: adaAddress,
    });

    expect(
      view.getByRole("heading", {
        level: 2,
        name: m.accountCompletionTitle({}, en),
      })
    ).toBeTruthy();
    expect(view.container.querySelector("#profile-referral-code")).toBeNull();
    expect(
      view.queryByText(m.accountProfileReferralCodeLabel({}, en))
    ).toBeNull();
  });

  test("renders the support state with the contact destination and no profile data", async () => {
    const view = await renderState({
      kind: "support-required",
      email: adaAddress,
    });

    expect(
      view.getByRole("heading", {
        level: 2,
        name: m.accountSupportTitle({}, en),
      })
    ).toBeTruthy();
    expect(
      view
        .getAllByRole("link")
        .some((link) => link.getAttribute("href") === "/en-US/contact")
    ).toBe(true);
    expect(view.queryByText(m.accountProfileSave({}, en))).toBeNull();
    await act(async () => {
      fireEvent.click(
        view.getByRole("button", { name: m.accountDeletionButton({}, en) })
      );
    });
    expect(
      view.getByRole("button", { name: m.accountDeletionConfirm({}, en) })
    ).toBeTruthy();
  });

  test("renders the pending deletion state with retry and sign out", async () => {
    const view = await renderState({
      kind: "deletion-pending",
      email: adaAddress,
    });

    expect(view.getByText(m.accountDeletionPendingTitle({}, en))).toBeTruthy();
    expect(view.getByText(m.accountDeletionConfirm({}, en))).toBeTruthy();
    expect(view.getByText(m.accountSignOut({}, en))).toBeTruthy();
  });

  test("redirects unauthenticated visitors without loading account data", async () => {
    const originalReplace = window.location.replace;
    const documentNavigations: string[] = [];
    window.location.replace = ((href: string) => {
      documentNavigations.push(href);
    }) as typeof window.location.replace;
    const view = await renderState({ kind: "unauthenticated" }).finally(() => {
      window.location.replace = originalReplace;
    });

    expect(
      view.getByRole("status", { name: m.accountSignInLoading({}, en) })
    ).toBeTruthy();
    // A document navigation loads the sign-in page, not its modal.
    expect(documentNavigations).toEqual(["/en-US/auth/sign-in"]);
    expect(workspaceRouterReplace).not.toHaveBeenCalled();
    expect(refreshAnalyticsAccountIdentity).not.toHaveBeenCalled();
    expect(view.queryByText(m.accountTitle({}, en))).toBeNull();
    expect(view.queryByText(m.accountSectionReservations({}, en))).toBeNull();
    expect(getSession).not.toHaveBeenCalled();
    expect(view.queryByText(m.accountDeletionButton({}, en))).toBeNull();
    expect(
      view.queryByLabelText(m.accountProfileScreenVerifiedEmail({}, en))
    ).toBeNull();
    expect(view.container.textContent).not.toContain(adaAddress);
  });

  test("renders the authenticated unavailable state with account controls", async () => {
    const view = await renderState({
      kind: "authenticated-unavailable",
      email: adaAddress,
    });

    expect(view.getByText(m.accountTitle({}, en))).toBeTruthy();
    expect(view.getByText(m.accountSignOut({}, en))).toBeTruthy();
    expect(view.getByText(m.accountDeletionButton({}, en))).toBeTruthy();
    expect(view.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(
      view.getByRole("heading", {
        level: 2,
        name: m.accountUnavailableTitle({}, en),
      })
    ).toBeTruthy();
  });

  test("manages passkeys under Sign-in & security while the profile is unavailable", async () => {
    const view = await renderState({
      kind: "authenticated-unavailable",
      email: adaAddress,
      passkeys: {
        accountId: "account-1",
        passkeys: [
          {
            id: "passkey-1",
            name: "Work laptop",
            provider: undefined,
            createdAt: "2026-10-14T16:40:00.000Z",
          },
        ],
      },
    });
    const unavailableTitle = view.getByText(m.accountUnavailableTitle({}, en));
    expect(unavailableTitle.closest("[hidden]")).toBeNull();

    fireEvent.click(
      within(
        view.getByRole("group", { name: m.accountSectionLabel({}, en) })
      ).getByRole("link", { name: m.accountSectionSecurity({}, en) })
    );

    const list = view.getByRole("list", {
      name: m.accountSecurityPasskeysTitle({}, en),
    });
    expect(within(list).getByText("Work laptop")).toBeTruthy();
    expect(
      view.getByText(m.accountSecurityPasskeysAdd({}, en)).closest("[hidden]")
    ).toBeNull();
    expect(unavailableTitle.closest("[hidden]")).not.toBeNull();
  });

  const openSection = (
    view: Awaited<ReturnType<typeof renderState>>,
    locale: "en-US" | "cs-CZ",
    name: string
  ) =>
    fireEvent.click(
      within(
        view.getByRole("group", {
          name: m.accountSectionLabel({}, { locale }),
        })
      ).getByRole("link", { name })
    );

  test("lists connected assistants while the profile needs completion", async () => {
    const cs = { locale: "cs-CZ" } as const;
    const view = await renderState(
      {
        kind: "completion-required",
        email: adaAddress,
        referralsEnabled: false,
        assistants: [
          {
            id: "consent-1",
            name: "Synthetic Assistant",
            host: "assistant.invalid",
            scopes: ["reservations:read"],
            administration: false,
            connectedAt: "2026-10-14T16:40:00.000Z",
          },
        ],
      },
      "cs-CZ"
    );
    const completion = view.container.querySelector(
      "#account-completion-required"
    );
    expect(completion).toBeTruthy();
    expect(completion?.closest("[hidden]")).toBeNull();

    openSection(view, "cs-CZ", m.accountSectionAssistants({}, cs));

    const list = view.container.querySelector<HTMLElement>(
      "ul[aria-labelledby='account-assistants-title']"
    );
    expect(list).toBeTruthy();
    expect(within(list!).getByText("Synthetic Assistant")).toBeTruthy();
    expect(list?.closest("[hidden]")).toBeNull();
    expect(within(list!).getByRole("button")).toBeTruthy();
    expect(completion?.closest("[hidden]")).not.toBeNull();
  });

  test("shows no connected assistants while the profile is unavailable", async () => {
    const view = await renderState({
      kind: "authenticated-unavailable",
      email: adaAddress,
      assistants: [],
    });

    openSection(view, "en-US", m.accountSectionAssistants({}, en));

    const empty = view.container.querySelector("#account-assistants-empty");
    expect(empty).toBeTruthy();
    expect(empty?.closest("[hidden]")).toBeNull();
    const unavailable = view.container.querySelector(
      "#account-profile-unavailable"
    );
    expect(unavailable).toBeTruthy();
    expect(unavailable?.closest("[hidden]")).not.toBeNull();
  });

  test("lists connected assistants for a linked account", async () => {
    const view = await renderState({
      ...linkedState,
      assistants: [],
    });

    openSection(view, "en-US", m.accountSectionAssistants({}, en));

    const empty = view.container.querySelector("#account-assistants-empty");
    expect(empty).toBeTruthy();
    expect(empty?.closest("[hidden]")).toBeNull();
  });

  const withEmailSignInOnCapableBrowser = async () => {
    Object.defineProperty(globalThis, "PublicKeyCredential", {
      configurable: true,
      value: {
        getClientCapabilities: async () => ({
          passkeyPlatformAuthenticator: true,
        }),
      },
    });
    const { noteEmailSignInForPasskeyPrompt } = await import(
      "@/features/account/passkey-prompt"
    );
    noteEmailSignInForPasskeyPrompt();
  };

  const withoutPasskeyBrowser = () => {
    Reflect.deleteProperty(globalThis, "PublicKeyCredential");
    window.sessionStorage.clear();
    window.localStorage.clear();
  };

  test("offers a passkey after an email sign-in while the profile is unavailable", async () => {
    await withEmailSignInOnCapableBrowser();
    try {
      const view = await renderState({
        kind: "authenticated-unavailable",
        email: adaAddress,
        passkeys: { accountId: "account-1", passkeys: [] },
      });

      await waitFor(() =>
        expect(
          view.getByRole("dialog", {
            name: m.accountPasskeyPromptTitle({}, en),
          })
        ).toBeTruthy()
      );
    } finally {
      withoutPasskeyBrowser();
    }
  });

  test("keeps Sign-in & security out of an account pending deletion", async () => {
    await withEmailSignInOnCapableBrowser();
    const view = await renderState({
      kind: "deletion-pending",
      email: adaAddress,
      passkeys: { accountId: "account-1", passkeys: [] },
    });

    fireEvent.click(
      within(
        view.getByRole("group", { name: m.accountSectionLabel({}, en) })
      ).getByRole("link", { name: m.accountSectionSecurity({}, en) })
    );

    expect(view.queryByText(m.accountSecurityPasskeysTitle({}, en))).toBeNull();
    expect(
      view.getByText(m.accountDeletionPendingTitle({}, en)).closest("[hidden]")
    ).toBeNull();
    await flushWorkspaceComponentWork();
    expect(view.queryByText(m.accountPasskeyPromptTitle({}, en))).toBeNull();
    withoutPasskeyBrowser();
  });

  test("asks the account identity adapter to refresh once per authenticated view", async () => {
    await renderState(linkedState);
    expect(refreshAnalyticsAccountIdentity).toHaveBeenCalledTimes(1);

    await renderState({ kind: "unavailable" });
    expect(refreshAnalyticsAccountIdentity).toHaveBeenCalledTimes(1);
  });
});
