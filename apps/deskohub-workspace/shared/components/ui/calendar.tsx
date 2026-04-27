"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import type * as React from "react";
import { DayPicker } from "react-day-picker";
import { buttonVariants } from "@/shared/components/ui/button";
import { cn } from "@/shared/utils";
import "react-day-picker/style.css";

export type CalendarProps = React.ComponentProps<typeof DayPicker>;

function Calendar({
  className,
  classNames,
  showOutsideDays = true,
  components,
  ...props
}: CalendarProps) {
  return (
    <DayPicker
      showOutsideDays={showOutsideDays}
      className={cn("p-2", className)}
      classNames={{
        root: "w-fit text-navy-blue",
        months: "flex flex-col gap-4",
        month: "space-y-4",
        month_caption: "flex h-9 items-center justify-center",
        caption_label: "text-sm font-semibold uppercase tracking-[0.12em]",
        nav: "absolute inset-x-4 top-5 flex items-center justify-between",
        button_previous: cn(
          buttonVariants({ variant: "ghost", size: "icon" }),
          "h-8 w-8 bg-navy-blue/5 p-0 hover:bg-burned-orange/10"
        ),
        button_next: cn(
          buttonVariants({ variant: "ghost", size: "icon" }),
          "h-8 w-8 bg-navy-blue/5 p-0 hover:bg-burned-orange/10"
        ),
        month_grid: "w-full border-collapse",
        weekdays: "flex",
        weekday:
          "w-9 rounded-md text-[0.72rem] font-semibold uppercase text-navy-blue/45",
        week: "mt-2 flex w-full",
        day: "h-9 w-9 p-0 text-center text-sm",
        day_button: cn(
          buttonVariants({ variant: "ghost" }),
          "h-9 w-9 rounded-xl p-0 font-normal hover:bg-sunset-yellow/25 aria-selected:bg-burned-orange aria-selected:text-white"
        ),
        today:
          "[&_.rdp-day_button]:border [&_.rdp-day_button]:border-sunset-yellow",
        outside: "text-navy-blue/28",
        disabled: "text-navy-blue/22 opacity-50",
        selected: "text-white",
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

export { Calendar };
