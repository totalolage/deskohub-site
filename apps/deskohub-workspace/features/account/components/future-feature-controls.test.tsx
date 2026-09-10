import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { type ComponentPropsWithoutRef, useState } from "react";
import { type Locale, m } from "@/features/i18n";
import {
  registerWorkspaceComponentTestEnv,
  unregisterWorkspaceComponentTestEnv,
} from "@/shared/testing/workspace-component-test-env";
import type {
  CustomerReservationHistory,
  CustomerReservationSummary,
} from "../contracts";
import type { BillingScreenCopy } from "./billing/billing-screen";
import type { LegalScreenStrings } from "./legal/legal-screen";
import type { ProfileScreenCopy } from "./profile/profile-screen";
import type { ReservationHistoryCopy } from "./reservation-history";

type NavigateEvent = {
  readonly preventDefault: () => void;
};

type MockNextLinkProps = ComponentPropsWithoutRef<"a"> & {
  readonly href: string;
  readonly onNavigate?: (event: NavigateEvent) => void;
  readonly prefetch?: boolean | "auto" | null;
};

function MockNextLink({
  children,
  href,
  onNavigate: _onNavigate,
  prefetch: _prefetch,
  ...props
}: MockNextLinkProps) {
  return (
    <a href={href} {...props}>
      {children}
    </a>
  );
}

mock.module("next/link", () => ({ default: MockNextLink }));

const routerRefresh = mock(() => undefined);
mock.module("next/navigation", () => ({
  useRouter: () => ({ refresh: routerRefresh }),
}));

type ActionResult = {
  readonly data?: { readonly status?: string };
  readonly serverError?: string;
  readonly validationErrors?: unknown;
};
type ActionInput = object;

const completeCustomerProfile = mock(
  (): Promise<ActionResult> =>
    Promise.resolve({ data: { status: "completed" } })
);
const updateCustomerProfile = mock(
  (): Promise<ActionResult> => Promise.resolve({ data: { status: "updated" } })
);
const deleteCustomerAccount = mock(
  (): Promise<ActionResult> => Promise.resolve({ data: { status: "deleted" } })
);

mock.module("@/features/account/actions", () => ({
  completeCustomerProfile,
  deleteCustomerAccount,
  updateCustomerProfile,
}));

const signInMagicLink = mock(() => Promise.resolve({ error: null }));
const signOut = mock(() => Promise.resolve({ error: null }));

mock.module("@/features/account/auth.client", () => ({
  authClient: {
    getSession: () => Promise.resolve({ data: null, error: null }),
    signIn: { magicLink: signInMagicLink },
    signOut,
  },
}));

mock.module("@/shared/utils/use-workspace-action", () => ({
  useWorkspaceAction: (
    action: (input: ActionInput) => Promise<ActionResult>,
    options?: {
      readonly onSuccess?: (args: { readonly data?: unknown }) => void;
    }
  ) => {
    const [result, setResult] = useState<ActionResult>({});
    const [isExecuting, setIsExecuting] = useState(false);

    const execute = (input: ActionInput) => {
      setIsExecuting(true);
      void action(input).then((nextResult) => {
        setResult(nextResult);
        setIsExecuting(false);
        options?.onSuccess?.({ data: nextResult.data });
      });
    };

    return {
      execute,
      isExecuting,
      reset: () => setResult({}),
      result,
    };
  },
}));

const profileCopy = {
  "en-US": {
    avatarUnavailableDescription: "Profile photos are not available here.",
    avatarUnavailableLabel: "Profile photo unavailable",
    emailDescription: "This verified address cannot be changed here.",
    emailLabel: "Email address",
    languageLabel: "Preferred communication language",
    languageUnavailableDescription: "Language preferences are not saved yet.",
    languageUnavailableValue: "Not set",
    memberFallback: "Workspace member",
    title: "Member profile and settings",
    verifiedEmail: "Verified login email",
  },
  "cs-CZ": {
    avatarUnavailableDescription: "Profilové fotografie nejsou k dispozici.",
    avatarUnavailableLabel: "Profilová fotografie není k dispozici",
    emailDescription: "Tuto ověřenou adresu zde nelze změnit.",
    emailLabel: "E-mailová adresa",
    languageLabel: "Preferovaný komunikační jazyk",
    languageUnavailableDescription: "Preference jazyka se zatím neukládají.",
    languageUnavailableValue: "Nenastaveno",
    memberFallback: "Člen Workspace",
    title: "Profil a nastavení",
    verifiedEmail: "Ověřený přihlašovací e-mail",
  },
} satisfies Record<Locale, ProfileScreenCopy>;

