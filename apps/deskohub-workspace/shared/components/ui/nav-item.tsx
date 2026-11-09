import { Slot } from "@radix-ui/react-slot";
import { cva } from "class-variance-authority";
import type * as React from "react";
import { cn } from "@/shared/utils";

const navItemVariants = cva(
  "inline-flex cursor-pointer items-center gap-3 text-[15px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-burned-orange disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      layout: {
        row: "min-h-10 w-full justify-start rounded-2xl px-3 py-2 text-left leading-snug whitespace-normal focus-visible:ring-inset",
        tab: "min-h-11 justify-center rounded-none px-3 whitespace-nowrap focus-visible:ring-inset md:rounded-2xl",
        icon: "size-10 justify-center rounded-full p-0 focus-visible:ring-inset",
        step: "flex min-w-0 rounded-2xl border px-4 py-3 text-sm uppercase tracking-[0.14em] lg:gap-2 lg:px-3 lg:text-xs lg:tracking-[0.08em]",
      },
      tone: {
        neutral: "",
        danger: "",
        inverse: "border",
        translucent: "",
      },
      caps: {
        true: "text-sm uppercase tracking-[0.12em]",
        false: "",
      },
      active: {
        true: "text-white",
        false: "",
      },
    },
    compoundVariants: [
      {
        tone: "neutral",
        active: false,
        class:
          "text-[#344258] hover:bg-[#f3f5f8] hover:text-navy-blue [&_svg]:text-[#718096]",
      },
      { tone: "neutral", active: true, class: "bg-navy-blue" },
      {
        tone: "danger",
        active: false,
        class: "text-[#d71945] hover:bg-[#fff1f4]",
      },
      { tone: "danger", active: true, class: "bg-[#e71545]" },
      {
        tone: "inverse",
        active: false,
        class:
          "border-white/8 bg-white/5 text-white/80 hover:border-sunset-yellow/60 hover:text-sunset-yellow",
      },
      {
        tone: "inverse",
        active: true,
        class: "border-sunset-yellow/55 bg-sunset-yellow/10 text-sunset-yellow",
      },
      {
        tone: "translucent",
        active: false,
        class:
          "border-white/12 bg-white/7 text-white/68 hover:border-white/28 hover:bg-white/12 hover:text-white",
      },
    ],
    defaultVariants: {
      layout: "row",
      tone: "neutral",
      caps: false,
      active: false,
    },
  }
);

type NavItemProps = Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  "aria-current" | "className"
> & {
  /** Marks the item as the current location (`aria-current`). */
  readonly active?: boolean;
  /** Renders the child element (usually a link) as the item. */
  readonly asChild?: boolean;
  /** Uppercase, letter-spaced label, as in the site header menu. */
  readonly caps?: boolean;
  /** Parent layout only, as for `Button`. */
  readonly className?: string;
  /** The kind of location the active item represents. */
  readonly current?: "page" | "location" | "step";
  /**
   * `row` stacks in a sidebar or menu, `tab` sits in a horizontal strip,
   * `icon` is a round icon-only item (give it an `aria-label`) and `step` is a
   * bordered tile in a progress list such as the checkout steps.
   */
  readonly layout?: "row" | "tab" | "icon" | "step";
  readonly ref?: React.Ref<HTMLButtonElement>;
  /**
   * `inverse` is for dark backgrounds such as the site header; `translucent`
   * is a frosted tile on a dark background, as in the checkout steps.
   */
  readonly tone?: "neutral" | "danger" | "inverse" | "translucent";
};

/**
 * One entry of a navigation list. The active entry is filled and announced
 * with `aria-current`. Icons inside are sized and tinted for the state.
 */
function NavItem({
  active = false,
  asChild = false,
  caps,
  className,
  current = "page",
  layout,
  ref,
  tone,
  ...props
}: NavItemProps) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      aria-current={active ? current : undefined}
      className={cn(navItemVariants({ active, caps, layout, tone }), className)}
      ref={ref}
      {...(asChild ? {} : { type: "button" })}
      {...props}
    />
  );
}

export { NavItem };
