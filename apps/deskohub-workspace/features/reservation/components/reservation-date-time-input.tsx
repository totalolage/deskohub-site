"use client";

import { useState } from "react";
import { DateInput } from "@/shared/components/date-time/date-input";
import {
  formatMinuteDateTime,
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

const resolveMinimumDateTime = (minimum: TemporalBoundInput | undefined) =>
  resolvePlainDateTimeBound(minimum);

/**
 * Reservation-family date-time field built on the shared date-time controls.
 * It owns the reservation-side policies the shared controls deliberately
 * omit: the default start time applied when a date is picked without a
 * time, the same-day minimum-time clamp when the date moves, and the
 * optional time-only (whole-day) presentation. Dynamic minimum bounds are
 * always resolved at event time, never frozen at render.
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
  const selectedTime = committedTime ?? pendingTime;

  const minimumDate = () =>
    resolveMinimumDateTime(minimum)?.toPlainDate().toString();
  const minimumTimeForSelectedDate = () =>
    getSameDayTimeBound({
      date: parsePlainDate(selectedDate),
      dateTimeBound: resolveMinimumDateTime(minimum),
    });

  const handleDateChange = (nextDate: string | undefined) => {
    if (!nextDate) {
      setPendingTime(defaultStartTime);
      onChange?.(undefined);
      return;
    }

    // Validate the whole selected date against the freshly resolved bound:
    // a dynamic minimum may have advanced past the picked day without the
    // owning form re-rendering.
    const minimumDateTime = resolveMinimumDateTime(minimum);
    const nextPlainDate = parsePlainDate(nextDate);
    if (
      minimumDateTime &&
      nextPlainDate &&
      Temporal.PlainDate.compare(nextPlainDate, minimumDateTime.toPlainDate()) <
        0
    ) {
      return;
    }

    const minimumTimeForNextDate = showTime
      ? getSameDayTimeBound({
          date: nextPlainDate,
          dateTimeBound: minimumDateTime,
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
    // Clearing or rejecting the clock keeps the previously committed
    // reservation start; the shared editor restores its own display.
    if (!nextTime || nextTime === selectedTime) return;
    if (selectedDate) {
      // The complete candidate is validated against the freshly resolved
      // minimum: a bound advanced past the selected date without a rerender
      // rejects the clock change instead of emitting a stale-date datetime.
      const minimumDateTime = resolveMinimumDateTime(minimum);
      const candidate = `${selectedDate}T${nextTime}`;
      if (
        minimumDateTime &&
        candidate < formatMinuteDateTime(minimumDateTime)
      ) {
        return;
      }
    }
    setPendingTime(nextTime);
    if (selectedDate) onChange?.(`${selectedDate}T${nextTime}`);
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
        minimum={minimumDate}
        onBlur={onBlur}
        onChange={handleDateChange}
        placeholder={placeholder}
        required={required}
        value={selectedDate}
      />
      {showTime && (
        <TimeInput
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
      )}
      {/* The canonical reservation field validates required, bounds, and
          step even though it submits under the field name only. */}
      <input
        aria-hidden="true"
        className="sr-only pointer-events-none"
        disabled={disabled}
        id={id ? `${id}-canonical` : undefined}
        min={(() => {
          const bound = resolveMinimumDateTime(minimum);
          return bound ? formatMinuteDateTime(bound) : undefined;
        })()}
        name={name}
        onChange={() => undefined}
        required={required}
        step={
          timeStepMinutes
            ? Math.max(1, Math.trunc(timeStepMinutes)) * 60
            : undefined
        }
        tabIndex={-1}
        type="datetime-local"
        value={
          selectedDate && selectedTime ? `${selectedDate}T${selectedTime}` : ""
        }
      />
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
