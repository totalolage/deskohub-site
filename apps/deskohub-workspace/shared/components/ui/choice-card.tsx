import { cva } from "class-variance-authority";
import type * as React from "react";
import { cn } from "@/shared/utils";

const choiceCardVariants = cva(
  "flex cursor-pointer gap-3 rounded-xl border p-4 text-navy-blue accent-burned-orange transition-colors has-checked:border-burned-orange has-checked:ring-2 has-checked:ring-burned-orange/15 has-aria-checked:border-burned-orange has-aria-checked:ring-2 has-aria-checked:ring-burned-orange/15 has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-burned-orange has-disabled:cursor-not-allowed has-disabled:opacity-70",
  {
    variants: {
      tone: {
        neutral: "border-navy-blue/10 bg-navy-blue/2.5",
        plain: "border-navy-blue/15 bg-white",
        warning:
          "border-burned-orange/25 bg-burned-orange/5 text-sm leading-6 text-navy-blue/70",
      },
      align: {
        start: "items-start",
        center: "items-center",
      },
    },
    defaultVariants: { tone: "neutral", align: "start" },
  }
);

type ChoiceCardProps = Omit<
  React.LabelHTMLAttributes<HTMLLabelElement>,
  "className"
> & {
  /** Aligns the control with the first line (`start`) or the middle. */
  readonly align?: "start" | "center";
  /** Parent layout only, as for `Button`. */
  readonly className?: string;
  readonly ref?: React.Ref<HTMLLabelElement>;
  /** `neutral` tinted, `plain` white, `warning` for consequential choices. */
  readonly tone?: "neutral" | "plain" | "warning";
};

/**
 * A card-sized label around one radio or checkbox (native or the shared
 * `Checkbox`). The input keeps its own semantics; clicking anywhere on the
 * card toggles it, and the card shows checked, focus and disabled states.
 */
function ChoiceCard({
  align,
  className,
  ref,
  tone,
  ...props
}: ChoiceCardProps) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: callers nest the control.
    <label
      className={cn(choiceCardVariants({ align, tone }), className)}
      ref={ref}
      {...props}
    />
  );
}

export { ChoiceCard };
