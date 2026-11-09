import { Slot } from "@radix-ui/react-slot";
import { cva } from "class-variance-authority";
import type * as React from "react";
import { cn } from "@/shared/utils";

/**
 * Colours each variant accepts. A primary tone sets the fill, its hover and
 * the glow together; secondary, ghost and link tones set text, edge and hover.
 * `inverse` is for dark backgrounds, `danger` for destructive actions. The
 * ghost `outline` tone adds a hairline edge and `tinted` a light fill.
 * `tile` is a dashed, card-sized add action, such as "Add payment card".
 */
interface ButtonTones {
  primary:
    | "burned-orange"
    | "burned-orange-ink"
    | "navy-blue"
    | "chilean-fire"
    | "danger";
  secondary: "navy-blue" | "burned-orange" | "burned-orange-ink" | "inverse";
  ghost:
    | "navy-blue"
    | "muted"
    | "inverse"
    | "outline"
    | "tinted"
    | "success"
    | "warning"
    | "danger";
  link: "burned-orange" | "inverse";
  tile: "muted";
}

type ButtonVariant = keyof ButtonTones;

type ButtonAppearance =
  | { readonly variant?: undefined; readonly tone?: ButtonTones["primary"] }
  | {
      [Variant in ButtonVariant]: {
        readonly variant: Variant;
        readonly tone?: ButtonTones[Variant];
      };
    }[ButtonVariant];

const defaultTones = {
  primary: "burned-orange",
  secondary: "navy-blue",
  ghost: "navy-blue",
  link: "burned-orange",
  tile: "muted",
} as const satisfies { [Variant in ButtonVariant]: ButtonTones[Variant] };

const buttonClasses = cva(
  "cursor-pointer inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-burned-orange focus-visible:ring-offset-2 disabled:pointer-events-none disabled:bg-none disabled:opacity-50 disabled:shadow-none",
  {
    variants: {
      variant: {
        primary:
          "bg-linear-to-b from-white/15 to-transparent px-6 py-3 shadow-button-raised active:translate-y-px active:shadow-button-pressed",
        secondary:
          "border bg-white bg-linear-to-b from-transparent to-navy-blue/4 px-6 py-3 shadow-button-raised-subtle active:translate-y-px active:shadow-button-pressed-subtle",
        ghost: "px-3 py-2",
        link: "underline underline-offset-4",
        tile: "flex-col gap-3 border border-dashed bg-[#fbfcfd] text-center",
      },
      tone: {
        "burned-orange": "",
        "burned-orange-ink": "",
        "chilean-fire": "",
        danger: "",
        inverse: "",
        muted: "",
        "navy-blue": "",
        outline: "",
        success: "",
        tinted: "",
        warning: "",
      },
      size: {
        xs: "h-7 min-h-7 px-3 py-1",
        sm: "h-9 min-h-9 px-4 text-xs",
        md: "h-10 min-h-10 px-4 text-xs",
        default: "h-11 min-h-11",
        lg: "h-12 min-h-12 px-6",
        xl: "h-13 min-h-13 px-6",
        "2xl": "h-14 min-h-14 px-8 text-base",
        "icon-xs": "size-6 min-h-6 p-0",
        "icon-sm": "size-8 min-h-8 p-0",
        icon: "size-10 min-h-10 p-0",
        "icon-lg": "size-11 min-h-11 p-0",
      },
      shape: {
        pill: "rounded-full",
        rounded: "rounded-xl",
      },
      caps: {
        true: "uppercase tracking-[0.08em]",
        false: "",
      },
      wrap: {
        true: "h-auto min-w-0 max-w-full whitespace-normal py-2 text-center leading-5",
        false: "",
      },
      fullWidth: {
        true: "w-full",
        false: "",
      },
    },
    compoundVariants: [
      {
        variant: "primary",
        tone: "burned-orange",
        class:
          "bg-burned-orange text-white [--button-tint:var(--color-burned-orange)] hover:bg-burned-orange/90",
      },
      {
        variant: "primary",
        tone: "burned-orange-ink",
        class:
          "bg-burned-orange-ink text-white [--button-tint:var(--color-burned-orange-ink)] hover:bg-burned-orange-ink/90",
      },
      {
        variant: "primary",
        tone: "navy-blue",
        class:
          "bg-navy-blue text-white [--button-tint:var(--color-navy-blue)] hover:bg-navy-blue/90",
      },
      {
        variant: "primary",
        tone: "chilean-fire",
        class:
          "bg-chilean-fire text-navy-blue [--button-tint:var(--color-chilean-fire)] hover:bg-chilean-fire/90",
      },
      {
        variant: "primary",
        tone: "danger",
        class:
          "bg-red-800 text-white [--button-tint:var(--color-red-800)] hover:bg-red-900",
      },
      {
        variant: "secondary",
        tone: "navy-blue",
        class: "border-navy-blue/20 text-navy-blue hover:border-navy-blue/50",
      },
      {
        variant: "secondary",
        tone: "burned-orange",
        class:
          "border-burned-orange bg-white/92 text-burned-orange hover:border-navy-blue/50 hover:bg-white",
      },
      {
        variant: "secondary",
        tone: "burned-orange-ink",
        class:
          "border-burned-orange/25 text-burned-orange-ink hover:border-burned-orange",
      },
      {
        variant: "secondary",
        tone: "inverse",
        class: "border-white/12 text-navy-blue hover:bg-sunset-yellow",
      },
      {
        variant: "ghost",
        tone: "navy-blue",
        class: "text-navy-blue hover:bg-navy-blue/5",
      },
      {
        variant: "ghost",
        tone: "muted",
        class: "text-navy-blue/60 hover:bg-navy-blue/5",
      },
      {
        variant: "ghost",
        tone: "inverse",
        class:
          "border border-white/12 bg-white/6 text-white hover:bg-white/12 hover:text-white",
      },
      {
        variant: "ghost",
        tone: "outline",
        class: "border border-navy-blue/14 text-navy-blue hover:bg-navy-blue/5",
      },
      {
        variant: "ghost",
        tone: "tinted",
        class: "bg-navy-blue/5 text-navy-blue hover:bg-burned-orange/10",
      },
      {
        variant: "ghost",
        tone: "success",
        class: "text-emerald-800 hover:bg-emerald-50",
      },
      {
        variant: "ghost",
        tone: "warning",
        class: "text-amber-800 hover:bg-amber-50",
      },
      {
        variant: "ghost",
        tone: "danger",
        class: "text-rose-700 hover:bg-rose-50 hover:text-rose-800",
      },
      {
        variant: "link",
        tone: "burned-orange",
        class: "text-burned-orange hover:text-chilean-fire",
      },
      {
        variant: "link",
        tone: "inverse",
        class: "text-white/82 hover:text-white",
      },
      {
        variant: "tile",
        tone: "muted",
        class: "border-[#cbd7e5] text-[#53657f] hover:border-[#a9b8cb]",
      },
      { size: "xl", caps: true, class: "tracking-[0.18em]" },
      {
        variant: "link",
        class: "h-auto min-h-0 rounded-none px-0 py-0",
      },
      {
        variant: "tile",
        class:
          "h-auto min-h-36 w-full min-w-0 whitespace-normal rounded-2xl px-4 py-6",
      },
    ],
    defaultVariants: {
      variant: "primary",
      size: "default",
      shape: "pill",
      caps: false,
      wrap: false,
      fullWidth: false,
    },
  }
);

