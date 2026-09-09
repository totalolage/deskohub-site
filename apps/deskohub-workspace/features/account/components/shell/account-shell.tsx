"use client";

import {
  CalendarDays,
  CreditCard,
  ShieldCheck,
  TriangleAlert,
  UserRound,
} from "lucide-react";
import { type ReactNode, useId } from "react";
import { Button } from "@/shared/components/ui/button";

/*
 * THESIS: Account navigation stays task-first instead of becoming a card grid.
 * OWN-WORLD: Sculpin, navy, slate, warm cream, mint, and terracotta extend the account page.
 * STORY: Visitors see their account title, choose one section, and own the content task.
 * FIRST VIEWPORT: A wrapped title/action header sits above a sidebar and unstyled content slot.
 * FORM: Desktop buttons collapse to a native select; callers own every action and fact.
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
}

export function AccountShell({
  activeSection,
  children,
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

  return (
    <main className="min-h-screen [--font-heading-weight:700] [--font-subheading-weight:600] [background:radial-gradient(circle_at_0%_0%,rgba(255,242,214,0.9),transparent_34%),radial-gradient(circle_at_100%_0%,rgba(218,244,235,0.82),transparent_38%),#f8f5ef] px-4 pb-28 pt-[calc(var(--site-header-height)+3rem)] sm:px-6 lg:px-8">
      <div className="mx-auto min-w-0 max-w-[95rem]">
        <header className="flex min-w-0 flex-col gap-x-8 gap-y-4 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between">
          <h1 className="w-full min-w-0 flex-1 break-words text-[28px] font-bold leading-[1.15] tracking-[-0.025em] text-[#00024f] sm:w-auto sm:text-[36px]">
            {title}
          </h1>
          <div className="max-w-full shrink-0 self-start sm:self-auto">
            {signOut}
          </div>
        </header>

        <div className="mt-7 grid min-w-0 items-start gap-8 md:grid-cols-[minmax(0,17.5rem)_minmax(0,1fr)]">
          <aside className="min-w-0">
            <nav
              aria-label={labels.navigation}
              className="rounded-[20px] border border-[#dfe4ec] bg-white p-4"
            >
              <div className="md:hidden">
                <label
                  className="mb-2 block text-sm font-semibold text-[#344258]"
                  htmlFor={mobileSectionId}
                >
                  {labels.mobileSection}
                </label>
                <select
                  className="min-h-[44px] w-full rounded-xl border border-[#cad3df] bg-white px-3 text-[18px] leading-tight text-[#344258] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-burned-orange focus-visible:ring-offset-2"
                  id={mobileSectionId}
                  onChange={(event) => {
                    const selectedSection = sections.find(
                      (section) => section.key === event.currentTarget.value
                    );
                    if (selectedSection) {
                      onSectionChange(selectedSection.key);
                    }
                  }}
                  value={activeSection}
                >
                  {sections.map((section) => (
                    <option key={section.key} value={section.key}>
                      {labels.sections[section.key]}
                    </option>
                  ))}
                </select>
              </div>

              <div className="hidden md:block">
                <div className="grid gap-[6px]">
                  {sections.map((section) => {
                    const Icon = section.icon;
                    const isActive = activeSection === section.key;
                    const isDanger = section.key === "danger";
                    let buttonStateClassName =
                      "text-[#344258] hover:bg-[#f3f5f8]";
                    let iconStateClassName = "text-[#718096]";

                    if (isDanger) {
                      buttonStateClassName =
                        "text-[#d71945] hover:bg-[#fff1f4]";
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
                        key={section.key}
                        onClick={() => onSectionChange(section.key)}
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
                            <span className="ml-auto min-w-9 rounded-full bg-[#cf7253] px-2.5 py-1 text-center text-sm font-bold leading-none text-[#00024f]">
                              {validReservationCount}
                            </span>
                          )}
                      </Button>
                    );
                  })}
                </div>
              </div>
            </nav>

            {sidebarFooter && (
              <div className="mt-4 min-w-0">{sidebarFooter}</div>
            )}
          </aside>

          <div className="min-w-0">{children}</div>
        </div>
      </div>
    </main>
  );
}
