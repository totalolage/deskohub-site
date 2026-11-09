import type * as React from "react";
import { cn } from "@/shared/utils";

type SegmentedControlOption<Value extends string> = {
  readonly label: React.ReactNode;
  readonly value: Value;
};

type SegmentedControlProps<Value extends string> = {
  /** Parent layout only, as for `Button`. */
  readonly className?: string;
  readonly disabled?: boolean;
  /** Accessible group name, rendered as a visually hidden legend. */
  readonly label: string;
  /** Radio group name; unique within the form. */
  readonly name: string;
  readonly onValueChange: (value: Value) => void;
  readonly options: ReadonlyArray<SegmentedControlOption<Value>>;
  /** `sm` sits inline in dense rows, such as a filter sentence or a panel header. */
  readonly size?: "default" | "sm";
  readonly value: Value;
};

/**
 * Picks one of a few mutually exclusive modes, such as an existing or a new
 * customer. Each segment is a native radio, so the group announces as a radio
 * group with arrow-key navigation; the checked segment uses the primary
 * Button treatment.
 */
function SegmentedControl<Value extends string>({
  className,
  disabled,
  label,
  name,
  onValueChange,
  options,
  size = "default",
  value,
}: SegmentedControlProps<Value>) {
  return (
    <fieldset
      className={cn(
        "inline-flex bg-navy-blue/5 disabled:opacity-50",
        { default: "rounded-lg p-1", sm: "rounded-md p-0.5" }[size],
        className
      )}
      disabled={disabled}
    >
      <legend className="sr-only">{label}</legend>
      {options.map((option) => (
        <label
          className={cn(
            "relative inline-flex cursor-pointer items-center justify-center whitespace-nowrap rounded-sm text-xs font-semibold text-navy-blue transition-colors hover:bg-navy-blue/5 has-checked:bg-burned-orange has-checked:bg-linear-to-b has-checked:from-white/15 has-checked:to-transparent has-checked:text-white has-checked:shadow-button-raised has-checked:[--button-tint:var(--color-burned-orange)] has-focus-visible:ring-2 has-focus-visible:ring-burned-orange has-focus-visible:ring-offset-2 has-disabled:cursor-not-allowed",
            { default: "h-9 px-4", sm: "h-7 px-3" }[size]
          )}
          key={option.value}
        >
          <input
            checked={option.value === value}
            className="sr-only"
            disabled={disabled}
            name={name}
            onChange={() => onValueChange(option.value)}
            type="radio"
            value={option.value}
          />
          {option.label}
        </label>
      ))}
    </fieldset>
  );
}

export { SegmentedControl };