type ButtonSize =
  | "xs"
  | "sm"
  | "md"
  | "default"
  | "lg"
  | "xl"
  | "2xl"
  | "icon-xs"
  | "icon-sm"
  | "icon"
  | "icon-lg";

type ButtonStyleOptions = ButtonAppearance & {
  /**
   * Height, padding and type scale. `icon*` sizes are square; `icon-xs` fits
   * inside a chip, such as a recipient's remove action.
   */
  readonly size?: ButtonSize;
  /** `pill` (default) is fully round; `rounded` uses the card radius. */
  readonly shape?: "pill" | "rounded";
  /** Uppercase, letter-spaced label, as used by marketing and form CTAs. */
  readonly caps?: boolean;
  /** Lets a long label wrap onto several lines instead of overflowing. */
  readonly wrap?: boolean;
  /** Stretches the button to its container's width. */
  readonly fullWidth?: boolean;
};

/**
 * Class names for an element that must look like a Button but can't render
 * one, such as react-day-picker's navigation. Prefer `<Button asChild>`.
 */
function buttonVariants({
  variant = "primary",
  tone,
  ...options
}: ButtonStyleOptions = {}) {
  return cn(
    buttonClasses({ variant, tone: tone ?? defaultTones[variant], ...options })
  );
}

/**
 * `AsChild` is `true` when the Button styles its child element (usually a
 * link). `pending` relies on the native `disabled` state, which links don't
 * have, so only a rendered `<button>` can be pending.
 */
type ButtonProps<AsChild extends boolean = false> = Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  "className"
> &
  ButtonStyleOptions & {
    /** Renders the child element (usually a link) with the Button's styling. */
    readonly asChild?: AsChild;
    /**
     * Marks an action in progress: disables the button and sets `aria-busy`.
     * Callers keep their own pending label.
     */
    readonly pending?: [AsChild] extends [false] ? boolean : never;
    readonly ref?: React.Ref<HTMLButtonElement>;
    /**
     * Parent layout only: margin; self, grid, order, flex-item and snap
     * placement (`shrink-0`, `flex-1`, `snap-start`); position, inset and
     * z-index; `hidden` and `group`; and width or display under a breakpoint
     * or container variant (`sm:w-auto`, `md:inline-flex`). Express colour,
     * size, radius, typography and states through the props above instead.
     * The `no-button-restyling` lint rule enforces this list.
     */
    readonly className?: string;
  };

/**
 * The Workspace action button: CTAs, submits, icon-only actions and links
 * styled as buttons (`asChild`). Controls with other semantics have their own
 * primitives: `NavItem` (current page), `SegmentedControl` (one of several
 * options), `ChoiceCard` (radio or checkbox card), `DisclosureButton`
 * (expands content) and `UnstyledButton` (custom visuals such as carousel dots
 * or image tiles).
 */
function Button<AsChild extends boolean = false>({
  asChild,
  caps,
  className,
  disabled,
  fullWidth,
  pending,
  ref,
  shape,
  size,
  tone,
  variant,
  wrap,
  ...props
}: ButtonProps<AsChild>) {
  const Comp = asChild ? Slot : "button";

  return (
    <Comp
      aria-busy={pending || undefined}
      className={cn(
        buttonVariants({
          caps,
          fullWidth,
          shape,
          size,
          wrap,
          ...({ variant, tone } as ButtonAppearance),
        }),
        className
      )}
      disabled={disabled || pending}
      ref={ref}
      {...props}
    />
  );
}

export type { ButtonProps };
export { Button, buttonVariants };
