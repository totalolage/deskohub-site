"use client";

import { CalendarIcon, Clock } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/shared/components/ui/button";
import { Calendar, type CalendarProps } from "@/shared/components/ui/calendar";
import { Input } from "@/shared/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/shared/components/ui/popover";
import { cn } from "@/shared/utils";
import {
  dateToTemporalPlainDate,
  temporalPlainDateToDate,
} from "@/shared/utils/temporal";

type DateTimePickerProps = {
  readonly className?: string;
  readonly disabled?: CalendarProps["disabled"];
  readonly locale?: string;
  readonly name?: string;
  readonly onBlur?: () => void;
  readonly onChange?: (value: string) => void;
  readonly placeholder?: string;
  readonly timeZone?: string;
  readonly value?: string;
  readonly variant?: "default" | "error";
};

const defaultTimeZone = "Europe/Prague";
const defaultTime = "10:00";

const parsePlainDateTime = (value: string | undefined) => {
  if (!value) return undefined;

  try {
    return Temporal.PlainDateTime.from(value);
  } catch {
    return undefined;
  }
};

const formatDateTimeValue = ({
  date,
  time,
}: {
  readonly date: Temporal.PlainDate;
  readonly time: string;
}) => `${date.toString()}T${time}`;

export function DateTimePicker({
  className,
  disabled,
  locale,
  name,
  onBlur,
  onChange,
  placeholder = "Pick date and time",
  timeZone = defaultTimeZone,
  value,
  variant = "default",
}: DateTimePickerProps) {
  const [open, setOpen] = useState(false);
  const dateTime = parsePlainDateTime(value);
  const selectedDate = dateTime?.toPlainDate();
  const selectedTime =
    dateTime?.toPlainTime().toString({ smallestUnit: "minute" }) ?? defaultTime;
  const selectedCalendarDate = selectedDate
    ? temporalPlainDateToDate({
        date: selectedDate,
        plainTime: Temporal.PlainTime.from("12:00"),
        timeZone,
      })
    : undefined;
  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        day: "numeric",
        month: "long",
        timeZone,
        year: "numeric",
      }),
    [locale, timeZone]
  );
  const displayValue = selectedDate
    ? `${dateFormatter.format(selectedCalendarDate)} ${selectedTime}`
    : placeholder;

  return (
    <div className={cn("grid gap-3", className)}>
      {name && (
        <input
          name={name}
          onChange={(event) => onChange?.(event.currentTarget.value)}
          type="hidden"
          value={value ?? ""}
        />
      )}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            className={cn(
              "h-13 w-full justify-start rounded-[1.1rem] border-navy-blue/12 bg-white px-4 py-3 text-left text-base font-normal text-navy-blue hover:border-burned-orange/45",
              !selectedDate && "text-navy-blue/44",
              variant === "error" && "border-burned-orange"
            )}
            type="button"
            variant="secondary"
          >
            <CalendarIcon className="h-5 w-5 text-burned-orange" />
            {displayValue}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto p-3">
          <Calendar
            disabled={disabled}
            mode="single"
            onSelect={(date) => {
              const plainDate = date
                ? dateToTemporalPlainDate({ date, timeZone })
                : undefined;

              if (!plainDate) return;

              onChange?.(
                formatDateTimeValue({ date: plainDate, time: selectedTime })
              );
              setOpen(false);
            }}
            selected={selectedCalendarDate}
          />
        </PopoverContent>
      </Popover>
      <div className="relative">
        <Clock className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-burned-orange" />
        <Input
          className="pl-11"
          disabled={!selectedDate}
          onBlur={onBlur}
          onChange={(event) => {
            if (!selectedDate) return;

            try {
              onChange?.(
                formatDateTimeValue({
                  date: selectedDate,
                  time: Temporal.PlainTime.from(
                    event.currentTarget.value
                  ).toString({ smallestUnit: "minute" }),
                })
              );
            } catch {
              // Keep the last valid value while the browser input is transiently empty.
            }
          }}
          step={3600}
          type="time"
          value={selectedTime}
          variant={variant}
        />
      </div>
    </div>
  );
}
