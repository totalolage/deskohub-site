"use client";

import { Option, Predicate, Schema } from "effect";
import { Clock } from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";
import { isLocale, m } from "@/features/i18n";
import { useFormField } from "@/shared/components/ui/form";
import { Input } from "@/shared/components/ui/input";
import { cn } from "@/shared/utils";
import { formatPlainDate } from "@/shared/utils/date-time-format";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";
import { localDateTimeSchema, localTimeSchema } from "@/shared/utils/temporal";
import { ReservationDatePicker } from "./reservation-date-picker";

export type ReservationDateTimePickerProps = {
  readonly ariaDescribedBy?: string;
  readonly ariaInvalid?: boolean;
  readonly ariaRequired?: boolean;
  readonly dateLabel: string;
  readonly className?: string;
  readonly locale?: string;
  readonly id?: string;
  readonly minimum?: string | (() => string);
  readonly name?: string;
  readonly onBlur?: () => void;
  readonly onChange?: (value: string) => void;
  readonly placeholder?: string;
  readonly showTime?: boolean;
  readonly timeStepMinutes?: number;
  readonly timeLabel: string;
  readonly value?: string;
  readonly variant?: "default" | "error";
};

const defaultTime = workspaceSiteConstants.reservation.defaultStartTime;
const decodeLocalDateTime = Schema.decodeUnknownOption(localDateTimeSchema);
const decodeLocalTime = Schema.decodeUnknownOption(localTimeSchema);

const parsePlainDateTime = (value: string | undefined) =>
  decodeLocalDateTime(value).pipe(
    Option.map((dateTime) => Temporal.PlainDateTime.from(dateTime)),
    Option.getOrUndefined
  );

const resolveMinimumDateTime = (
  minimum: ReservationDateTimePickerProps["minimum"]
) => parsePlainDateTime(Predicate.isFunction(minimum) ? minimum() : minimum);

const getMinimumTimeForDate = (
  date: Temporal.PlainDate | undefined,
  minimum: Temporal.PlainDateTime | undefined
) =>
  date &&
  minimum &&
  Temporal.PlainDate.compare(date, minimum.toPlainDate()) === 0
    ? minimum.toPlainTime().toString({ smallestUnit: "minute" })
    : undefined;

const formatDateTimeValue = ({
  date,
  time,
}: {
  readonly date: Temporal.PlainDate;
  readonly time: string;
}) => `${date.toString()}T${time}`;

const getAcceptedTime = ({
  minimum,
  stepMinutes,
  value,
}: {
  readonly minimum: string | undefined;
  readonly stepMinutes: number;
  readonly value: string;
}) =>
  decodeLocalTime(value).pipe(
    Option.filter((time) => {
      const parsed = Temporal.PlainTime.from(time);
      return (parsed.hour * 60 + parsed.minute) % stepMinutes === 0;
    }),
    Option.filter((time) => minimum === undefined || time >= minimum),
    Option.getOrUndefined
  );

export function ReservationDateTimePicker({
  ariaDescribedBy,
  ariaInvalid,
  ariaRequired,
  className,
  dateLabel,
  locale,
  id,
  minimum,
  name,
  onBlur,
  onChange,
  placeholder = "Pick date and time",
  showTime = true,
  timeStepMinutes = 1,
  timeLabel,
  value,
  variant = "default",
}: ReservationDateTimePickerProps) {
  const dateTime = useMemo(() => parsePlainDateTime(value), [value]);
  const accessibleTimeLabel = ariaRequired
    ? `${timeLabel}, ${m.requiredFieldLabel(
        {},
        isLocale(locale) ? { locale } : undefined
      )}`
    : timeLabel;
  const [pendingTime, setPendingTime] = useState(
    () =>
      dateTime?.toPlainTime().toString({ smallestUnit: "minute" }) ??
      defaultTime
  );
  const minimumDateTime = resolveMinimumDateTime(minimum);
  const selectedDate = dateTime?.toPlainDate();
  const selectedTime =
    dateTime?.toPlainTime().toString({ smallestUnit: "minute" }) ?? pendingTime;
  const resolvedTimeStepMinutes = Math.max(1, Math.trunc(timeStepMinutes));
  const selectedDateMinimumTime = getMinimumTimeForDate(
    selectedDate,
    minimumDateTime
  );
  const displayValue = selectedDate
    ? formatPlainDate({ date: selectedDate, dateStyle: "long", locale })
    : placeholder;

  const handleDateChange = (date: string) => {
    const nextDate = Temporal.PlainDate.from(date);
    const minimumTime = showTime
      ? getMinimumTimeForDate(nextDate, resolveMinimumDateTime(minimum))
      : undefined;
    const isBeforeMinimumTime =
      minimumTime !== undefined && selectedTime < minimumTime;
    const nextTime = isBeforeMinimumTime ? minimumTime : selectedTime;
    onChange?.(formatDateTimeValue({ date: nextDate, time: nextTime }));
  };

  const handleTimeInput = (event: FormEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const acceptedTime = getAcceptedTime({
      minimum: getMinimumTimeForDate(
        selectedDate,
        resolveMinimumDateTime(minimum)
      ),
      stepMinutes: resolvedTimeStepMinutes,
      value: input.value,
    });
    if (!acceptedTime) {
      input.value = selectedTime;
      return;
    }

    setPendingTime(acceptedTime);
    if (selectedDate) {
      onChange?.(
        formatDateTimeValue({ date: selectedDate, time: acceptedTime })
      );
    }
  };

  return (
    <div className={cn("grid gap-3", className)}>
      <ReservationDatePicker
        id={id}
        ariaDescribedBy={ariaDescribedBy}
        ariaInvalid={ariaInvalid}
        ariaLabel={dateLabel}
        ariaRequired={ariaRequired}
        displayValue={displayValue}
        locale={locale}
        minimum={minimumDateTime?.toPlainDate().toString()}
        name={name}
        onChange={handleDateChange}
        placeholder={placeholder}
        value={selectedDate?.toString()}
        variant={variant}
      />
      {showTime && (
        <div className="relative">
          <Clock className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-burned-orange" />
          <Input
            id={id ? `${id}-time` : undefined}
            aria-describedby={ariaDescribedBy}
            aria-invalid={ariaInvalid}
            aria-label={accessibleTimeLabel}
            className="pl-11"
            min={selectedDateMinimumTime}
            onBlur={onBlur}
            onInput={handleTimeInput}
            step={resolvedTimeStepMinutes * 60}
            type="time"
            required={ariaRequired}
            value={selectedTime}
            variant={variant}
          />
        </div>
      )}
    </div>
  );
}

export function ReservationFormDateTimePicker(
  props: ReservationDateTimePickerProps
) {
  const { error, formItemId, formMessageId } = useFormField();

  return (
    <ReservationDateTimePicker
      {...props}
      id={formItemId}
      ariaDescribedBy={error ? formMessageId : undefined}
      ariaInvalid={Boolean(error)}
      ariaRequired
    />
  );
}
