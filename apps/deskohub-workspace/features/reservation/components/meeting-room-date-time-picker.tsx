"use client";

import { CalendarIcon, Clock } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/shared/components/ui/button";
import { Calendar } from "@/shared/components/ui/calendar";
import { Input } from "@/shared/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/shared/components/ui/popover";
import { cn } from "@/shared/utils";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";

type MeetingRoomDateTimePickerProps = {
  readonly dateLabel: string;
  readonly className?: string;
  readonly locale?: string;
  readonly minimum?: string | (() => string);
  readonly name?: string;
  readonly onBlur?: () => void;
  readonly onChange?: (value: string) => void;
  readonly placeholder?: string;
  readonly preserveValueBeforeMinimum?: boolean;
  readonly timeLabel: string;
  readonly value?: string;
  readonly variant?: "default" | "error";
};

const defaultTime = workspaceSiteConstants.reservation.defaultStartTime;

const parsePlainDateTime = (value: string | undefined) => {
  if (!value) return undefined;

  try {
    return Temporal.PlainDateTime.from(value);
  } catch {
    return undefined;
  }
};

const resolveMinimumDateTime = (
  minimum: MeetingRoomDateTimePickerProps["minimum"]
) => parsePlainDateTime(typeof minimum === "function" ? minimum() : minimum);

const getMinimumTimeForDate = (
  date: Temporal.PlainDate | undefined,
  minimum: ReturnType<typeof Temporal.PlainDateTime.from> | undefined
) =>
  date &&
  minimum &&
  Temporal.PlainDate.compare(date, minimum.toPlainDate()) === 0
    ? minimum.toPlainTime().toString({ smallestUnit: "minute" })
    : undefined;

const formatDateTimeValue = ({
  date,
  time,
}: {
  readonly date: Temporal.PlainDate;
  readonly time: string;
}) => `${date.toString()}T${time}`;

const getCalendarDate = (date: Temporal.PlainDate) =>
  new Date(date.year, date.month - 1, date.day, 12);

const getFormatterDate = (date: Temporal.PlainDate) =>
  new Date(Date.UTC(date.year, date.month - 1, date.day, 12));

const getPlainDateFromCalendar = (date: Date) =>
  Temporal.PlainDate.from({
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
  });

export function MeetingRoomDateTimePicker({
  className,
  dateLabel,
  locale,
  minimum,
  name,
  onBlur,
  onChange,
  placeholder = "Pick date and time",
  preserveValueBeforeMinimum = false,
  timeLabel,
  value,
  variant = "default",
}: MeetingRoomDateTimePickerProps) {
  const [open, setOpen] = useState(false);
  const dateTime = parsePlainDateTime(value);
  const minimumDateTime = resolveMinimumDateTime(minimum);
  const minimumDate = minimumDateTime?.toPlainDate();
  const selectedDate = dateTime?.toPlainDate();
  const selectedTime =
    dateTime?.toPlainTime().toString({ smallestUnit: "minute" }) ?? defaultTime;
  const selectedDateMinimumTime = getMinimumTimeForDate(
    selectedDate,
    minimumDateTime
  );
  const selectedCalendarDate = selectedDate
    ? getCalendarDate(selectedDate)
    : undefined;
  const dateFormatter = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        day: "numeric",
        month: "long",
        timeZone: "UTC",
        year: "numeric",
      }),
    [locale]
  );
  const displayValue = selectedDate
    ? `${dateFormatter.format(getFormatterDate(selectedDate))} ${selectedTime}`
    : placeholder;
  const minimumCalendarDate = minimumDate
    ? getCalendarDate(minimumDate)
    : undefined;
  const calendarDisabled = minimumCalendarDate
    ? { before: minimumCalendarDate }
    : undefined;

  useEffect(() => {
    const currentMinimum = resolveMinimumDateTime(minimum);
    if (
      dateTime &&
      currentMinimum &&
      !preserveValueBeforeMinimum &&
      Temporal.PlainDateTime.compare(dateTime, currentMinimum) < 0
    ) {
      onChange?.(currentMinimum.toString({ smallestUnit: "minute" }));
    }
  }, [dateTime, minimum, onChange, preserveValueBeforeMinimum]);

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
            aria-label={dateLabel}
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
            disabled={calendarDisabled}
            mode="single"
            onSelect={(date) => {
              const plainDate = date
                ? getPlainDateFromCalendar(date)
                : undefined;

              if (!plainDate) return;

              const currentMinimumDateTime = resolveMinimumDateTime(minimum);
              if (
                currentMinimumDateTime &&
                Temporal.PlainDate.compare(
                  plainDate,
                  currentMinimumDateTime.toPlainDate()
                ) < 0
              ) {
                return;
              }

              const minimumTime = getMinimumTimeForDate(
                plainDate,
                currentMinimumDateTime
              );
              const time =
                minimumTime && selectedTime < minimumTime
                  ? minimumTime
                  : selectedTime;

              onChange?.(formatDateTimeValue({ date: plainDate, time }));
              setOpen(false);
            }}
            selected={selectedCalendarDate}
          />
        </PopoverContent>
      </Popover>
      <div className="relative">
        <Clock className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-burned-orange" />
        <Input
          aria-label={timeLabel}
          className="pl-11"
          disabled={!selectedDate}
          onBlur={onBlur}
          onInput={(event) => {
            if (!selectedDate) return;
            const input = event.currentTarget;
            const restoreSelectedTime = () => {
              input.value = selectedTime;
            };

            try {
              const time = Temporal.PlainTime.from(input.value).toString({
                smallestUnit: "minute",
              });
              if (!time.endsWith(":00")) {
                restoreSelectedTime();
                return;
              }
              const currentMinimumTime = getMinimumTimeForDate(
                selectedDate,
                resolveMinimumDateTime(minimum)
              );
              if (currentMinimumTime && time < currentMinimumTime) {
                restoreSelectedTime();
                return;
              }

              onChange?.(
                formatDateTimeValue({
                  date: selectedDate,
                  time,
                })
              );
            } catch {
              restoreSelectedTime();
            }
          }}
          min={selectedDateMinimumTime}
          step={3600}
          type="time"
          value={selectedTime}
          variant={variant}
        />
      </div>
    </div>
  );
}
