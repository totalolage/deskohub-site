"use client";

import type { ComponentPropsWithoutRef, ReactNode } from "react";
import { useId } from "react";
import { cn } from "@/shared/utils";

/*
 * Shared section chrome for the account screens: one white inset card with a
 * titled header, a divider, a body, and an optional sticky safe-area footer.
 * Every account section renders through this panel so spacing, typography,
 * and overflow behavior cannot drift apart.
 */

export interface AccountSectionPanelProps
  extends Omit<ComponentPropsWithoutRef<"section">, "title"> {
  readonly title: ReactNode;
  /** Heading id for `aria-labelledby`; generated when omitted. */
  readonly titleId?: string;
  /** Content rendered on the trailing side of the header row. */
  readonly actions?: ReactNode;
  readonly footer?: ReactNode;
  readonly variant?: "default" | "destructive";
}

export function AccountSectionPanel({
  actions,
  children,
  className,
  footer,
  title,
  titleId,
  variant = "default",
  ...rest
}: AccountSectionPanelProps) {
  const generatedTitleId = useId();
  const headingId = titleId ?? generatedTitleId;
  const destructive = variant === "destructive";

  return (
    <section
      aria-labelledby={headingId}
      className={cn(
        "min-w-0 rounded-2xl border bg-white p-5 text-navy-blue shadow-[0_18px_40px_-28px_rgba(0,2,79,0.45)] sm:p-8 [&_input]:scroll-mb-[calc(12rem+env(safe-area-inset-bottom))] [&_select]:scroll-mb-[calc(12rem+env(safe-area-inset-bottom))]",
        destructive ? "border-rose-200" : "border-[#dfe4ec]",
        className
      )}
      {...rest}
      data-slot="account-section-panel"
      data-variant={variant}
    >
      <header
        className={cn(
          "flex min-w-0 flex-wrap items-start justify-between gap-x-4 gap-y-3 border-b pb-5",
          destructive ? "border-rose-200" : "border-[#e6ebf1]"
        )}
      >
        <h2
          className={cn(
            "min-w-0 break-words text-[26px] font-bold leading-tight tracking-[-0.025em]",
            destructive ? "text-rose-900" : "text-[#00024f]"
          )}
          id={headingId}
        >
          {title}
        </h2>
        {actions && <div className="shrink-0">{actions}</div>}
      </header>

      <div className="min-w-0 pt-7">{children}</div>

      {footer !== undefined && (
        <div
          className={cn(
            "sticky bottom-0 z-10 mt-8 min-w-0 border-t bg-white pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]",
            destructive ? "border-rose-200" : "border-[#e6ebf1]"
          )}
        >
          {footer}
        </div>
      )}
    </section>
  );
}
