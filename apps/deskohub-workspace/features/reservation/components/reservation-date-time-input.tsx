"use client";

import { type SyntheticEvent, useReducer, useState } from "react";
import { DateInput } from "@/shared/components/date-time/date-input";
import {
  getSameDayTimeBound,
  parsePlainDate,
  resolvePlainDateTimeBound,
  type TemporalBoundInput,
} from "@/shared/components/date-time/temporal-parts";
import { TimeInput } from "@/shared/components/date-time/time-input";
import { useFormField } from "@/shared/components/ui/form";
import { cn } from "@/shared/utils";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";
import { getReservationAccessibleLabel } from "./reservation-date-input";

const defaultStartTime = workspaceSiteConstants.reservation.defaultStartTime;

export type ReservationDateTimeInputProps = {
  readonly ariaDescribedBy?: string;
  readonly ariaInvalid?: boolean;
  readonly className?: string;
  readonly dateLabel: string;
  readonly disabled?: boolean;
  readonly id?: string;
  readonly isDateDisabled?: (date: Temporal.PlainDate) => boolean;
  readonly locale?: string;
  readonly minimum?: TemporalBoundInput;
  readonly name?: string;
  readonly onBlur?: () => void;
  readonly onChange?: (value: string | undefined) => void;
  readonly placeholder?: string;
  readonly required?: boolean;
  readonly showTime?: boolean;
  readonly timeLabel: string;
  readonly timeStepMinutes?: number;
  readonly value?: string;
};

export type ReservationFormDateTimeInputProps = Omit<
  ReservationDateTimeInputProps,
  "ariaDescribedBy" | "ariaInvalid" | "required"
>;

const splitDateTime = (value: string | undefined) => {
  const [dateSegment = "", timeSegment = ""] = value?.split("T") ?? [];
  return { date: dateSegment || undefined, time: timeSegment || undefined };
};

/**
 * Reservation-family date-time field built on the shared date-time controls.
 * It owns the reservation-side policies the shared controls deliberately
 * omit: the default start time applied when a date is picked without a
 * time, the same-day minimum-time clamp when the date moves, and the
 * optional time-only (whole-day) presentation.
 */
export function ReservationDateTimeInput({
  ariaDescribedBy,
  ariaInvalid = false,
  className,
  dateLabel,
  disabled = false,
  id,
  isDateDisabled,
  locale,
  minimum,
  name,
  onBlur,
  onChange,
  placeholder,
  required = false,
  showTime = true,
  timeLabel,
  timeStepMinutes,
  value,
}: ReservationDateTimeInputProps) {
  const { date: selectedDate, time: committedTime } = splitDateTime(value);
  // The pending clock survives without a selected date and while the time
  // control is hidden, so a later date choice reuses the last chosen time.
  const [pendingTime, setPendingTime] = useState<string>(defaultStartTime);
  // Re-render the shared controls with the reasserted controlled value when
  // an edit is rejected against a freshly resolved dynamic bound.
  const [rejectedEdits, bumpRejectedEdits] = useReducer(
    (count: number) => count + 1,
    0
  );
  const selectedTime = committedTime ?? pendingTime;
  const minimumDateTime = resolvePlainDateTimeBound(minimum);
  const minimumTimeForSelectedDate = getSameDayTimeBound({
    date: parsePlainDate(selectedDate),
    dateTimeBound: minimumDateTime,
  });

  const handleDateChange = (nextDate: string | undefined) => {
    if (!nextDate) {
      setPendingTime(defaultStartTime);
      onChange?.(undefined);
      return;
    }

    // Dynamic minimum bounds are resolved at event time, never frozen at mount.
    const minimumTimeForNextDate = showTime
      ? getSameDayTimeBound({
          date: parsePlainDate(nextDate),
          dateTimeBound: resolvePlainDateTimeBound(minimum),
        })
      : undefined;
    const nextTime =
      minimumTimeForNextDate !== undefined &&
      selectedTime < minimumTimeForNextDate
        ? minimumTimeForNextDate
        : (selectedTime ?? defaultStartTime);
    setPendingTime(nextTime);
    onChange?.(`${nextDate}T${nextTime}`);
  };

  const handleTimeChange = (nextTime: string | undefined) => {
    // Clearing the time keeps the previously committed reservation start;
    // an incomplete canonical datetime never reaches the form.
    if (!nextTime) {
      bumpRejectedEdits();
      return;
    }
    const freshMinimumTimeForSelectedDate = getSameDayTimeBound({
      date: parsePlainDate(selectedDate),
      dateTimeBound: resolvePlainDateTimeBound(minimum),
    });
    if (
      freshMinimumTimeForSelectedDate !== undefined &&
      nextTime < freshMinimumTimeForSelectedDate
    ) {
      bumpRejectedEdits();
      return;
    }
    // Re-typing the displayed clock is a no-op, not a new reservation start.
    if (nextTime === selectedTime) return;
    setPendingTime(nextTime);
    if (selectedDate) onChange?.(`${selectedDate}T${nextTime}`);
  };

  // The shared time control keeps committed values for incomplete segmented
  // edits without resetting its editor; restore the reservation clock here so
  // the visible control never shows a cleared or partial start.
  const handleTimeInputCapture = (event: SyntheticEvent) => {
    const editor = event.target as HTMLInputElement;
    if (editor.type !== "time") return;
    if (!editor.validity.valid && selectedTime) editor.value = selectedTime;
  };

  return (
    <div className={cn("grid gap-3", className)}>
      <DateInput
        ariaDescribedBy={ariaDescribedBy}
        ariaInvalid={ariaInvalid}
        ariaLabel={getReservationAccessibleLabel({
          ariaLabel: dateLabel,
          locale,
          required,
        })}
        disabled={disabled}
        id={id}
        isDateDisabled={isDateDisabled}
        locale={locale}
        minimum={minimumDateTime?.toPlainDate().toString()}
        onChange={handleDateChange}
        placeholder={placeholder}
        required={required}
        value={selectedDate}
      />
      {showTime && (
        <div onInputCapture={handleTimeInputCapture}>
          <TimeInput
            key={rejectedEdits}
            ariaDescribedBy={ariaDescribedBy}
            ariaInvalid={ariaInvalid}
            ariaLabel={getReservationAccessibleLabel({
              ariaLabel: timeLabel,
              locale,
              required,
            })}
            disabled={disabled}
            id={id ? `${id}-time` : undefined}
            minimum={minimumTimeForSelectedDate}
            onBlur={onBlur}
            onChange={handleTimeChange}
            required={required}
            timeStepMinutes={timeStepMinutes}
            value={selectedTime}
          />
        </div>
      )}
      {name && (
        <input
          name={name}
          type="hidden"
          value={
            selectedDate && selectedTime
              ? `${selectedDate}T${selectedTime}`
              : ""
          }
        />
      )}
    </div>
  );
}

export function ReservationFormDateTimeInput(
  props: ReservationFormDateTimeInputProps
) {
  const { error, formItemId, formMessageId } = useFormField();

  return (
    <ReservationDateTimeInput
      {...props}
      ariaDescribedBy={error ? formMessageId : undefined}
      ariaInvalid={Boolean(error)}
      id={formItemId}
      required
    />
  );
}
