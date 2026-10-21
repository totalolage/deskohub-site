"use client";

import Interpolate from "@doist/react-interpolate";
import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { getAccountScreenCopy } from "@/features/account/components/account-screen-copy";
import {
  type AccountNavigationBadge,
  AccountShell,
} from "@/features/account/components/shell/account-shell";
import { SignOutButton } from "@/features/account/components/sign-out-button";
import { getAccountPageTitle } from "@/features/account/page-title";
import {
  findAccountSectionOfPathname,
  getAccountSectionPath,
  isAccountPathname,
} from "@/features/account/routes";
import {
  type AccountSection,
  defaultAccountSection,
  flagGatedAccountSections,
  isAccountSectionReleased,
} from "@/features/account/sections";
import { type Locale, m } from "@/features/i18n";
import { GuardedLink } from "@/shared/components/guarded-link";
import { useConfirmDiscardChanges } from "@/shared/components/unsaved-changes-guard";

export type AccountLayoutShellProps = {
  readonly locale: Locale;
  /** Whether `login_passkeys` is on; off, Sign-in & security has no section. */
  readonly passkeysEnabled: boolean;
  /** Whether the referral program is released; withheld, it has no section. */
  readonly referralsEnabled: boolean;
  readonly signedIn: boolean;
  readonly children: ReactNode;
};

export type AccountLayoutContextValue = {
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
  "assistants",
  "billing",
  "danger",
] as const;

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
  children,
  locale,
  passkeysEnabled,
  referralsEnabled,
  signedIn,
}: AccountLayoutShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const confirmDiscardChanges = useConfirmDiscardChanges();
  const routeKey = pathname ?? "";
  const isDeletedPathname = /\/account\/deleted\/*$/.test(routeKey);
  const pathnameSection = findAccountSectionOfPathname(locale, routeKey);
  // The page is not found at a withheld section's path; the shell still
  // never opens one.
  const routeSection =
    pathnameSection !== undefined &&
    isAccountSectionReleased(pathnameSection, {
      passkeysEnabled,
      referralsEnabled,
    })
      ? pathnameSection
      : defaultAccountSection;
  const isLegalPathname = routeSection === "legal";
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
  // The page metadata keeps titling the section the page was loaded at, also
  // after an in-place switch and when Back restores a switched path, so the
  // title follows the path's section as a reload of it would.
  const pageTitle =
    pathnameSection === undefined ||
    pathnameSection === "legal" ||
    pathnameSection !== routeSection
      ? undefined
      : getAccountPageTitle(
          locale,
          isAccountPathname(locale, routeKey) ? undefined : pathnameSection
        );
  useEffect(() => {
    if (pageTitle !== undefined) document.title = pageTitle;
  }, [pageTitle]);

  const changeSection = useCallback(
    (section: AccountSection) => {
      const sectionPath = getAccountSectionPath(locale, section);
      if (section === "legal") {
        if (isLegalPathname || !confirmDiscardChanges()) return;
        router.push(sectionPath);
        return;
      }

      if (!signedIn) return;
      if (
        !isAccountSectionReleased(section, {
          passkeysEnabled,
          referralsEnabled,
        })
      ) {
        return;
      }
      if (isLegalPathname) {
        if (!confirmDiscardChanges()) return;
        router.push(sectionPath);
        return;
      }
      if (section === activeSection) return;

      setLocalNavigation({ activeSection: section, routeKey });
      // Every section of the account page is already rendered, so the switch
      // only moves the URL to the section's path, without a server round
      // trip; a reload, a shared link, or a locale switch's document
      // navigation reopens it. Replacing the entry keeps Back from stepping
      // through sections, which the unsaved-changes guard would question
      // although a switch keeps every draft.
      const url = new URL(window.location.href);
      url.pathname = sectionPath;
      window.history.replaceState(null, "", url);
    },
    [
      activeSection,
      confirmDiscardChanges,
      isLegalPathname,
      locale,
      passkeysEnabled,
      referralsEnabled,
      routeKey,
      router,
      signedIn,
    ]
  );

  const setReservationCount = useCallback((count: number | undefined) => {
    setReservationCountState((current) =>
      current === count ? current : count
    );
  }, []);

  const contextValue = useMemo<AccountLayoutContextValue>(
    () => ({
      activeSection,
      changeSection,
      setReservationCount,
      setReferralBadge,
    }),
    [activeSection, changeSection, setReservationCount]
  );

  if (isDeletedPathname) {
    return children;
  }

  const copy = getAccountScreenCopy(locale);

  return (
    <AccountShell
      activeSection={activeSection}
      disabledSections={signedIn ? undefined : anonymousDisabledSections}
      hiddenSections={flagGatedAccountSections.filter(
        (section) =>
          !isAccountSectionReleased(section, {
            passkeysEnabled,
            referralsEnabled,
          })
      )}
      labels={copy.shell}
      onSectionChange={changeSection}
      sectionHref={(section) => getAccountSectionPath(locale, section)}
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