const billingCopy = {
  "en-US": {
    addPaymentCard: "Add payment card",
    aresUnavailable: "ARES Registry sync is not available in this account.",
    billingDetailsTitle: "Billing details",
    currency: "Currency: CZK (Kč)",
    downloadInvoice: "Download PDF",
    exportInvoices: "Export all",
    invoiceHistoryTitle: "Invoice history",
    invoiceHistoryUnavailable:
      "Invoice history and downloads are not available in this account.",
    paymentMethodsTitle: "Saved payment methods",
    paymentMethodsUnavailable:
      "Saved payment methods are not available in this account.",
    removePaymentCard: "Remove payment card",
    syncAres: "Sync with ARES Registry",
    title: "Billing & invoices",
  },
  "cs-CZ": {
    addPaymentCard: "Přidat platební kartu",
    aresUnavailable:
      "Synchronizace s registrem ARES není pro tento účet dostupná.",
    billingDetailsTitle: "Fakturační údaje",
    currency: "Měna: CZK (Kč)",
    downloadInvoice: "Stáhnout PDF",
    exportInvoices: "Exportovat vše",
    invoiceHistoryTitle: "Historie faktur",
    invoiceHistoryUnavailable:
      "Historie faktur a jejich stahování nejsou pro tento účet dostupné.",
    paymentMethodsTitle: "Uložené platební metody",
    paymentMethodsUnavailable:
      "Uložené platební metody nejsou pro tento účet dostupné.",
    removePaymentCard: "Odebrat platební kartu",
    syncAres: "Synchronizovat s registrem ARES",
    title: "Fakturace a faktury",
  },
} satisfies Record<Locale, BillingScreenCopy>;

const legalCopy = {
  "en-US": {
    analyticsDescription:
      "Analytics preferences cannot be viewed or changed from your account.",
    analyticsTitle: "Web & usage analytics",
    archiveAction: "Request GDPR data archive",
    archiveDescription:
      "Requesting or downloading a personal data archive is not available in your account.",
    archiveTitle: "Your personal data archive",
    marketingDescription:
      "Communications consent cannot be viewed or changed from your account.",
    marketingTitle: "Marketing & community communications",
    preferencesUnavailable:
      "Account consent settings are not available here. Use cookie settings to manage this browser's cookies.",
    savePreferences: "Save consent preferences",
    title: "Legal, privacy & GDPR consents",
    unavailable: "Unavailable",
  },
  "cs-CZ": {
    analyticsDescription:
      "Nastavení analytiky nelze v účtu zobrazit ani změnit.",
    analyticsTitle: "Analytika webu a používání",
    archiveAction: "Požádat o archiv osobních údajů",
    archiveDescription:
      "Žádost o archiv osobních údajů ani jeho stažení nejsou v účtu dostupné.",
    archiveTitle: "Archiv vašich osobních údajů",
    marketingDescription:
      "Souhlas se zasíláním sdělení nelze v účtu zobrazit ani změnit.",
    marketingTitle: "Marketingová a komunitní sdělení",
    preferencesUnavailable:
      "Nastavení souhlasů v účtu zde není dostupné. Soubory cookie tohoto prohlížeče můžete spravovat v nastavení cookies.",
    savePreferences: "Uložit nastavení souhlasů",
    title: "Právní informace, soukromí a souhlasy GDPR",
    unavailable: "Nedostupné",
  },
} satisfies Record<Locale, LegalScreenStrings>;

