"use client";

import { type Ref, useEffect, useId, useRef, useState } from "react";
import { isLocale, m } from "@/features/i18n";
import { useRouteLocale } from "@/features/i18n/route-locale";
import { cn } from "@/shared/utils";
import { composeRefs } from "@/shared/utils/compose-refs";
import {
  type ControlBound,
  formatCanonicalDateTime,
  formatCanonicalTime,
  parseCanonicalDateTime,
  parseCanonicalTime,
  resolveBound,
} from "./canonical-value";
import { DateInput } from "./date-input";
import { resolveStepMinutes, roundTimeUpToStep, TimeInput } from "./time-input";
import { useControllableValue } from "./use-controllable-value";
import { useFormReset } from "./use-form-reset";
import { useSubmitGuard } from "./use-submit-guard";

/**
 * Values are canonical local `YYYY-MM-DDTHH:mm` date-times; an empty string
 * is no date-time. The control never picks a time zone: the owning feature
 * decides what the local date-time means.
 */
export type DateTimeInputProps = {
  readonly "aria-describedby"?: string | undefined;
  readonly "aria-invalid"?: boolean | undefined;
  /** A visible label that names the date field instead of `dateLabel`. */
  readonly "aria-labelledby"?: string | undefined;
  /** Places the date and time fields; they stack in one column by default. */
  readonly className?: string | undefined;
  /** Names the date field, its calendar button, and the calendar. */
  readonly dateLabel: string;
  readonly defaultValue?: string | undefined;
  /**
   * The time a date gets before any time is chosen. With it, picking a date
   * alone completes the value, and clearing the date clears the value.
   */
  readonly defaultTime?: string | undefined;
  readonly disabled?: boolean | undefined;
  /** The date field's selected-date line; see `DateInput`. */
  readonly displayValue?: string | false | undefined;
  /** The date field's id; the time field's is `${id}-time`. */
  readonly id?: string | undefined;
  readonly isDateDisabled?: ((date: Temporal.PlainDate) => boolean) | undefined;
  /** Defaults to the route locale. */
  readonly locale?: string | undefined;
  readonly maximum?: ControlBound | undefined;
  readonly minimum?: ControlBound | undefined;
  /** Submits the value with the form under this name. */
  readonly name?: string | undefined;
  readonly onBlur?: (() => void) | undefined;
  readonly onChange?: ((value: string) => void) | undefined;
  /**
   * Reports whether the fields hold only a date or only a time. Such a draft
   * never becomes the value and keeps the owning form from submitting.
   */
  readonly onPartialDraftChange?: ((isPartial: boolean) => void) | undefined;
  /** The date field. */
  readonly ref?: Ref<HTMLInputElement> | undefined;
  readonly required?: boolean | undefined;
  /** Minutes between the times the time field takes, from midnight. */
  readonly stepMinutes?: number | undefined;
  /** Names the time field. */
  readonly timeLabel: string;
  readonly value?: string | undefined;
};

type DateTimeDraft = {
  readonly date: string;
  readonly time: string;
};

const toDraft = (
  value: string,
  defaultTime: string | undefined
): DateTimeDraft => {
  const dateTime = parseCanonicalDateTime(value);
  return dateTime
    ? {
        date: dateTime.toPlainDate().toString(),
        time: formatCanonicalTime(dateTime.toPlainTime()),
      }
    : { date: "", time: defaultTime ?? "" };
};

/** The time bound a date-time bound sets on its own date. */
const getSameDayTime = (
  date: string,
  bound: Temporal.PlainDateTime | undefined
) =>
  bound && date === bound.toPlainDate().toString()
    ? bound.toPlainTime()
    : undefined;

/**
 * A local date-time entered as a date field and a time field. The value
 * changes only when both are complete, or both are cleared. A date alone or
 * a time alone is a partial draft: the form field holds no value, and the
 * owning form doesn't submit until the draft is finished or cleared.
 * Picking a date moves a time outside that day's bounds to the nearest
 * allowed time.
 */
