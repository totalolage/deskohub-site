"use client";

import Interpolate from "@doist/react-interpolate";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { getAccountScreenCopy } from "@/features/account/components/account-screen-copy";
import {
  type AccountNavigationBadge,
  type AccountSection,
  AccountShell,
} from "@/features/account/components/shell/account-shell";
import { SignOutButton } from "@/features/account/components/sign-out-button";
import { type Locale, m } from "@/features/i18n";
import { GuardedLink } from "@/shared/components/guarded-link";
import { useConfirmDiscardChanges } from "@/shared/components/unsaved-changes-guard";

export type AccountLayoutShellProps = {
  readonly accountsEnabled: boolean;
  readonly locale: Locale;
  /** Whether the referral program is released; withheld, it has no section. */
  readonly referralsEnabled: boolean;
  readonly signedIn: boolean;
  readonly children: ReactNode;
};

export type AccountLayoutContextValue = {
  readonly accountsEnabled: boolean;
  readonly activeSection: AccountSection;
  readonly changeSection: (section: AccountSection) => void;
  readonly setReservationCount: (count: number | undefined) => void;
  readonly setReferralBadge: (
    badge: AccountNavigationBadge | undefined
  ) => void;
};

const AccountLayoutContext = createContext<AccountLayoutContextValue | null>(
  null
);

const anonymousDisabledSections = [
  "reservations",
  "referrals",
  "profile",
  "security",
  "billing",
  "danger",
] as const;

// TODO(login_passkeys): show "security" once the flag is in the contract.
const withheldPasskeySections = ["security"] as const;
const withheldReferralAndPasskeySections = [
  "referrals",
  ...withheldPasskeySections,
] as const;

function sectionFromQuery(
  value: string | null,
  referralsEnabled: boolean
): AccountSection | undefined {
  switch (value) {
    case "referrals":
      return referralsEnabled ? value : undefined;
    case "reservations":
    case "profile":
    case "billing":
    case "legal":
    case "danger":
      return value;
    default:
      return undefined;
  }
}

function AccountHelp({ locale }: { readonly locale: Locale }) {
  return (
    <div
      className="rounded-2xl border border-[#dfe4ec] p-4"
      style={{ backgroundColor: "#eeebe5" }}
    >
      <h2 className="text-sm font-semibold text-[#344258]">
        {m.accountHelpTitle({}, { locale })}
      </h2>
      <p className="mt-2 text-sm leading-6 text-[#52647c]">
        <Interpolate
          string={m.accountHelpBody({ contact: "{contact}" }, { locale })}
          mapping={{
            contact: (
              <GuardedLink
                className="font-semibold text-burned-orange underline underline-offset-4"
                href={`/${locale}/contact`}
              >
                {m.accountHelpContact({}, { locale })}
              </GuardedLink>
            ),
          }}
        />
      </p>
    </div>
  );
}

export function AccountLayoutShell({
  accountsEnabled,
  children,
  locale,
  referralsEnabled,
  signedIn,
}: AccountLayoutShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const confirmDiscardChanges = useConfirmDiscardChanges();
  const normalizedPathname =
    pathname === null ? null : pathname.replace(/\/+$/, "") || "/";
  const requestedSection = searchParams.get("section");
  const isLegalPathname =
    normalizedPathname?.endsWith("/account/legal") ?? false;
  const isDeletedPathname =
    normalizedPathname?.endsWith("/account/deleted") ?? false;
  let routeSection =
    sectionFromQuery(requestedSection, referralsEnabled) ?? "reservations";
  if (isLegalPathname) routeSection = "legal";
  const routeKey = `${normalizedPathname ?? ""}|${requestedSection ?? ""}`;
  const [localNavigation, setLocalNavigation] = useState(() => ({
    activeSection: routeSection,
    routeKey,
  }));
  const [reservationCount, setReservationCountState] = useState<
    number | undefined
  >();
  const [referralBadge, setReferralBadge] = useState<
    AccountNavigationBadge | undefined
  >();
  if (localNavigation.routeKey !== routeKey) {
    setLocalNavigation({ activeSection: routeSection, routeKey });
  }
  const activeSection =
    localNavigation.routeKey === routeKey
      ? localNavigation.activeSection
      : routeSection;
  const privateNavigationEnabled = signedIn && accountsEnabled;

  const changeSection = useCallback(
    (section: AccountSection) => {
      if (section === "legal") {
        if (isLegalPathname || !confirmDiscardChanges()) return;
        router.push(`/${locale}/account/legal`);
        return;
      }

      if (!privateNavigationEnabled) return;
      if (section === "referrals" && !referralsEnabled) return;
      if (isLegalPathname) {
        if (!confirmDiscardChanges()) return;
        router.push(`/${locale}/account?section=${section}`);
        return;
      }

      setLocalNavigation({ activeSection: section, routeKey });
      // The URL carries the section without a server round trip, so a reload
      // or a locale switch's document navigation reopens it. The default
      // section keeps the canonical account URL.
      const url = new URL(window.location.href);
      if (section === "reservations") url.searchParams.delete("section");
      else url.searchParams.set("section", section);
      window.history.replaceState(null, "", url);
    },
    [
      confirmDiscardChanges,
      isLegalPathname,
      locale,
      privateNavigationEnabled,
      referralsEnabled,
      routeKey,
      router,
    ]
  );

  const setReservationCount = useCallback((count: number | undefined) => {
    setReservationCountState((current) =>
      current === count ? current : count
    );
  }, []);

  const contextValue = useMemo<AccountLayoutContextValue>(
    () => ({
      accountsEnabled,
      activeSection,
      changeSection,
      setReservationCount,
      setReferralBadge,
    }),
    [accountsEnabled, activeSection, changeSection, setReservationCount]
  );

  if (isDeletedPathname) {
    return children;
  }

  const copy = getAccountScreenCopy(locale);

  return (
    <AccountShell
      activeSection={activeSection}
      disabledSections={
        privateNavigationEnabled ? undefined : anonymousDisabledSections
      }
      hiddenSections={
        referralsEnabled
          ? withheldPasskeySections
          : withheldReferralAndPasskeySections
      }
      labels={copy.shell}
      onSectionChange={changeSection}
      referralBadge={referralsEnabled ? referralBadge : undefined}
      reservationCount={reservationCount}
      signOut={signedIn ? <SignOutButton locale={locale} /> : null}
      sidebarFooter={<AccountHelp locale={locale} />}
      title={m.accountTitle({}, { locale })}
    >
      <AccountLayoutContext.Provider value={contextValue}>
        {children}
      </AccountLayoutContext.Provider>
    </AccountShell>
  );
}

export function useAccountLayout(): AccountLayoutContextValue {
  const context = useContext(AccountLayoutContext);
  if (context === null) {
    throw new Error("useAccountLayout must be used within AccountLayoutShell");
  }
  return context;
}
