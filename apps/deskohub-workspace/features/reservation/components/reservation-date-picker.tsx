"use client";

import { Predicate } from "effect";
import { CalendarIcon } from "lucide-react";
import { useState } from "react";
import { isLocale, m } from "@/features/i18n";
import { Button } from "@/shared/components/ui/button";
import { Calendar } from "@/shared/components/ui/calendar";
import { useFormField } from "@/shared/components/ui/form";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/shared/components/ui/popover";
import { cn } from "@/shared/utils";
import { formatPlainDate } from "@/shared/utils/date-time-format";

export type ReservationDatePickerProps = {
  readonly ariaDescribedBy?: string;
  readonly ariaInvalid?: boolean;
  readonly ariaLabel: string;
  readonly ariaRequired?: boolean;
  readonly className?: string;
  readonly displayValue?: string;
  readonly isDateDisabled?: (date: Temporal.PlainDate) => boolean;
  readonly locale?: string;
  readonly id?: string;
  readonly maximum?: string | (() => string);
  readonly minimum?: string | (() => string);
  readonly name?: string;
  readonly onChange?: (value: string) => void;
  readonly placeholder?: string;
  readonly value?: string;
  readonly variant?: "default" | "error";
};

const parsePlainDate = (value: string | undefined) => {
  if (!value) return undefined;

  try {
    return Temporal.PlainDate.from(value);
  } catch {
    return undefined;
  }
};

const getCalendarDate = (date: Temporal.PlainDate) =>
  new Date(date.year, date.month - 1, date.day, 12);

const getPlainDateFromCalendar = (date: Date) =>
  Temporal.PlainDate.from({
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
  });

export function ReservationDatePicker({
  ariaDescribedBy,
  ariaInvalid,
  ariaLabel,
  ariaRequired,
  className,
  displayValue,
  isDateDisabled,
  locale,
  id,
  maximum,
  minimum,
  name,
  onChange,
  placeholder = "Pick a date",
  value,
  variant = "default",
}: ReservationDatePickerProps) {
  const [open, setOpen] = useState(false);
  const accessibleLabel = ariaRequired
    ? `${ariaLabel}, ${m.requiredFieldLabel(
        {},
        isLocale(locale) ? { locale } : undefined
      )}`
    : ariaLabel;
  const selectedDate = parsePlainDate(value);
  const maximumDate = parsePlainDate(
    Predicate.isFunction(maximum) ? maximum() : maximum
  );
  const minimumDate = parsePlainDate(
    Predicate.isFunction(minimum) ? minimum() : minimum
  );

  return (
    <>
      {name && <input name={name} type="hidden" value={value ?? ""} />}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            aria-describedby={ariaDescribedBy}
            aria-invalid={ariaInvalid}
            aria-label={accessibleLabel}
            className={cn(
              "h-13 w-full justify-start rounded-[1.1rem] border-navy-blue/45 bg-white px-4 py-3 text-left text-base font-normal text-navy-blue hover:border-burned-orange",
              !selectedDate && "text-navy-blue/55",
              variant === "error" && "border-burned-orange",
              className
            )}
            type="button"
            variant="secondary"
          >
            <CalendarIcon className="h-5 w-5 text-burned-orange" />
            {selectedDate
              ? (displayValue ??
                formatPlainDate({
                  date: selectedDate,
                  dateStyle: "long",
                  locale,
                }))
              : placeholder}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          aria-label={ariaLabel}
          className="w-auto p-3"
        >
          <Calendar
            disabled={(date) => {
              const plainDate = getPlainDateFromCalendar(date);
              return Boolean(
                (minimumDate &&
                  Temporal.PlainDate.compare(plainDate, minimumDate) < 0) ||
                  (maximumDate &&
                    Temporal.PlainDate.compare(plainDate, maximumDate) > 0) ||
                  isDateDisabled?.(plainDate)
              );
            }}
            mode="single"
            onSelect={(date) => {
              if (!date) return;

              const plainDate = getPlainDateFromCalendar(date);
              if (
                (minimumDate &&
                  Temporal.PlainDate.compare(plainDate, minimumDate) < 0) ||
                (maximumDate &&
                  Temporal.PlainDate.compare(plainDate, maximumDate) > 0) ||
                isDateDisabled?.(plainDate)
              ) {
                return;
              }

              onChange?.(plainDate.toString());
              setOpen(false);
            }}
            selected={selectedDate ? getCalendarDate(selectedDate) : undefined}
          />
        </PopoverContent>
      </Popover>
    </>
  );
}

export function ReservationFormDatePicker(props: ReservationDatePickerProps) {
  const { error, formItemId, formMessageId } = useFormField();

  return (
    <ReservationDatePicker
      {...props}
      id={formItemId}
      ariaDescribedBy={error ? formMessageId : undefined}
      ariaInvalid={Boolean(error)}
      ariaRequired
    />
  );
}
