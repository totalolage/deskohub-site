"use client";

import { isLocale, m } from "@/features/i18n";
import { DateInput } from "@/shared/components/date-time/date-input";
import { useFormField } from "@/shared/components/ui/form";

export type ReservationFormDateInputProps = {
  readonly ariaLabel: string;
  readonly className?: string;
  readonly disabled?: boolean;
  readonly isDateDisabled?: (date: Temporal.PlainDate) => boolean;
  readonly locale?: string;
  readonly maximum?: string | (() => string);
  readonly minimum?: string | (() => string);
  readonly name?: string;
  readonly onBlur?: () => void;
  readonly onChange?: (value: string | undefined) => void;
  readonly placeholder?: string;
  readonly value?: string;
};

/**
 * Appends the workspace "required" label suffix to an accessible label so
 * screen readers announce reservation fields as mandatory.
 */
export const getReservationAccessibleLabel = ({
  ariaLabel,
  locale,
  required,
}: {
  readonly ariaLabel: string;
  readonly locale: string | undefined;
  readonly required: boolean;
}) =>
  required
    ? `${ariaLabel}, ${m.requiredFieldLabel(
        {},
        isLocale(locale) ? { locale } : undefined
      )}`
    : ariaLabel;

export function ReservationFormDateInput({
  ariaLabel,
  locale,
  onBlur,
  ...dateInputProps
}: ReservationFormDateInputProps) {
  const { error, formItemId, formMessageId } = useFormField();

  return (
    <DateInput
      {...dateInputProps}
      ariaDescribedBy={error ? formMessageId : undefined}
      ariaInvalid={Boolean(error)}
      ariaLabel={getReservationAccessibleLabel({
        ariaLabel,
        locale,
        required: true,
      })}
      id={formItemId}
      locale={locale}
      onBlur={onBlur}
      required
    />
  );
}
