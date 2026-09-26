import {
  type ComponentPropsWithoutRef,
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
} from "react";
import { cn } from "@/shared/utils";

/*
 * Shared visual primitive for consent and communication preference rows:
 * one quiet tinted card with a title, a description, optional supporting
 * content, and a trailing control (typically a switch). Cookie settings and
 * marketing preferences render through this row so typographic and spacing
 * rhythm cannot diverge between the two screens. Standard article props
 * (including `data-*` attributes and `className`) pass through to the
 * underlying `<article>` so callers can mark up rows semantically without
 * wrapper elements.
 */

export interface PreferenceRowProps
  extends Omit<ComponentPropsWithoutRef<"article">, "children" | "title"> {
  readonly title: ReactNode;
  readonly titleId: string;
  readonly description: ReactNode;
  readonly descriptionId: string;
  readonly headingAs?: "h2" | "h3" | "h4";
  /** Supporting content rendered under the description, inside the text column. */
  readonly children?: ReactNode;
  /** Trailing control, usually a switch labelled by the title and description. */
  readonly control?: ReactNode;
  /** Announced while a preference save is in flight. */
  readonly busy?: boolean;
}

export function PreferenceRow({
  busy,
  children,
  className,
  control,
  description,
  descriptionId,
  headingAs: Heading = "h3",
  title,
  titleId,
  ...articleProps
}: PreferenceRowProps) {
  // The control must stay a direct child of the row so callers can target it
  // structurally; inject the shrink guard on the element itself.
  let styledControl = control;
  if (isValidElement(control)) {
    const withClassName = control as ReactElement<{ className?: string }>;
    styledControl = cloneElement(withClassName, {
      className: cn("shrink-0", withClassName.props.className),
    });
  }
  return (
    <article
      {...articleProps}
      aria-busy={busy || undefined}
      className={cn(
        className,
        "flex min-w-0 items-start justify-between gap-5 rounded-2xl border border-navy-blue/10 bg-[#f8f6f1] p-5 sm:p-6"
      )}
      data-slot="preference-row"
    >
      <div className="min-w-0 flex-1 space-y-2">
        <Heading
          className="break-words text-lg font-semibold leading-6 text-[#1f2d43]"
          id={titleId}
        >
          {title}
        </Heading>
        <p
          className="break-words text-base leading-6 text-navy-blue/70"
          id={descriptionId}
        >
          {description}
        </p>
        {children}
      </div>
      {styledControl}
    </article>
  );
}

export function PreferenceRowGroup({
  children,
  className,
}: {
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <div
      className={cn("min-w-0 space-y-4", className)}
      data-slot="preference-row-group"
    >
      {children}
    </div>
  );
}
