"use client";

import {
  CalendarDays,
  CreditCard,
  ShieldCheck,
  TriangleAlert,
  UserRound,
} from "lucide-react";
import { type ReactNode, useEffect, useId, useRef } from "react";
import { Button } from "@/shared/components/ui/button";
import { AccountFrame } from "./account-frame";

/*
 * THESIS: Account navigation stays task-first instead of becoming a card grid.
 * OWN-WORLD: Sculpin, navy, slate, warm cream, mint, and terracotta extend the account page.
 * STORY: Visitors see their account title, choose one section, and own the content task.
 * FIRST VIEWPORT: A wrapped title/action header sits above a sidebar and unstyled content slot.
 * FORM: Mobile navigation uses labelled buttons; callers own every action and fact.
 */

export type AccountSection =
  | "reservations"
  | "profile"
  | "billing"
  | "legal"
  | "danger";

export interface AccountShellProps {
  readonly activeSection: AccountSection;
  readonly onSectionChange: (section: AccountSection) => void;
  readonly children: ReactNode;
  readonly signOut: ReactNode;
  readonly title: string;
  readonly labels: {
    readonly navigation: string;
    readonly mobileSection: string;
    readonly sections: Readonly<Record<AccountSection, string>>;
  };
  readonly reservationCount?: number;
  readonly sidebarFooter?: ReactNode;
  readonly disabledSections?: readonly AccountSection[];
}

export function AccountShell({
  activeSection,
  children,
  disabledSections = [],
  labels,
  onSectionChange,
  reservationCount,
  sidebarFooter,
  signOut,
  title,
}: AccountShellProps) {
  const mobileSectionId = useId();
  const validReservationCount =
    reservationCount !== undefined &&
    Number.isFinite(reservationCount) &&
    Number.isInteger(reservationCount) &&
    reservationCount >= 0
      ? reservationCount
      : undefined;
  const sections = [
    { icon: CalendarDays, key: "reservations" },
    { icon: UserRound, key: "profile" },
    { icon: CreditCard, key: "billing" },
    { icon: ShieldCheck, key: "legal" },
    { icon: TriangleAlert, key: "danger" },
  ] as const;
  const mobileNavigationRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mobileNavigation = mobileNavigationRef.current;
    if (mobileNavigation === null) return;

    const revealActiveSection = () => {
      const activeButton = mobileNavigation.querySelector<HTMLButtonElement>(
        `[data-account-section="${activeSection}"]`
      );
      if (activeButton === null) return;

      const navigationRect = mobileNavigation.getBoundingClientRect();
      const buttonRect = activeButton.getBoundingClientRect();
      if (
        navigationRect.width <= 0 ||
        navigationRect.height <= 0 ||
        buttonRect.width <= 0 ||
        buttonRect.height <= 0
      )
        return;

      if (buttonRect.left < navigationRect.left) {
        mobileNavigation.scrollLeft -= navigationRect.left - buttonRect.left;
      } else if (buttonRect.right > navigationRect.right) {
        mobileNavigation.scrollLeft += buttonRect.right - navigationRect.right;
      }
    };
    const resizeObserver = new ResizeObserver(revealActiveSection);
    resizeObserver.observe(mobileNavigation);
    revealActiveSection();

    return () => resizeObserver.disconnect();
  }, [activeSection]);
  const handleSectionChange = (section: AccountSection) => {
    if (disabledSections.includes(section)) return;
    onSectionChange(section);
  };

  return (
    <AccountFrame
      navigation={
        <nav
          aria-label={labels.navigation}
          className="rounded-[20px] border border-[#dfe4ec] bg-white p-4"
        >
          <div className="md:hidden">
            <fieldset
              aria-labelledby={mobileSectionId}
              className="min-w-0 border-0 p-0"
            >
              <legend
                className="mb-2 block text-sm font-semibold text-[#344258]"
                id={mobileSectionId}
              >
                {labels.mobileSection}
              </legend>
              <div
                className="flex min-w-0 touch-pan-x flex-nowrap gap-2 overflow-x-auto px-1 py-1"
                data-account-mobile-navigation=""
                ref={mobileNavigationRef}
              >
                {sections.map((section) => {
                  const isActive = activeSection === section.key;
                  const isDanger = section.key === "danger";
                  let buttonStateClassName =
                    "text-[#344258] hover:bg-[#f3f5f8]";

                  if (isDanger) {
                    buttonStateClassName = "text-[#d71945] hover:bg-[#fff1f4]";
                  }
                  if (isActive) {
                    buttonStateClassName =
                      "bg-[#00024f] text-white hover:bg-[#00024f]";
                    if (isDanger) {
                      buttonStateClassName =
                        "bg-[#e71545] text-white hover:bg-[#e71545]";
                    }
                  }

                  return (
                    <Button
                      aria-current={isActive ? "page" : undefined}
                      className={`min-h-[44px] shrink-0 whitespace-nowrap rounded-2xl px-3 text-[15px] font-semibold focus-visible:ring-inset focus-visible:ring-offset-0 ${buttonStateClassName}`}
                      data-account-section={section.key}
                      disabled={disabledSections.includes(section.key)}
                      key={section.key}
                      onClick={() => handleSectionChange(section.key)}
                      type="button"
                      variant="ghost"
                    >
                      {labels.sections[section.key]}
                    </Button>
                  );
                })}
              </div>
            </fieldset>
          </div>

          <div className="hidden md:block">
            <div className="grid gap-[6px]">
              {sections.map((section) => {
                const Icon = section.icon;
                const isActive = activeSection === section.key;
                const isDanger = section.key === "danger";
                let buttonStateClassName = "text-[#344258] hover:bg-[#f3f5f8]";
                let iconStateClassName = "text-[#718096]";

                if (isDanger) {
                  buttonStateClassName = "text-[#d71945] hover:bg-[#fff1f4]";
                  iconStateClassName = "text-[#d71945]";
                }
                if (isActive) {
                  buttonStateClassName =
                    "bg-[#00024f] text-white hover:bg-[#00024f]";
                  iconStateClassName = "text-white";
                  if (isDanger) {
                    buttonStateClassName =
                      "bg-[#e71545] text-white hover:bg-[#e71545]";
                  }
                }

                return (
                  <Button
                    aria-current={isActive ? "page" : undefined}
                    className={`h-auto min-h-[40px] w-full justify-start gap-3 rounded-2xl px-3 text-left text-[15px] font-semibold leading-snug whitespace-normal ${buttonStateClassName}`}
                    disabled={disabledSections.includes(section.key)}
                    key={section.key}
                    onClick={() => handleSectionChange(section.key)}
                    type="button"
                    variant="ghost"
                  >
                    <Icon
                      aria-hidden="true"
                      className={`size-4 shrink-0 ${iconStateClassName}`}
                    />
                    <span className="min-w-0 break-words">
                      {labels.sections[section.key]}
                    </span>
                    {section.key === "reservations" &&
                      validReservationCount !== undefined && (
                        <span className="ml-auto min-w-9 rounded-full bg-[#b06147] px-2.5 py-1 text-center text-sm font-bold leading-none text-white [font-family:var(--font-sculpin,Arial),sans-serif]">
                          {validReservationCount}
                        </span>
                      )}
                  </Button>
                );
              })}
            </div>
          </div>
        </nav>
      }
      sidebarFooter={sidebarFooter}
      signOut={signOut}
      title={title}
    >
      {children}
    </AccountFrame>
  );
}
