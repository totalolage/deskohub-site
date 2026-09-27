"use client";

import { useCallback, useRef, useState } from "react";
import { DateInput } from "./date-input";
import {
  formatMinuteDateTime,
  getSameDayTimeBound,
  parsePlainDate,
  resolvePlainDateTimeBound,
} from "./temporal-parts";
import { TimeInput } from "./time-input";
import { useFormReset } from "./use-form-reset";

/**
 * Canonical value type at input boundaries is a plain `YYYY-MM-DDTHH:mm`
 * string, matching localDateTimeSchema at minute precision; branded values
 * are assignable without casts.
 */
export type DateTimeInputProps = {
  readonly ariaDescribedBy?: string;
  readonly ariaInvalid?: boolean;
  readonly className?: string;
  readonly dateLabel: string;
  readonly defaultValue?: string;
  readonly disabled?: boolean;
  readonly id?: string;
  readonly isDateDisabled?: (date: Temporal.PlainDate) => boolean;
  readonly locale?: string;
  readonly maximum?: string | (() => string);
  readonly minimum?: string | (() => string);
  readonly name?: string;
  readonly onBlur?: () => void;
  readonly onChange?: (value: string | undefined) => void;
  readonly placeholder?: string;
  readonly required?: boolean;
  readonly timeLabel: string;
  readonly timeStepMinutes?: number;
  readonly value?: string;
};

const parseParts = (value: string | undefined) => {
  const [dateSegment = "", timeSegment = ""] = value?.split("T") ?? [];
  return { date: dateSegment || undefined, time: timeSegment || undefined };
};

type DateTimeParts = ReturnType<typeof parseParts>;

const toCanonicalDateTime = (parts: DateTimeParts) =>
  parts.date && parts.time ? `${parts.date}T${parts.time}` : "";

export function DateTimeInput({
  ariaDescribedBy,
  ariaInvalid = false,
  className,
  dateLabel,
  defaultValue,
  disabled = false,
  id,
  isDateDisabled,
  locale,
  maximum,
  minimum,
  name,
  onBlur,
  onChange,
  placeholder,
  required = false,
  timeLabel,
  timeStepMinutes,
  value,
}: DateTimeInputProps) {
  const isControlled = value !== undefined;
  const canonicalFieldRef = useRef<HTMLInputElement>(null);
  const [internal, setInternal] = useState<DateTimeParts>(() =>
    parseParts(defaultValue)
  );
  const parts = isControlled ? parseParts(value) : internal;

  const commitParts = useCallback(
    (next: DateTimeParts) => {
      if (!isControlled) setInternal(next);
      // A canonical local datetime exists only when both parts are complete;
      // incomplete states stay internal and submit nothing.
      if (next.date && next.time) onChange?.(`${next.date}T${next.time}`);
    },
    [isControlled, onChange]
  );

  const handleReset = useCallback(
    (next: string) => setInternal(parseParts(next)),
    []
  );
  useFormReset({
    defaultCanonicalValue: defaultValue ?? "",
    fieldRef: canonicalFieldRef,
    onReset: handleReset,
  });

  const minimumDateTime = resolvePlainDateTimeBound(minimum);
  const maximumDateTime = resolvePlainDateTimeBound(maximum);
  const selectedDate = parsePlainDate(parts.date);
  const minimumTime = getSameDayTimeBound({
    date: selectedDate,
    dateTimeBound: minimumDateTime,
  });
  const maximumTime = getSameDayTimeBound({
    date: selectedDate,
    dateTimeBound: maximumDateTime,
  });

  return (
    <div className={className}>
      {name && (
        <input
          aria-hidden="true"
          className="sr-only pointer-events-none"
          disabled={disabled}
          id={id ? `${id}-canonical` : undefined}
          max={
            maximumDateTime ? formatMinuteDateTime(maximumDateTime) : undefined
          }
          min={
            minimumDateTime ? formatMinuteDateTime(minimumDateTime) : undefined
          }
          name={name}
          onChange={() => undefined}
          ref={canonicalFieldRef}
          required={required}
          step={
            timeStepMinutes
              ? Math.max(1, Math.trunc(timeStepMinutes)) * 60
              : undefined
          }
          tabIndex={-1}
          type="datetime-local"
          value={toCanonicalDateTime(parts)}
        />
      )}
      <div className="grid gap-3">
        <DateInput
          ariaDescribedBy={ariaDescribedBy}
          ariaInvalid={ariaInvalid}
          ariaLabel={dateLabel}
          disabled={disabled}
          id={id}
          isDateDisabled={isDateDisabled}
          locale={locale}
          maximum={maximumDateTime?.toPlainDate().toString()}
          minimum={minimumDateTime?.toPlainDate().toString()}
          onChange={(nextDate) => commitParts({ ...parts, date: nextDate })}
          placeholder={placeholder}
          required={required}
          value={parts.date}
        />
        <TimeInput
          ariaDescribedBy={ariaDescribedBy}
          ariaInvalid={ariaInvalid}
          ariaLabel={timeLabel}
          disabled={disabled}
          id={id ? `${id}-time` : undefined}
          maximum={maximumTime}
          minimum={minimumTime}
          onBlur={onBlur}
          onChange={(nextTime) => commitParts({ ...parts, time: nextTime })}
          required={required}
          timeStepMinutes={timeStepMinutes}
          value={parts.time}
        />
      </div>
    </div>
  );
}