const reservationCopy = {
  "en-US": {
    assignedDesk: "Assigned desk",
    checkIn: "Check in",
    date: "Date",
    moreCurrent: "More current and upcoming reservations",
    nfcAccess: "NFC access",
    product: "Product",
    seats: "Seats",
    showPinCode: "Show PIN code",
    status: "Status",
    unavailable: "Unavailable",
    unsupportedDescription: "Not available in your account yet.",
    validity: "Validity",
    viewReservation: "View reservation",
    wifi: "Wi-Fi",
  },
  "cs-CZ": {
    assignedDesk: "Přiřazené místo",
    checkIn: "Odbavit se",
    date: "Datum",
    moreCurrent: "Další aktuální a nadcházející rezervace",
    nfcAccess: "NFC přístup",
    product: "Produkt",
    seats: "Místa",
    showPinCode: "Zobrazit PIN kód",
    status: "Stav",
    unavailable: "Nedostupné",
    unsupportedDescription: "Ve vašem účtu zatím není k dispozici.",
    validity: "Platnost",
    viewReservation: "Zobrazit rezervaci",
    wifi: "Wi-Fi",
  },
} satisfies Record<Locale, ReservationHistoryCopy>;

const accountScreenCopy = {
  billing: billingCopy["en-US"],
  dangerTitle: "Danger zone",
  legal: legalCopy["en-US"],
  profile: profileCopy["en-US"],
  reservations: reservationCopy["en-US"],
  shell: {
    mobileSection: "Account section",
    navigation: "Account navigation",
    sections: {
      billing: "Billing & invoices",
      danger: "Danger zone",
      legal: "Legal & privacy",
      profile: "Profile & identity",
      reservations: "Reservations",
    },
  },
};

mock.module("@/features/account/components/account-screen-copy", () => ({
  getAccountScreenCopy: () => accountScreenCopy,
}));

registerWorkspaceComponentTestEnv();

const { AccountLoading } = await import("./account-loading");
const { BillingScreen } = await import("./billing/billing-screen");
const { DeleteAccountCard } = await import("./delete-account-card");
const { LegalScreen } = await import("./legal/legal-screen");
const { ProfileForm } = await import("./profile-form");
const { ProfileScreen } = await import("./profile/profile-screen");
const { ReservationHistory } = await import("./reservation-history");
const { SignInCard } = await import("./sign-in-card");
const { SignInLoading } = await import("./sign-in-loading");
const { SignOutButton } = await import("./sign-out-button");

afterEach(() => {
  cleanup();
  completeCustomerProfile.mockClear();
  deleteCustomerAccount.mockClear();
  routerRefresh.mockClear();
  signInMagicLink.mockClear();
  signOut.mockClear();
  updateCustomerProfile.mockClear();
});

afterAll(unregisterWorkspaceComponentTestEnv);

const profileFields = (
  <>
    <div>
      <label htmlFor="future-feature-first-name">First name</label>
      <input id="future-feature-first-name" name="firstName" required />
    </div>
    <div>
      <label htmlFor="future-feature-last-name">Last name</label>
      <input id="future-feature-last-name" name="lastName" />
    </div>
  </>
);

const reservation = (
  overrides: Partial<CustomerReservationSummary>
): CustomerReservationSummary => ({
  endsAt: null,
  id: "future-feature-reservation",
  product: { kind: "other" },
  seats: null,
  startsAt: null,
  status: "confirmed",
  ...overrides,
});

const futureFeatureHistory: CustomerReservationHistory = {
  kind: "available",
  groups: {
    current: [reservation({})],
    past: [],
    unavailable: [],
  },
};

type ScreenView = ReturnType<typeof render>;

function renderProfileScreen(locale: Locale): ScreenView {
  return render(
    <ProfileScreen
      copy={profileCopy[locale]}
      email="ada@example.test"
      firstName="Ada"
      lastName="Lovelace"
      locale={locale}
    >
      {profileFields}
    </ProfileScreen>
  );
}

function renderBillingScreen(locale: Locale): ScreenView {
  return render(
    <BillingScreen copy={billingCopy[locale]} locale={locale}>
      <div>Caller-owned billing fields</div>
    </BillingScreen>
  );
}

function renderLegalScreen(locale: Locale): ScreenView {
  return render(<LegalScreen locale={locale} strings={legalCopy[locale]} />);
}

