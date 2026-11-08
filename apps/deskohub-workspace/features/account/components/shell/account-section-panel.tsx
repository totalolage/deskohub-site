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
  /** Classes for the body below the header, such as centering its content. */
  readonly bodyClassName?: string;
  readonly variant?: "default" | "destructive";
  /** `compact` sets a smaller title and tighter header for dense dashboards. */
  readonly size?: "default" | "compact";
}

export function AccountSectionPanel({
  actions,
  bodyClassName,
  children,
  className,
  footer,
  size = "default",
  title,
  titleId,
  variant = "default",
  ...rest
}: AccountSectionPanelProps) {
  const generatedTitleId = useId();
  const headingId = titleId ?? generatedTitleId;
  const tone = {
    default: {
      border: "border-[#dfe4ec]",
      divider: "border-[#e6ebf1]",
      title: "text-[#00024f]",
    },
    destructive: {
      border: "border-rose-200",
      divider: "border-rose-200",
      title: "text-rose-900",
    },
  }[variant];
  const density = {
    default: {
      section: undefined,
      header: "items-start pb-5",
      title: "text-[26px] tracking-[-0.025em]",
      body: "pt-7",
    },
    compact: {
      section: "pb-4 @xl:pb-5",
      header: "items-center pb-4",
      title: "text-xl tracking-[-0.02em]",
      body: "pt-4 @xl:pt-8",
    },
  }[size];

  return (
    <section
      aria-labelledby={headingId}
      className={cn(
        "min-w-0 rounded-2xl border bg-white p-5 text-navy-blue shadow-[0_18px_40px_-28px_rgba(0,2,79,0.45)] @xl:p-8 [&_input]:scroll-mb-[calc(12rem+env(safe-area-inset-bottom))] [&_select]:scroll-mb-[calc(12rem+env(safe-area-inset-bottom))]",
        tone.border,
        density.section,
        className
      )}
      {...rest}
      data-slot="account-section-panel"
      data-size={size}
      data-variant={variant}
    >
      <header
        className={cn(
          "flex min-w-0 flex-wrap justify-between gap-x-4 gap-y-3 border-b",
          density.header,
          tone.divider
        )}
      >
        <h2
          className={cn(
            "min-w-0 break-words font-bold leading-tight",
            density.title,
            tone.title
          )}
          id={headingId}
        >
          {title}
        </h2>
        {actions && <div className="shrink-0">{actions}</div>}
      </header>

      <div className={cn("min-w-0", density.body, bodyClassName)}>
        {children}
      </div>

      {footer !== undefined && (
        <div
          className={cn(
            "sticky bottom-0 z-10 mt-8 min-w-0 border-t bg-white pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]",
            tone.divider
          )}
        >
          {footer}
        </div>
      )}
    </section>
  );
}
