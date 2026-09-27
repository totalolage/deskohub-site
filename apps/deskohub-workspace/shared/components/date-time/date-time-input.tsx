"use client";

import { type Ref, useCallback, useEffect, useRef, useState } from "react";
import { DateInput } from "./date-input";
import {
  formatMinuteDateTime,
  getSameDayTimeBound,
  parsePlainDate,
  parsePlainDateTime,
  resolvePlainDateTimeBound,
  type TemporalTimeBoundInput,
} from "./temporal-parts";
import { TimeInput } from "./time-input";
import { useFormReset } from "./use-form-reset";

/**
 * Canonical value type at input boundaries is a plain `YYYY-MM-DDTHH:mm`
 * string, matching localDateTimeSchema at minute precision; branded values
 * are assignable without casts.
 */
export type DateTimeInputProps = {
  /**
   * Standard ARIA attributes so the form-control slot's error wiring
   * (described-by, invalid) reaches the interactive controls. The slot's
   * labelled-by is intentionally not forwarded: the controls carry an
   * explicit aria-label, and a labelled-by would override it with the
   * visible field label.
   */
  readonly "aria-describedby"?: string;
  readonly "aria-invalid"?: boolean;
  readonly className?: string;
  readonly dateLabel: string;
  readonly defaultValue?: string;
  readonly disabled?: boolean;
  readonly id?: string;
  readonly isDateDisabled?: (date: Temporal.PlainDate) => boolean;
  readonly locale?: string;
  readonly maximum?: TemporalTimeBoundInput;
  readonly minimum?: TemporalTimeBoundInput;
  readonly name?: string;
  readonly onBlur?: () => void;
  readonly onChange?: (value: string | undefined) => void;
  readonly placeholder?: string;
  readonly ref?: Ref<HTMLButtonElement>;
  readonly required?: boolean;
  readonly timeLabel: string;
  readonly timeStepMinutes?: number;
  readonly value?: string;
};

type DateTimeParts = {
  readonly date: string | undefined;
  readonly time: string | undefined;
};

/**
 * Decodes boundary prop values against the canonical temporal schemas.
 * The whole value must decode as a canonical local datetime at minute
 * precision; malformed or non-canonical values (datetime-shaped dates,
 * out-of-range times, seconds precision) decode to empty instead of being
 * partially salvaged or silently re-shaped.
 */
const parseParts = (value: string | undefined): DateTimeParts => {
  const whole = parsePlainDateTime(value);
  if (!whole) return { date: undefined, time: undefined };
  return {
    date: whole.toPlainDate().toString(),
    time: whole.toPlainTime().toString({ smallestUnit: "minute" }),
  };
};

const isEmpty = (parts: DateTimeParts) => !parts.date && !parts.time;
const isComplete = (parts: DateTimeParts) => Boolean(parts.date && parts.time);

const canonicalize = (parts: DateTimeParts) =>
  isComplete(parts) ? `${parts.date}T${parts.time}` : "";

