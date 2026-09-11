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
  type AccountSection,
  AccountShell,
} from "@/features/account/components/shell/account-shell";
import { SignOutButton } from "@/features/account/components/sign-out-button";
import { type Locale, m } from "@/features/i18n";
import { GuardedLink } from "@/shared/components/guarded-link";
import { useConfirmDiscardChanges } from "@/shared/components/unsaved-changes-guard";

type AccountLayoutShellProps = {
  readonly locale: Locale;
  readonly signedIn: boolean;
  readonly children: ReactNode;
};

type AccountLayoutContextValue = {
  readonly activeSection: AccountSection;
  readonly changeSection: (section: AccountSection) => void;
  readonly setReservationCount: (count: number | undefined) => void;
};

const AccountLayoutContext = createContext<AccountLayoutContextValue | null>(
  null
);

const anonymousDisabledSections = [
  "reservations",
  "profile",
  "billing",
  "danger",
] as const;

function sectionFromQuery(value: string | null): AccountSection {
  switch (value) {
    case "reservations":
    case "profile":
    case "billing":
    case "legal":
    case "danger":
      return value;
    default:
      return "reservations";
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
  children,
  locale,
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
  const routeSection = isLegalPathname
    ? "legal"
    : sectionFromQuery(requestedSection);
  const routeKey = `${normalizedPathname ?? ""}|${requestedSection ?? ""}`;
  const [localNavigation, setLocalNavigation] = useState(() => ({
    activeSection: routeSection,
    routeKey,
  }));
  const [reservationCount, setReservationCountState] = useState<
    number | undefined
  >();
  if (localNavigation.routeKey !== routeKey) {
    setLocalNavigation({ activeSection: routeSection, routeKey });
  }
  const activeSection =
    localNavigation.routeKey === routeKey
      ? localNavigation.activeSection
      : routeSection;

  const changeSection = useCallback(
    (section: AccountSection) => {
      if (section === "legal") {
        if (isLegalPathname || !confirmDiscardChanges()) return;
        router.push(`/${locale}/account/legal`);
        return;
      }

      if (!signedIn) return;
      if (isLegalPathname) {
        if (!confirmDiscardChanges()) return;
        router.push(`/${locale}/account?section=${section}`);
        return;
      }

      setLocalNavigation({ activeSection: section, routeKey });
    },
    [confirmDiscardChanges, isLegalPathname, locale, routeKey, router, signedIn]
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
      labels={copy.shell}
      onSectionChange={changeSection}
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