function renderReservationHistory(locale: Locale): ScreenView {
  return render(
    <ReservationHistory
      copy={reservationCopy[locale]}
      history={futureFeatureHistory}
      locale={locale}
    />
  );
}

function futureFeatureMessage(locale: Locale) {
  return m.account_future_feature_tooltip({}, { locale });
}

async function expectFutureTooltip(
  view: ScreenView,
  label: string,
  locale: Locale,
  controlIndex = 0
) {
  const controls = view.getAllByRole("button", { name: label });
  const control = controls[controlIndex];
  if (!control) {
    throw new Error(
      `No future-feature control at index ${controlIndex} for ${label}`
    );
  }
  expect(control.tagName).toBe("BUTTON");
  expect((control as HTMLButtonElement).disabled).toBe(true);

  const wrapper = control.closest<HTMLElement>('[tabindex="0"]');
  if (!wrapper) throw new Error(`No future-feature wrapper for ${label}`);
  expect(wrapper.tabIndex).toBe(0);
  expect(view.getAllByRole("group", { name: label })).toContain(wrapper);

  await act(async () => {
    wrapper.focus();
  });
  expect(document.activeElement).toBe(wrapper);
  const tooltipMessage = futureFeatureMessage(locale);
  expect((await view.findByRole("tooltip")).textContent).toContain(
    tooltipMessage
  );
  expect(view.getByRole("group", { description: tooltipMessage })).toBe(
    wrapper
  );
}

function expectNoFutureTooltipWrapper(control: Element) {
  expect(control.closest("[tabindex='0']")).toBeNull();
}

type FutureFeatureTarget = {
  readonly controlIndex?: number;
  readonly label: (locale: Locale) => string;
  readonly name: string;
  readonly render: (locale: Locale) => ScreenView;
};

const futureFeatureTargets: readonly FutureFeatureTarget[] = [
  {
    label: (locale) => profileCopy[locale].avatarUnavailableLabel,
    name: "profile avatar",
    render: renderProfileScreen,
  },
  {
    label: (locale) => billingCopy[locale].syncAres,
    name: "ARES control",
    render: renderBillingScreen,
  },
  {
    label: (locale) => billingCopy[locale].addPaymentCard,
    name: "add payment card control",
    render: renderBillingScreen,
  },
  {
    label: (locale) => billingCopy[locale].removePaymentCard,
    name: "remove payment card control",
    render: renderBillingScreen,
  },
  {
    label: (locale) => billingCopy[locale].downloadInvoice,
    name: "download invoice control",
    render: renderBillingScreen,
  },
  {
    label: (locale) => billingCopy[locale].exportInvoices,
    name: "export invoices control",
    render: renderBillingScreen,
  },
  {
    label: (locale) => reservationCopy[locale].checkIn,
    name: "check-in control",
    render: renderReservationHistory,
  },
  {
    label: (locale) => reservationCopy[locale].nfcAccess,
    name: "NFC control",
    render: renderReservationHistory,
  },
  {
    label: (locale) => legalCopy[locale].archiveAction,
    name: "GDPR archive control",
    render: renderLegalScreen,
  },
  {
    controlIndex: 0,
    label: (locale) => legalCopy[locale].unavailable,
    name: "analytics preferences control",
    render: renderLegalScreen,
  },
  {
    controlIndex: 1,
    label: (locale) => legalCopy[locale].unavailable,
    name: "marketing preferences control",
    render: renderLegalScreen,
  },
  {
    label: (locale) => legalCopy[locale].savePreferences,
    name: "save consent preferences control",
    render: renderLegalScreen,
  },
];