export function DateTimeInput({
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid = false,
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
  ref,
  required = false,
  timeLabel,
  timeStepMinutes,
  value,
}: DateTimeInputProps) {
  const canonicalFieldRef = useRef<HTMLInputElement>(null);
  // Child controls observe the same form reset and re-emit their own reset
  // state through onChange after this owner has restored the canonical
  // draft; swallow those echoes for the duration of the reset.
  const resettingRef = useRef(false);
  // Controlled ownership is independent of emptiness: any asserted `value`
  // (including an explicit empty string) keeps the parent authoritative,
  // while the editable draft lives here so a value can always be
  // constructed from empty.
  const everControlledRef = useRef(false);
  if (value !== undefined) everControlledRef.current = true;
  const isControlled = everControlledRef.current;
  const [internalCommitted, setInternalCommitted] = useState<DateTimeParts>(
    () => parseParts(defaultValue)
  );
  const [draft, setDraft] = useState<DateTimeParts>(() =>
    parseParts(value ?? defaultValue)
  );
  const committed = isControlled ? parseParts(value) : internalCommitted;
  // Follow the asserted controlled value (including a parent resetting it)
  // without clobbering an in-progress partial draft: partial drafts never
  // reach onChange, so the controlled value stays put while editing.
  useEffect(() => {
    if (isControlled) setDraft(parseParts(value));
  }, [isControlled, value]);

  // Dynamic bounds stay resolvable at event time: the raw prop is forwarded
  // to the date control and re-resolved here for same-day time bounds, the
  // step anchor, and whole-candidate validation, so a bound advanced
  // without an owning rerender is still honored.
  const resolveMinimumDateTime = useCallback(
    () => resolvePlainDateTimeBound(minimum),
    [minimum]
  );
  const resolveMaximumDateTime = useCallback(
    () => resolvePlainDateTimeBound(maximum),
    [maximum]
  );

  const commitDraft = useCallback(
    (next: DateTimeParts) => {
      if (resettingRef.current) return;
      // A canonical local datetime exists only when both parts are complete;
      // an explicit full clear reports an explicitly emptied value, and a
      // partial draft keeps the prior committed value canonical while it
      // blocks submission.
      if (isComplete(next)) {
        const candidate = canonicalize(next);
        // The complete candidate is validated against freshly resolved
        // bounds so a dynamic minimum or maximum that advanced past the
        // draft date or time rejects the whole edit instead of emitting a
        // stale datetime, even without an owning rerender.
        const minimumDateTime = resolveMinimumDateTime();
        const maximumDateTime = resolveMaximumDateTime();
        if (
          (minimumDateTime &&
            candidate < formatMinuteDateTime(minimumDateTime)) ||
          (maximumDateTime && candidate > formatMinuteDateTime(maximumDateTime))
        ) {
          setDraft({ ...committed });
          return;
        }
        if (!isControlled) setInternalCommitted(next);
        onChange?.(candidate);
        // A controlled parent stays authoritative: unless it adopts the
        // reported value (the sync effect then follows the new value), the
        // draft reverts to the committed parts instead of leaving entered
        // parts on the interactive controls. Partial drafts stay editable.
        setDraft(isControlled ? { ...committed } : next);
        return;
      }
      if (isEmpty(next)) {
        if (!isControlled) setInternalCommitted(next);
        onChange?.(undefined);
      }
      setDraft(next);
    },
    [
      committed,
      isControlled,
      onChange,
      resolveMaximumDateTime,
      resolveMinimumDateTime,
    ]
  );

  const handleReset = useCallback((next: string) => {
    const nextParts = parseParts(next);
    resettingRef.current = true;
    setDraft(nextParts);
    setInternalCommitted(nextParts);
    queueMicrotask(() => {
      resettingRef.current = false;
    });
  }, []);
  useFormReset({
    defaultCanonicalValue: defaultValue ?? "",
    fieldRef: canonicalFieldRef,
    onReset: handleReset,
  });

  const minimumDateTime = resolveMinimumDateTime();
  const maximumDateTime = resolveMaximumDateTime();
  const selectedDate = parsePlainDate(draft.date);
  // The time bounds and step anchor re-resolve the datetime bound at event
  // time so a callback minimum or maximum advanced without a rerender still
  // governs the same-day clamps and the step sequence.
  const minimumTime = () =>
    getSameDayTimeBound({
      date: selectedDate,
      dateTimeBound: resolveMinimumDateTime(),
    });
  const maximumTime = () =>
    getSameDayTimeBound({
      date: selectedDate,
      dateTimeBound: resolveMaximumDateTime(),
    });
  // The step sequence anchors at the minimum's time-of-day (midnight when
  // unset) so the editor shares the canonical field's sequence even on
  // later dates where the same-day lower bound drops out.
  const stepAnchor = () => {
    const bound = resolveMinimumDateTime();
    return bound
      ? bound.toPlainTime().toString({ smallestUnit: "minute" })
      : "00:00";
  };
  // The date control consumes plain dates; extract them from the freshly
  // resolved datetime bounds so datetime-shaped static and callback bounds
  // disable out-of-range calendar days.
  const minimumDate = useCallback(
    () => resolveMinimumDateTime()?.toPlainDate().toString(),
    [resolveMinimumDateTime]
  );
  const maximumDate = useCallback(
    () => resolveMaximumDateTime()?.toPlainDate().toString(),
    [resolveMaximumDateTime]
  );

  // A partial draft (date without time, or time without date) never carries
  // a submittable value: the canonical field empties and reports missing so
  // constraint validation blocks submission until the draft completes or
  // clears.
  const partialDraft = !isEmpty(draft) && !isComplete(draft);
  const canonicalValue = partialDraft ? "" : canonicalize(committed);

  return (
    <div className={className ? `min-w-0 ${className}` : "min-w-0"}>
      {/* The canonical field validates even when unnamed; only a named
          control contributes its value to form submission. */}
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
        required={required || partialDraft || undefined}
        step={
          timeStepMinutes
            ? Math.max(1, Math.trunc(timeStepMinutes)) * 60
            : undefined
        }
        tabIndex={-1}
        type="datetime-local"
        value={canonicalValue}
      />
      <div className="grid gap-3">
        <DateInput
          ariaDescribedBy={ariaDescribedBy}
          ariaInvalid={ariaInvalid}
          ariaLabel={dateLabel}
          disabled={disabled}
          id={id}
          isDateDisabled={isDateDisabled}
          locale={locale}
          maximum={maximumDate}
          minimum={minimumDate}
          onBlur={onBlur}
          onChange={(nextDate) => commitDraft({ ...draft, date: nextDate })}
          placeholder={placeholder}
          ref={ref}
          required={required}
          value={draft.date ?? ""}
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
          onChange={(nextTime) => commitDraft({ ...draft, time: nextTime })}
          required={required}
          stepAnchor={stepAnchor}
          timeStepMinutes={timeStepMinutes}
          value={draft.time ?? ""}
        />
      </div>
    </div>
  );
}
