"use client";

import {
  CalendarDays,
  CreditCard,
  ShieldCheck,
  TriangleAlert,
  UserRound,
} from "lucide-react";
import {
  type FocusEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
} from "react";
import { Button } from "@/shared/components/ui/button";

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
  const handleAsideFocusCapture = (event: FocusEvent<HTMLElement>) => {
    const aside = event.currentTarget;
    const ownerWindow = aside.ownerDocument.defaultView;
    if (!ownerWindow) return;

    const asideStyle = ownerWindow.getComputedStyle(aside);
    if (asideStyle.position !== "sticky") return;

    const stickyTop = Number.parseFloat(asideStyle.top);
    if (!Number.isFinite(stickyTop)) return;

    const target = event.target;
    if (!(target instanceof ownerWindow.Element)) return;

    const targetRect = target.getBoundingClientRect();
    if (
      targetRect.top < stickyTop ||
      targetRect.bottom > ownerWindow.innerHeight
    ) {
      target.scrollIntoView({ block: "center", inline: "nearest" });
    }
  };
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
    <main className="min-h-screen [--font-heading-weight:700] [--font-subheading-weight:600] [background:radial-gradient(circle_at_0%_0%,rgba(255,242,214,0.9),transparent_34%),radial-gradient(circle_at_100%_0%,rgba(218,244,235,0.82),transparent_38%),#f8f5ef] px-4 pb-28 pt-[calc(var(--site-header-height)+3rem)] sm:px-6 lg:px-8">
      <div className="mx-auto min-w-0 max-w-[95rem]">
        <header className="flex min-w-0 flex-row items-start justify-between gap-x-3 gap-y-4 sm:flex-wrap sm:gap-x-8">
          <h1 className="min-w-0 flex-1 break-words text-[24px] min-[375px]:text-[28px] font-bold leading-[1.15] tracking-[-0.025em] text-[#00024f] sm:text-[36px]">
            {title}
          </h1>
          {signOut && (
            <div className="min-w-0 max-w-[60%] shrink-0 break-words sm:max-w-full sm:break-normal">
              {signOut}
            </div>
          )}
        </header>

        <div className="mt-7 grid min-w-0 items-start gap-8 md:grid-cols-[minmax(0,17.5rem)_minmax(0,1fr)]">
          <aside
            className="min-w-0 md:sticky md:top-[calc(var(--site-header-height)+1rem)] md:max-h-[calc(100dvh-var(--site-header-height)-2rem)] md:overflow-y-auto"
            onFocusCapture={handleAsideFocusCapture}
          >
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
                        buttonStateClassName =
                          "text-[#d71945] hover:bg-[#fff1f4]";
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