describe("account future-feature controls", () => {
  test("keeps the future-feature inventory at twelve controls", () => {
    expect(futureFeatureTargets).toHaveLength(12);
  });

  for (const target of futureFeatureTargets) {
    test.each(["en-US", "cs-CZ"] as const)(
      `${target.name} opens its localized message in %s`,
      async (locale) => {
        const view = target.render(locale);
        await expectFutureTooltip(
          view,
          target.label(locale),
          locale,
          target.controlIndex
        );
      }
    );
  }

  test("does not wrap the known reservation PIN control", () => {
    const view = renderReservationHistory("en-US");
    const pinButton = view.getByRole("button", {
      name: reservationCopy["en-US"].showPinCode,
    });

    expect((pinButton as HTMLButtonElement).disabled).toBe(true);
    expectNoFutureTooltipWrapper(pinButton);
  });

  test("does not wrap runtime-disabled, loading, auth, or confirmation controls", async () => {
    let resolveProfileUpdate!: (result: ActionResult) => void;
    const pendingProfileUpdate = new Promise<ActionResult>((resolve) => {
      resolveProfileUpdate = resolve;
    });
    updateCustomerProfile.mockImplementationOnce(() => pendingProfileUpdate);

    const profileView = render(
      <ProfileForm
        email="ada@example.test"
        locale="en-US"
        mode="edit"
        profile={{
          billing: null,
          firstName: "Ada",
          lastName: "Lovelace",
          phone: null,
        }}
      />
    );
    await act(async () => {
      fireEvent.input(profileView.getByLabelText("First name"), {
        target: { value: "Grace" },
      });
      fireEvent.submit(
        profileView.container.querySelector("#account-profile-form")!
      );
      await Promise.resolve();
    });

    const saveButton = profileView.container.querySelector(
      "#account-profile-submit"
    );
    if (!saveButton) throw new Error("Profile save button was not rendered");
    expect((saveButton as HTMLButtonElement).disabled).toBe(true);
    expectNoFutureTooltipWrapper(saveButton);
    profileView.unmount();
    resolveProfileUpdate({ data: { status: "updated" } });

    const loadingViews = [
      render(<AccountLoading locale="en-US" />),
      render(<SignInLoading locale="en-US" />),
    ];
    for (const view of loadingViews) {
      expect(view.container.querySelectorAll("[tabindex='0']")).toHaveLength(0);
      expect(view.container.querySelectorAll("button")).toHaveLength(0);
      view.unmount();
    }

    let resolveMagicLink!: (result: { readonly error: null }) => void;
    const pendingMagicLink = new Promise<{ readonly error: null }>(
      (resolve) => {
        resolveMagicLink = resolve;
      }
    );
    signInMagicLink.mockImplementationOnce(() => pendingMagicLink);
    const signInView = render(<SignInCard locale="en-US" />);
    fireEvent.change(signInView.getByLabelText("Email"), {
      target: { value: "ada@example.test" },
    });
    await act(async () => {
      fireEvent.submit(
        signInView.container.querySelector("#account-sign-in-form")!
      );
      await Promise.resolve();
    });
    const signInButton = signInView.getByRole("button", { name: "Sending…" });
    expect((signInButton as HTMLButtonElement).disabled).toBe(true);
    expectNoFutureTooltipWrapper(signInButton);
    signInView.unmount();
    resolveMagicLink({ error: null });

    let resolveSignOut!: (result: { readonly error: null }) => void;
    const pendingSignOut = new Promise<{ readonly error: null }>((resolve) => {
      resolveSignOut = resolve;
    });
    signOut.mockImplementationOnce(() => pendingSignOut);
    const signOutView = render(<SignOutButton locale="en-US" />);
    await act(async () => {
      fireEvent.click(signOutView.getByRole("button", { name: "Sign out" }));
      await Promise.resolve();
    });
    const signOutButton = signOutView.getByRole("button", { name: "Sign out" });
    expect((signOutButton as HTMLButtonElement).disabled).toBe(true);
    expectNoFutureTooltipWrapper(signOutButton);
    signOutView.unmount();
    resolveSignOut({ error: null });

    const deletionView = render(
      <DeleteAccountCard
        deletionPending={false}
        email="ada@example.test"
        locale="en-US"
      />
    );
    await act(async () => {
      fireEvent.click(
        deletionView.getByRole("button", {
          name: m.accountDeletionButton({}, { locale: "en-US" }),
        })
      );
    });
    const confirmationButton = deletionView.baseElement.querySelector(
      "#delete-account-confirm"
    );
    if (!confirmationButton) {
      throw new Error("Delete confirmation button was not rendered");
    }
    expect((confirmationButton as HTMLButtonElement).disabled).toBe(true);
    expectNoFutureTooltipWrapper(confirmationButton);
  });
});
