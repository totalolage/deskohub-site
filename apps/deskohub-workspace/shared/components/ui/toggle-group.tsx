"use client";

import * as TogglePrimitive from "@radix-ui/react-toggle";
import type * as React from "react";
import { cn } from "@/shared/utils";

type ToggleGroupOption<Value extends string | number> = {
  readonly value: Value;
  readonly label: React.ReactNode;
  /** Accessible name when the label alone is terse, such as `09` for 09:00. */
  readonly name?: string;
  readonly disabled?: boolean;
  /** Cell layout only, such as a column span. */
  readonly className?: string;
};

type ToggleGroupProps<Value extends string | number> = {
  /** Layout of the cells, such as a grid's columns. Defaults to a wrapping row. */
  readonly className?: string;
  /** Accessible group name. */
  readonly label: string;
  /** The id of text that describes the group, such as its error. */
  readonly describedBy?: string | undefined;
  readonly onValueChange: (value: Value[]) => void;
  readonly options: ReadonlyArray<ToggleGroupOption<Value>>;
  readonly value: readonly Value[];
};

/**
 * Picks any number of related values, such as the hours of a day, in one
 * bordered box. Each cell is a toggle button that announces its pressed
 * state; pressed cells take the SegmentedControl's checked treatment.
 * Changes report the pressed values in option order.
 */
function ToggleGroup<Value extends string | number>({
  className,
  describedBy,
  label,
  onValueChange,
  options,
  value,
}: ToggleGroupProps<Value>) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: a group of toggle buttons, not form fields
    <div
      role="group"
      aria-label={label}
      aria-describedby={describedBy}
      className={cn(
        "flex flex-wrap gap-1 rounded-lg border border-navy-blue/15 bg-white p-1",
        className
      )}
    >
      {options.map((option) => (
        <TogglePrimitive.Root
          key={option.value}
          pressed={value.includes(option.value)}
          disabled={option.disabled}
          aria-label={option.name}
          className={cn(
            "inline-flex h-8 min-w-0 cursor-pointer items-center justify-center whitespace-nowrap rounded-sm px-2 font-semibold text-navy-blue/75 text-xs transition-colors hover:bg-navy-blue/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-burned-orange focus-visible:ring-offset-1 disabled:cursor-not-allowed aria-pressed:bg-burned-orange aria-pressed:bg-linear-to-b aria-pressed:from-white/15 aria-pressed:to-transparent aria-pressed:text-white aria-pressed:shadow-button-raised",
            option.className
          )}
          onPressedChange={(pressed) =>
            onValueChange(
              options
                .map((candidate) => candidate.value)
                .filter((candidate) =>
                  candidate === option.value
                    ? pressed
                    : value.includes(candidate)
                )
            )
          }
        >
          {option.label}
        </TogglePrimitive.Root>
      ))}
    </div>
  );
}

export { ToggleGroup, type ToggleGroupOption };
