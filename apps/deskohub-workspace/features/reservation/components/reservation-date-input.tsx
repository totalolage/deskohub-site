"use client";

import type { DateInputProps } from "@/shared/components/date-time/date-input";
import { FormDateInput } from "@/shared/components/date-time/form-fields";

export type ReservationFormDateInputProps = Omit<
  DateInputProps,
  "isDateDisabled" | "required"
> & {
  /** Canonical dates the space is booked out on; the field doesn't take them. */
  readonly unavailableDates?: ReadonlySet<string> | undefined;
};

/**
 * A reservation's required date inside a React Hook Form `FormItem`: the
 * shared date control with the space's unavailable dates left out. Pass the
 * field's props and the earliest and latest bookable dates.
 */
export function ReservationFormDateInput({
  unavailableDates,
  ...props
}: ReservationFormDateInputProps) {
  return (
    <FormDateInput
      {...props}
      isDateDisabled={
        unavailableDates && ((date) => unavailableDates.has(date.toString()))
      }
      required
    />
  );
}