export function DateTimeInput({
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
  "aria-labelledby": ariaLabelledBy,
  className,
  dateLabel,
  defaultTime: defaultTimeProp,
  defaultValue,
  disabled = false,
  displayValue,
  id,
  isDateDisabled,
  locale: localeProp,
  maximum,
  minimum,
  name,
  onBlur,
  onChange,
  onPartialDraftChange,
  ref,
  required = false,
  stepMinutes,
  timeLabel,
  value,
}: DateTimeInputProps) {
  const routeLocale = useRouteLocale();
  const locale = localeProp ?? routeLocale;
  const messageLocale = isLocale(locale) ? { locale } : undefined;
  const defaultTime = parseCanonicalTime(defaultTimeProp)
    ? defaultTimeProp
    : undefined;
  const resolvedStepMinutes = resolveStepMinutes(stepMinutes);
  // Values that are no canonical minute date-time show as empty instead of
  // being re-shaped.
  const canonicalDefaultValue = parseCanonicalDateTime(defaultValue)
    ? (defaultValue ?? "")
    : "";
  const committed = useControllableValue({
    defaultValue: canonicalDefaultValue,
    onChange,
    value: value === undefined || parseCanonicalDateTime(value) ? value : "",
  });
  const [showsIncomplete, setShowsIncomplete] = useState(false);
  const [draft, setDraft] = useState(() =>
    toDraft(committed.value, defaultTime)
  );
  const [syncedValue, setSyncedValue] = useState(committed.value);
  if (committed.value !== syncedValue) {
    // A value set from outside, such as a restored selection, replaces the
    // draft.
    setSyncedValue(committed.value);
    setDraft(toDraft(committed.value, defaultTime));
    setShowsIncomplete(false);
  }
  /**
   * Changes when clearing the date leaves the time's value as it was, so the
   * time field starts afresh and drops an edit it kept on screen, which a
   * changed value would replace by itself.
   */
  const [timeFieldKey, setTimeFieldKey] = useState(0);
  const hiddenFieldRef = useRef<HTMLInputElement>(null);
  const dateFieldRef = useRef<HTMLInputElement>(null);
  const timeFieldRef = useRef<HTMLInputElement>(null);
  const incompleteId = useId();

  const isPartialDraft = (candidate: DateTimeDraft) =>
    candidate.date !== ""
      ? candidate.time === ""
      : candidate.time !== "" && defaultTime === undefined;
  const partial = isPartialDraft(draft);
  // Reports each change of the partial state, whatever changed the draft.
  const reportedPartialRef = useRef(false);
  useEffect(() => {
    if (reportedPartialRef.current === partial) return;
    reportedPartialRef.current = partial;
    onPartialDraftChange?.(partial);
  }, [onPartialDraftChange, partial]);

  // Bounds are read at each edit, so a bound that moved since the last
  // render still holds.
  const resolveMinimum = () => parseCanonicalDateTime(resolveBound(minimum));
  const resolveMaximum = () => parseCanonicalDateTime(resolveBound(maximum));

  const updateDraft = (next: DateTimeDraft) => {
    const nextPartial = isPartialDraft(next);
    if (!nextPartial) setShowsIncomplete(false);

    if (nextPartial) {
      setDraft(next);
      return;
    }

    const candidate =
      next.date === ""
        ? undefined
        : Temporal.PlainDateTime.from(`${next.date}T${next.time}`);
    const minimumDateTime = resolveMinimum();
    const maximumDateTime = resolveMaximum();
    if (
      candidate &&
      ((minimumDateTime &&
        Temporal.PlainDateTime.compare(candidate, minimumDateTime) < 0) ||
        (maximumDateTime &&
          Temporal.PlainDateTime.compare(candidate, maximumDateTime) > 0))
    ) {
      // A bound moved past the draft since the fields offered it.
      setDraft(toDraft(committed.value, defaultTime));
      return;
    }
    const nextValue = candidate ? formatCanonicalDateTime(candidate) : "";
    if (nextValue === committed.value) {
      // Such as a time chosen before any date: the value stays empty.
      setDraft(next);
      return;
    }
    // A controlled parent that takes the value passes it back, which sets the
    // draft; one that doesn't leaves the fields on its value.
    setDraft(
      committed.isControlled ? toDraft(committed.value, defaultTime) : next
    );
    setSyncedValue(committed.isControlled ? committed.value : nextValue);
    committed.setValue(nextValue);
  };

  const handleDateChange = (date: string) => {
    if (date === "") {
      // Clearing the date clears the time it went with.
      const time = defaultTime ?? "";
      if (draft.time === time) setTimeFieldKey((key) => key + 1);
      updateDraft({ date: "", time });
      return;
    }
    let time = parseCanonicalTime(draft.time || defaultTime);
    const minimumTime = getSameDayTime(date, resolveMinimum());
    const maximumTime = getSameDayTime(date, resolveMaximum());
    if (
      time &&
      minimumTime &&
      Temporal.PlainTime.compare(time, minimumTime) < 0
    )
      time = roundTimeUpToStep(minimumTime, resolvedStepMinutes);
    if (
      time &&
      maximumTime &&
      Temporal.PlainTime.compare(time, maximumTime) > 0
    )
      time = undefined;
    updateDraft({ date, time: time ? formatCanonicalTime(time) : "" });
  };

  const resetDraft = () => {
    committed.reset();
    const resetValue = committed.isControlled
      ? committed.value
      : canonicalDefaultValue;
    setSyncedValue(resetValue);
    setDraft(toDraft(resetValue, defaultTime));
    setShowsIncomplete(false);
  };
  useFormReset(hiddenFieldRef, resetDraft);
  useSubmitGuard(hiddenFieldRef, () => {
    if (disabled || !partial) return false;
    setShowsIncomplete(true);
    (draft.date === "" ? dateFieldRef : timeFieldRef).current?.focus();
    return true;
  });

  const describedBy =
    [ariaDescribedBy, showsIncomplete ? incompleteId : undefined]
      .filter(Boolean)
      .join(" ") || undefined;
  const invalid = Boolean(ariaInvalid || showsIncomplete);

  return (
    <div className="min-w-0">
      {/* A partial draft submits no value, never half of one. */}
      <input
        ref={hiddenFieldRef}
        disabled={disabled}
        name={name}
        type="hidden"
        value={partial ? "" : committed.value}
      />
      <div className={cn("grid min-w-0 grid-cols-1 gap-3", className)}>
        <DateInput
          ref={composeRefs(dateFieldRef, ref)}
          aria-describedby={describedBy}
          aria-invalid={invalid}
          aria-labelledby={ariaLabelledBy}
          disabled={disabled}
          displayValue={displayValue}
          id={id}
          isDateDisabled={isDateDisabled}
          label={dateLabel}
          locale={locale}
          maximum={() => resolveMaximum()?.toPlainDate().toString()}
          minimum={() => resolveMinimum()?.toPlainDate().toString()}
          onBlur={onBlur}
          onChange={handleDateChange}
          required={required}
          value={draft.date}
        />
        <TimeInput
          key={timeFieldKey}
          ref={timeFieldRef}
          aria-describedby={describedBy}
          aria-invalid={invalid}
          disabled={disabled}
          id={id ? `${id}-time` : undefined}
          label={timeLabel}
          locale={locale}
          maximum={() => {
            const time = getSameDayTime(draft.date, resolveMaximum());
            return time && formatCanonicalTime(time);
          }}
          minimum={() => {
            const time = getSameDayTime(draft.date, resolveMinimum());
            return time && formatCanonicalTime(time);
          }}
          onBlur={onBlur}
          onChange={(time) => updateDraft({ ...draft, time })}
          required={required}
          stepMinutes={resolvedStepMinutes}
          value={draft.time}
        />
      </div>
      <p
        id={incompleteId}
        aria-live="polite"
        className="mt-2 text-sm font-medium text-burned-orange empty:sr-only"
      >
        {showsIncomplete
          ? m.dateTimeInputIncomplete({}, messageLocale)
          : undefined}
      </p>
    </div>
  );
}
