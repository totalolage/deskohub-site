"use client";

import { CalendarIcon } from "lucide-react";
import { type Ref, useCallback, useRef, useState } from "react";
import { Button } from "@/shared/components/ui/button";
import { Calendar } from "@/shared/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/shared/components/ui/popover";
import { cn } from "@/shared/utils";
import { formatPlainDate } from "@/shared/utils/date-time-format";
import {
  getCalendarDate,
  getPlainDateFromCalendarDate,
  isPlainDateDisabled,
  parsePlainDate,
  resolvePlainDateBound,
  type TemporalTimeBoundInput,
} from "./temporal-parts";
import { useControllableState } from "./use-controllable-state";
import { useFormReset } from "./use-form-reset";

/**
 * Canonical value type at input boundaries is a plain `YYYY-MM-DD` string,
 * matching plainDateStringSchema; branded values are assignable without casts.
 */
export type DateInputProps = {
  readonly ariaDescribedBy?: string;
  readonly ariaInvalid?: boolean;
  readonly ariaLabel: string;
  readonly className?: string;
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
  readonly value?: string;
};

export function DateInput({
  ariaDescribedBy,
  ariaInvalid = false,
  ariaLabel,
  className,
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
  placeholder = "Pick a date",
  ref,
  required = false,
  value,
}: DateInputProps) {
  const [open, setOpen] = useState(false);
  const fieldRef = useRef<HTMLInputElement>(null);
  const [selectedDate, setSelectedDate] = useControllableState({
    defaultValue,
    onChange,
    value,
  });
  const handleReset = useCallback(
    (next: string) => setSelectedDate(next || undefined),
    [setSelectedDate]
  );
  useFormReset({
    defaultCanonicalValue: defaultValue ?? "",
    fieldRef,
    onReset: handleReset,
  });

  const minimumDate = resolvePlainDateBound(minimum);
  const maximumDate = resolvePlainDateBound(maximum);
  const selectedPlainDate = parsePlainDate(selectedDate);
  const isAccepted = (date: Temporal.PlainDate) =>
    !isPlainDateDisabled({
      date,
      isDateDisabled,
      // Bounds re-resolve at event time so dynamic minimums and maximums
      // are honored even when the owning form has not re-rendered yet.
      maximumDate: resolvePlainDateBound(maximum),
      minimumDate: resolvePlainDateBound(minimum),
    });

  const handleTriggerBlur = () => {
    onBlur?.();
  };

  return (
    <div data-date-input="">
      {/* The canonical field validates even when unnamed; only a named
          control contributes its value to form submission. */}
      <input
        aria-hidden="true"
        className="sr-only pointer-events-none"
        disabled={disabled}
        id={id ? `${id}-canonical` : undefined}
        max={maximumDate?.toString()}
        min={minimumDate?.toString()}
        name={name}
        onChange={() => undefined}
        ref={fieldRef}
        required={required}
        tabIndex={-1}
        type="date"
        value={selectedDate ?? ""}
      />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            aria-describedby={ariaDescribedBy}
            aria-invalid={ariaInvalid}
            aria-label={ariaLabel}
            aria-required={required || undefined}
            className={cn(
              "h-auto min-h-13 w-full justify-start rounded-[1.1rem] border-navy-blue/45 bg-white px-4 py-3 text-left text-base font-normal text-navy-blue whitespace-normal hover:border-burned-orange",
              !selectedPlainDate && "text-navy-blue/55",
              ariaInvalid && "border-burned-orange",
              className
            )}
            disabled={disabled}
            id={id}
            onBlur={handleTriggerBlur}
            ref={ref}
            type="button"
            variant="secondary"
          >
            <CalendarIcon className="h-5 w-5 shrink-0 text-burned-orange" />
            <span className="min-w-0">
              {selectedPlainDate
                ? formatPlainDate({
                    date: selectedPlainDate,
                    dateStyle: "long",
                    locale,
                  })
                : placeholder}
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          aria-label={ariaLabel}
          className="w-auto p-3"
        >
          <div className="grid gap-2">
            <Calendar
              disabled={(date) =>
                disabled || !isAccepted(getPlainDateFromCalendarDate(date))
              }
              mode="single"
              onSelect={(date) => {
                if (!date || disabled) return;
                const plainDate = getPlainDateFromCalendarDate(date);
                if (!isAccepted(plainDate)) return;
                setSelectedDate(plainDate.toString());
                setOpen(false);
              }}
              selected={
                selectedPlainDate
                  ? getCalendarDate(selectedPlainDate)
                  : undefined
              }
            />
            <Button
              aria-label={`Clear ${ariaLabel}`}
              className="justify-self-start"
              disabled={disabled}
              onClick={() => {
                setSelectedDate(undefined);
                setOpen(false);
              }}
              type="button"
              variant="ghost"
            >
              Clear
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
