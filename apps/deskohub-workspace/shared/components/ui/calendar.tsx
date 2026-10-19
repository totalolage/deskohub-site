"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import type * as React from "react";
import { DayPicker } from "react-day-picker";
import { cs, enUS } from "react-day-picker/locale";
import { buttonVariants } from "@/shared/components/ui/button";
import { cn } from "@/shared/utils";
import "react-day-picker/style.css";

export type CalendarProps = Omit<
  React.ComponentProps<typeof DayPicker>,
  "locale"
> & {
  /** The site locale; month, weekday, and day names follow it. */
  readonly locale?: string;
};

export function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  components,
  locale,
  ...props
}: CalendarProps) {
  return (
    <DayPicker
      locale={locale === "cs-CZ" ? cs : enUS}
      showOutsideDays={showOutsideDays}
      className={cn("p-2", className)}
      classNames={{
        root: "w-fit text-navy-blue",
        months: "flex flex-col gap-4",
        month: "space-y-4",
        month_caption: "flex h-9 items-center justify-center",
        caption_label: "text-sm font-semibold uppercase tracking-[0.12em]",
        nav: "absolute inset-x-4 top-5 flex items-center justify-between",
        button_previous: buttonVariants({
          variant: "ghost",
          tone: "tinted",
          size: "icon-sm",
        }),
        button_next: buttonVariants({
          variant: "ghost",
          tone: "tinted",
          size: "icon-sm",
        }),
        month_grid: "w-full border-collapse",
        weekdays: "flex",
        weekday:
          "w-9 rounded-md text-[0.72rem] font-semibold uppercase text-navy-blue/65",
        week: "mt-2 flex w-full",
        day: "h-9 w-9 p-0 text-center text-sm",
        day_button:
          "inline-flex size-9 cursor-pointer items-center justify-center rounded-xl text-sm text-navy-blue transition-colors hover:bg-sunset-yellow/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-burned-orange focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
        today:
          "[&_.rdp-day_button]:border [&_.rdp-day_button]:border-sunset-yellow",
        outside: "text-navy-blue/28",
        disabled: "text-navy-blue/22 opacity-50",
        // react-day-picker marks the day cell, not its button, as selected.
        selected:
          "[&_.rdp-day_button]:bg-burned-orange [&_.rdp-day_button]:text-white [&_.rdp-day_button]:hover:bg-burned-orange",
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation }) =>
          orientation === "left" ? (
            <ChevronLeft className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          ),
        ...components,
      }}
      {...props}
    />
  );
}
