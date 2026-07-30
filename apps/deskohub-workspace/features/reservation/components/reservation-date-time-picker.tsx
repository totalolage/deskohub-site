"use client";

import { Clock } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Input } from "@/shared/components/ui/input";
import { cn } from "@/shared/utils";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";
import { ReservationDatePicker } from "./reservation-date-picker";

type ReservationDateTimePickerProps = {
  readonly dateLabel: string;
  readonly className?: string;
  readonly locale?: string;
  readonly minimum?: string | (() => string);
  readonly name?: string;
  readonly onBlur?: () => void;
  readonly onChange?: (value: string) => void;
  readonly placeholder?: string;
  readonly preserveValueBeforeMinimum?: boolean;
  readonly timeMode?: "selectable" | "midnight";
  readonly timeStepMinutes?: number;
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
  minimum: ReservationDateTimePickerProps["minimum"]
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

const getFormatterDate = (date: Temporal.PlainDate) =>
  new Date(Date.UTC(date.year, date.month - 1, date.day, 12));

export function ReservationDateTimePicker({
  className,
  dateLabel,
  locale,
  minimum,
  name,
  onBlur,
  onChange,
  placeholder = "Pick date and time",
  preserveValueBeforeMinimum = false,
  timeMode = "selectable",
  timeStepMinutes = 1,
  timeLabel,
  value,
  variant = "default",
}: ReservationDateTimePickerProps) {
  const dateTime = useMemo(() => parsePlainDateTime(value), [value]);
  const [pendingTime, setPendingTime] = useState<string>(defaultTime);
  const minimumDateTime = resolveMinimumDateTime(minimum);
  const selectedDate = dateTime?.toPlainDate();
  const selectedTime =
    dateTime?.toPlainTime().toString({ smallestUnit: "minute" }) ?? pendingTime;
  const resolvedTimeStepMinutes = Math.max(1, Math.trunc(timeStepMinutes));
  const selectedDateMinimumTime = getMinimumTimeForDate(
    selectedDate,
    minimumDateTime
  );
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
    ? dateFormatter.format(getFormatterDate(selectedDate))
    : placeholder;

  useEffect(() => {
    if (
      timeMode === "midnight" &&
      dateTime &&
      !dateTime.toPlainTime().equals(Temporal.PlainTime.from("00:00"))
    ) {
      onChange?.(
        dateTime
          .toPlainDate()
          .toPlainDateTime()
          .toString({ smallestUnit: "minute" })
      );
      return;
    }

    const currentMinimum = resolveMinimumDateTime(minimum);
    if (
      timeMode === "selectable" &&
      dateTime &&
      currentMinimum &&
      !preserveValueBeforeMinimum &&
      Temporal.PlainDateTime.compare(dateTime, currentMinimum) < 0
    ) {
      onChange?.(currentMinimum.toString({ smallestUnit: "minute" }));
    }
  }, [dateTime, minimum, onChange, preserveValueBeforeMinimum, timeMode]);

  return (
    <div className={cn("grid gap-3", className)}>
      <ReservationDatePicker
        ariaLabel={dateLabel}
        displayValue={displayValue}
        locale={locale}
        minimum={minimumDateTime?.toPlainDate().toString()}
        name={name}
        onChange={(date) => {
          const plainDate = Temporal.PlainDate.from(date);
          const currentMinimumDateTime = resolveMinimumDateTime(minimum);
          const minimumTime =
            timeMode === "selectable"
              ? getMinimumTimeForDate(plainDate, currentMinimumDateTime)
              : undefined;
          const time =
            timeMode === "midnight"
              ? "00:00"
              : minimumTime && selectedTime < minimumTime
                ? minimumTime
                : selectedTime;

          onChange?.(formatDateTimeValue({ date: plainDate, time }));
        }}
        placeholder={placeholder}
        value={selectedDate?.toString()}
        variant={variant}
      />
      {timeMode === "selectable" && (
        <div className="relative">
          <Clock className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-burned-orange" />
          <Input
            aria-label={timeLabel}
            className="pl-11"
            onBlur={onBlur}
            onInput={(event) => {
              const input = event.currentTarget;
              const restoreSelectedTime = () => {
                input.value = selectedTime;
              };

              try {
                const time = Temporal.PlainTime.from(input.value).toString({
                  smallestUnit: "minute",
                });
                const parsedTime = Temporal.PlainTime.from(time);
                const minutesFromMidnight =
                  parsedTime.hour * 60 + parsedTime.minute;
                if (minutesFromMidnight % resolvedTimeStepMinutes !== 0) {
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

                setPendingTime(time);
                if (selectedDate) {
                  onChange?.(formatDateTimeValue({ date: selectedDate, time }));
                }
              } catch {
                restoreSelectedTime();
              }
            }}
            min={selectedDateMinimumTime}
            step={resolvedTimeStepMinutes * 60}
            type="time"
            value={selectedTime}
            variant={variant}
          />
        </div>
      )}
    </div>
  );
}
