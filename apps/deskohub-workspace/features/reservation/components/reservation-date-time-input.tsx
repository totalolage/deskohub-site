"use client";

import {
  type ControlBound,
  formatCanonicalTime,
  parseCanonicalDateTime,
  resolveBound,
} from "@/shared/components/date-time/canonical-value";
import type { DateTimeInputProps } from "@/shared/components/date-time/date-time-input";
import {
  FormDateInput,
  FormDateTimeInput,
} from "@/shared/components/date-time/form-fields";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";

const defaultStartTime = workspaceSiteConstants.reservation.defaultStartTime;

export type ReservationFormDateTimeInputProps = Omit<
  DateTimeInputProps,
  "defaultTime" | "defaultValue" | "onPartialDraftChange" | "required"
> & {
  /**
   * Books whole days: the field takes only the date, and the start keeps the
   * time it had.
   */
  readonly wholeDay?: boolean | undefined;
};

/** The date part of a date-time bound, read at each check. */
const toDateBound =
  (bound: ControlBound | undefined) => (): string | undefined =>
    parseCanonicalDateTime(resolveBound(bound))?.toPlainDate().toString();

/**
 * A reservation's required start inside a React Hook Form `FormItem`, as a
 * local `YYYY-MM-DDTHH:mm` date-time. A date chosen before any time starts
 * at the workspace's default start time.
 */
export function ReservationFormDateTimeInput({
  wholeDay = false,
  ...props
}: ReservationFormDateTimeInputProps) {
  if (wholeDay) return <ReservationWholeDayInput {...props} />;

  return (
    <FormDateTimeInput {...props} defaultTime={defaultStartTime} required />
  );
}

/**
 * The start of a whole-day booking: only its date is chosen. The start keeps
 * its time, even one before the minimum's, so switching back to hours shows
 * the time chosen before.
 */
function ReservationWholeDayInput({
  dateLabel,
  disabled,
  displayValue,
  id,
  isDateDisabled,
  locale,
  maximum,
  minimum,
  name,
  onBlur,
  onChange,
  ref,
  value,
  ...rest
}: Omit<ReservationFormDateTimeInputProps, "wholeDay">) {
  const start = parseCanonicalDateTime(value);

  return (
    <>
      {/* The field's name carries the whole start, as with hours. */}
      <input
        disabled={disabled}
        name={name}
        type="hidden"
        value={start ? (value ?? "") : ""}
      />
      <FormDateInput
        ref={ref}
        aria-describedby={rest["aria-describedby"]}
        disabled={disabled}
        displayValue={displayValue}
        id={id}
        isDateDisabled={isDateDisabled}
        label={dateLabel}
        locale={locale}
        maximum={toDateBound(maximum)}
        minimum={toDateBound(minimum)}
        onBlur={onBlur}
        onChange={(date) =>
          onChange?.(
            date === ""
              ? ""
              : `${date}T${start ? formatCanonicalTime(start.toPlainTime()) : defaultStartTime}`
          )
        }
        required
        value={start?.toPlainDate().toString() ?? ""}
      />
    </>
  );
}
