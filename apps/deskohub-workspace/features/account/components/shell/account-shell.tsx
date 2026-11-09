"use client";

import {
  Bot,
  CalendarDays,
  CreditCard,
  Gift,
  KeyRound,
  ShieldCheck,
  TriangleAlert,
  UserRound,
} from "lucide-react";
import {
  type MouseEvent,
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
} from "react";
import { getAccountSectionPath } from "@/features/account/routes";
import {
  type AccountSection,
  accountSectionLabel,
} from "@/features/account/sections";
import { type Locale, m } from "@/features/i18n";
import { NavItem } from "@/shared/components/ui/nav-item";
import { cn } from "@/shared/utils";
import { AccountFrame, revealAccountContentStart } from "./account-frame";

/*
 * THESIS: Account navigation stays task-first instead of becoming a card grid.
 * OWN-WORLD: Sculpin, navy, slate, warm cream, mint, and terracotta extend the account page.
 * STORY: Visitors see their account title, choose one section, and own the content task.
 * FIRST VIEWPORT: A wrapped title/action header sits above a sidebar and unstyled content slot.
 * FORM: Navigation items link to each section's path; callers own every action and fact.
 */

export interface AccountNavigationBadge {
  readonly text: string;
  /** Spoken in place of the text, such as "15% referral discount". */
  readonly label: string;
}

export interface AccountShellProps {
  readonly activeSection: AccountSection;
  /** Names the navigation and sections; each section links to its path. */
  readonly locale: Locale;
  readonly onSectionChange: (section: AccountSection) => void;
  readonly children: ReactNode;
  readonly signOut: ReactNode;
  readonly reservationCount?: number;
  /** Badge beside Referrals, such as "-15%"; hidden when absent. */
  readonly referralBadge?: AccountNavigationBadge;
  readonly sidebarFooter?: ReactNode;
  readonly disabledSections?: readonly AccountSection[];
  /** Sections left out of the navigation entirely. */
  readonly hiddenSections?: readonly AccountSection[];
}

