"use client";

import { Clock } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
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
  readonly onSelectableValueChange?: (value: string) => void;
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

const getMinimumSelectableDate = (
  minimum: Temporal.PlainDateTime | undefined,
  preserveValueBeforeMinimum: boolean,
  timeMode: NonNullable<ReservationDateTimePickerProps["timeMode"]>
) => {
  if (!minimum) return undefined;

  return timeMode === "midnight" &&
    !preserveValueBeforeMinimum &&
    !minimum.toPlainTime().equals(Temporal.PlainTime.from("00:00"))
    ? minimum.toPlainDate().add({ days: 1 })
    : minimum.toPlainDate();
};

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
  onSelectableValueChange,
  placeholder = "Pick date and time",
  preserveValueBeforeMinimum = false,
  timeMode = "selectable",
  timeStepMinutes = 1,
  timeLabel,
  value,
  variant = "default",
}: ReservationDateTimePickerProps) {
  const dateTime = useMemo(() => parsePlainDateTime(value), [value]);
  const [pendingTime, setPendingTime] = useState<string>(
    () =>
      dateTime?.toPlainTime().toString({ smallestUnit: "minute" }) ??
      defaultTime
  );
  const pendingDate = useRef(dateTime?.toPlainDate());
  const previousTimeMode = useRef(timeMode);
  const minimumDateTime = resolveMinimumDateTime(minimum);
  const minimumDateTimeValue = minimumDateTime?.toString();
  const minimumSelectableDate = getMinimumSelectableDate(
    minimumDateTime,
    preserveValueBeforeMinimum,
    timeMode
  );
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
    const priorTimeMode = previousTimeMode.current;
    previousTimeMode.current = timeMode;
    const currentMinimum = parsePlainDateTime(minimumDateTimeValue);

    if (timeMode === "midnight" && dateTime) {
      if (priorTimeMode === "selectable") {
        pendingDate.current = dateTime.toPlainDate();
        onSelectableValueChange?.(
          dateTime.toString({ smallestUnit: "minute" })
        );
      }
      const currentMinimumDate = getMinimumSelectableDate(
        currentMinimum,
        preserveValueBeforeMinimum,
        timeMode
      );
      const normalizedDate =
        currentMinimumDate &&
        Temporal.PlainDate.compare(dateTime.toPlainDate(), currentMinimumDate) <
          0
          ? currentMinimumDate
          : dateTime.toPlainDate();
      const normalizedDateTime = normalizedDate.toPlainDateTime();

      if (!dateTime.equals(normalizedDateTime)) {
        onChange?.(normalizedDateTime.toString({ smallestUnit: "minute" }));
      }
      return;
    }

    if (timeMode === "selectable" && dateTime) {
      const currentTime = dateTime
        .toPlainTime()
        .toString({ smallestUnit: "minute" });

      if (priorTimeMode === "midnight" && currentTime === "00:00") {
        const restoredDateTime = (
          pendingDate.current ?? dateTime.toPlainDate()
        ).toPlainDateTime(Temporal.PlainTime.from(pendingTime));
        const normalizedDateTime =
          currentMinimum &&
          !preserveValueBeforeMinimum &&
          Temporal.PlainDateTime.compare(restoredDateTime, currentMinimum) < 0
            ? currentMinimum
            : restoredDateTime;

        if (!dateTime.equals(normalizedDateTime)) {
          onChange?.(normalizedDateTime.toString({ smallestUnit: "minute" }));
        }
        onSelectableValueChange?.(
          normalizedDateTime.toString({ smallestUnit: "minute" })
        );
        return;
      }

      pendingDate.current = dateTime.toPlainDate();
      setPendingTime(currentTime);
      onSelectableValueChange?.(dateTime.toString({ smallestUnit: "minute" }));
    }

    if (
      timeMode === "selectable" &&
      dateTime &&
      currentMinimum &&
      !preserveValueBeforeMinimum &&
      Temporal.PlainDateTime.compare(dateTime, currentMinimum) < 0
    ) {
      onChange?.(currentMinimum.toString({ smallestUnit: "minute" }));
    }
  }, [
    dateTime,
    minimumDateTimeValue,
    onChange,
    onSelectableValueChange,
    pendingTime,
    preserveValueBeforeMinimum,
    timeMode,
  ]);

  return (
    <div className={cn("grid gap-3", className)}>
      <ReservationDatePicker
        ariaLabel={dateLabel}
        displayValue={displayValue}
        locale={locale}
        minimum={minimumSelectableDate?.toString()}
        name={name}
        onChange={(date) => {
          const plainDate = Temporal.PlainDate.from(date);
          pendingDate.current = plainDate;
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
          const nextValue = formatDateTimeValue({ date: plainDate, time });

          onSelectableValueChange?.(
            formatDateTimeValue({
              date: plainDate,
              time: timeMode === "midnight" ? pendingTime : time,
            })
          );
          onChange?.(nextValue);
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
                  const nextValue = formatDateTimeValue({
                    date: selectedDate,
                    time,
                  });
                  onSelectableValueChange?.(nextValue);
                  onChange?.(nextValue);
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
