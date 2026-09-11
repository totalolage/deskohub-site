"use client";

import type { FocusEvent, ReactNode } from "react";

export interface AccountFrameProps {
  readonly title: ReactNode;
  readonly signOut?: ReactNode;
  readonly navigation: ReactNode;
  readonly sidebarFooter?: ReactNode;
  readonly children: ReactNode;
}

export function AccountFrame({
  children,
  navigation,
  sidebarFooter,
  signOut,
  title,
}: AccountFrameProps) {
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

  return (
    <main className="min-h-screen [--font-heading-weight:700] [--font-subheading-weight:600] [background:radial-gradient(circle_at_0%_0%,rgba(255,242,214,0.9),transparent_34%),radial-gradient(circle_at_100%_0%,rgba(218,244,235,0.82),transparent_38%),#f8f5ef] px-4 pb-28 pt-[calc(var(--site-header-height)+3rem)] sm:px-6 lg:px-8">
      <div className="mx-auto min-w-0 max-w-[95rem]">
        <header className="flex min-w-0 flex-row items-start justify-between gap-x-3 gap-y-4 sm:flex-wrap sm:gap-x-8">
          <h1 className="min-w-min flex-1 break-words pr-px text-[24px] min-[375px]:text-[28px] font-bold leading-[1.15] tracking-[-0.025em] text-[#00024f] sm:min-w-0 sm:pr-0 sm:text-[36px]">
            {title}
          </h1>
          {signOut && (
            <div className="min-w-0 max-w-[60%] shrink break-words sm:max-w-full sm:shrink-0 sm:break-normal">
              {signOut}
            </div>
          )}
        </header>

        <div className="mt-7 grid min-w-0 items-start gap-8 md:grid-cols-[minmax(0,17.5rem)_minmax(0,1fr)]">
          <aside
            className="sticky top-(--site-header-height) z-40 min-w-0 md:sticky md:top-[calc(var(--site-header-height)+1rem)] md:max-h-[calc(100dvh-var(--site-header-height)-2rem)] md:overflow-y-auto"
            onFocusCapture={handleAsideFocusCapture}
          >
            {navigation}

            {sidebarFooter && (
              <div className="mt-4 min-w-0 hidden md:block">
                {sidebarFooter}
              </div>
            )}
          </aside>

          <div className="min-w-0">{children}</div>

          {sidebarFooter && (
            <div className="min-w-0 md:hidden">{sidebarFooter}</div>
          )}
        </div>
      </div>
    </main>
  );
}