export function AccountShell({
  activeSection,
  children,
  disabledSections = [],
  hiddenSections = [],
  locale,
  onSectionChange,
  referralBadge,
  reservationCount,
  sidebarFooter,
  signOut,
}: AccountShellProps) {
  const mobileSectionId = useId();
  const validReservationCount =
    reservationCount !== undefined &&
    Number.isFinite(reservationCount) &&
    Number.isInteger(reservationCount) &&
    reservationCount >= 0
      ? reservationCount
      : undefined;
  const sections = (
    [
      { icon: CalendarDays, key: "reservations" },
      { icon: Gift, key: "referrals" },
      { icon: UserRound, key: "profile" },
      { icon: KeyRound, key: "security" },
      { icon: Bot, key: "assistants" },
      { icon: CreditCard, key: "billing" },
      { icon: ShieldCheck, key: "legal" },
      { icon: TriangleAlert, key: "danger" },
    ] as const
  ).filter((section) => !hiddenSections.includes(section.key));
  const mobileNavigationRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  // The section a navigation click asked for; its content starts at its top.
  const selectedSectionRef = useRef<AccountSection | null>(null);

  useLayoutEffect(() => {
    if (selectedSectionRef.current !== activeSection) return;
    selectedSectionRef.current = null;
    if (contentRef.current) revealAccountContentStart(contentRef.current);
  }, [activeSection]);

  useEffect(() => {
    const mobileNavigation = mobileNavigationRef.current;
    if (mobileNavigation === null) return;

    const revealActiveSection = () => {
      const activeItem = mobileNavigation.querySelector<HTMLElement>(
        `[data-account-section="${activeSection}"]`
      );
      if (activeItem === null) return;

      const navigationRect = mobileNavigation.getBoundingClientRect();
      const itemRect = activeItem.getBoundingClientRect();
      if (
        navigationRect.width <= 0 ||
        navigationRect.height <= 0 ||
        itemRect.width <= 0 ||
        itemRect.height <= 0
      )
        return;

      if (
        itemRect.left < navigationRect.left ||
        itemRect.right > navigationRect.right
      ) {
        mobileNavigation.scrollLeft += itemRect.left - navigationRect.left;
      }
    };
    const resizeObserver = new ResizeObserver(revealActiveSection);
    resizeObserver.observe(mobileNavigation);
    revealActiveSection();

    return () => resizeObserver.disconnect();
  }, [activeSection]);
  const handleSectionChange = (section: AccountSection) => {
    if (
      disabledSections.includes(section) ||
      hiddenSections.includes(section)
    ) {
      return;
    }
    if (section !== activeSection) selectedSectionRef.current = section;
    onSectionChange(section);
  };
  const selectSection =
    (section: AccountSection) => (event: MouseEvent<HTMLAnchorElement>) => {
      // A modified click, such as to open a new tab, stays the browser's.
      if (
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }
      event.preventDefault();
      handleSectionChange(section);
    };
  // An item links to its section's path, or is a disabled button while the
  // section can't open.
  const sectionItemContent = (section: AccountSection, content: ReactNode) =>
    disabledSections.includes(section) ? (
      content
    ) : (
      <a
        href={getAccountSectionPath(locale, section)}
        onClick={selectSection(section)}
      >
        {content}
      </a>
    );

  return (
    <AccountFrame
      contentRef={contentRef}
      navigation={
        <nav
          aria-label={m.accountNavigationLabel({}, { locale })}
          className="-mx-4 min-w-0 rounded-none border-0 bg-white p-0 sm:-mx-6 md:mx-0 md:rounded-[20px] md:border md:border-[#dfe4ec] md:p-4"
        >
          <div className="md:hidden">
            <fieldset
              aria-labelledby={mobileSectionId}
              className="min-w-0 border-0 p-0"
            >
              <legend className="sr-only" id={mobileSectionId}>
                {m.accountSectionLabel({}, { locale })}
              </legend>
              <div
                className="flex min-w-0 touch-pan-x snap-x snap-proximity flex-nowrap gap-2 overflow-x-auto"
                data-account-mobile-navigation=""
                ref={mobileNavigationRef}
              >
                {sections.map((section) => (
                  <NavItem
                    active={activeSection === section.key}
                    asChild={!disabledSections.includes(section.key)}
                    className="shrink-0 snap-start"
                    data-account-section={section.key}
                    disabled={disabledSections.includes(section.key)}
                    key={section.key}
                    layout="tab"
                    tone={section.key === "danger" ? "danger" : "neutral"}
                  >
                    {sectionItemContent(
                      section.key,
                      accountSectionLabel(section.key, locale)
                    )}
                  </NavItem>
                ))}
              </div>
            </fieldset>
          </div>

          <div className="hidden md:block">
            <div className="grid gap-[6px]">
              {sections.map((section) => {
                const Icon = section.icon;
                const isActive = activeSection === section.key;

                return (
                  <NavItem
                    active={isActive}
                    asChild={!disabledSections.includes(section.key)}
                    data-account-sidebar-section={section.key}
                    disabled={disabledSections.includes(section.key)}
                    key={section.key}
                    tone={section.key === "danger" ? "danger" : "neutral"}
                  >
                    {sectionItemContent(
                      section.key,
                      <>
                        <Icon aria-hidden="true" />
                        <span className="min-w-0 break-words">
                          {accountSectionLabel(section.key, locale)}
                        </span>
                        {section.key === "reservations" &&
                          validReservationCount !== undefined && (
                            <NavigationBadge section="reservations">
                              {validReservationCount}
                            </NavigationBadge>
                          )}
                        {section.key === "referrals" && referralBadge && (
                          <NavigationBadge
                            active={isActive}
                            label={referralBadge.label}
                            section="referrals"
                            tone="positive"
                          >
                            {referralBadge.text}
                          </NavigationBadge>
                        )}
                      </>
                    )}
                  </NavItem>
                );
              })}
            </div>
          </div>
        </nav>
      }
      sidebarFooter={sidebarFooter}
      signOut={signOut}
      title={m.accountTitle({}, { locale })}
    >
      {children}
    </AccountFrame>
  );
}

function NavigationBadge({
  active = false,
  children,
  label,
  section,
  tone = "count",
}: {
  readonly active?: boolean;
  readonly children: ReactNode;
  /** Replaces the visible text for screen readers when set. */
  readonly label?: string;
  readonly section: AccountSection;
  readonly tone?: "count" | "positive";
}) {
  return (
    <span
      data-account-navigation-badge={section}
      className={cn(
        "ml-auto min-w-9 shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-center text-sm font-bold leading-none text-white [font-family:var(--font-sculpin,Arial),sans-serif]",
        tone === "positive" ? "bg-aquamarine-ink" : "bg-[#b06147]",
        tone === "positive" && active && "ring-1 ring-white/40"
      )}
    >
      {label === undefined ? (
        children
      ) : (
        <>
          <span aria-hidden="true">{children}</span>
          <span className="sr-only">{label}</span>
        </>
      )}
    </span>
  );
}
