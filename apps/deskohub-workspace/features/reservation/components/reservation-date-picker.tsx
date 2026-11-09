"use client";

import { Option, Predicate } from "effect";
import { CalendarIcon } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { isLocale, m } from "@/features/i18n";
import { useFormField } from "@/shared/components/ui/form";
import { Input } from "@/shared/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/shared/components/ui/popover";
import { cn } from "@/shared/utils";
import {
  formatNumericPlainDate,
  formatNumericPlainDatePattern,
  formatPlainDate,
  parseNumericPlainDate,
} from "@/shared/utils/date-time-format";
import {
  createPreloadableModule,
  useLoadedModule,
  usePreloadWhenIdle,
} from "@/shared/utils/preloadable-module";
import { parsePlainDate } from "@/shared/utils/temporal";

export type ReservationDatePickerProps = {
  readonly ariaDescribedBy?: string;
  readonly ariaInvalid?: boolean;
  /** Names the calendar button and dialog, and the text field when no visible label names it. */
  readonly ariaLabel: string;
  /** The visible label that names the text field. */
  readonly ariaLabelledBy?: string;
  readonly ariaRequired?: boolean;
  readonly className?: string;
  /** The selected date as shown under the typed field; a long date by default. */
  readonly displayValue?: string;
  readonly isDateDisabled?: (date: Temporal.PlainDate) => boolean;
  readonly locale?: string;
  readonly id?: string;
  readonly maximum?: string | (() => string);
  readonly minimum?: string | (() => string);
  readonly name?: string;
  readonly onBlur?: () => void;
  readonly onChange?: (value: string) => void;
  readonly value?: string;
  readonly variant?: "default" | "error";
};

/** Why typed text did not become the field's date. */
type TypedDateError =
  | { readonly kind: "invalid" }
  | {
      readonly kind: "afterMaximum" | "beforeMinimum" | "unavailable";
      /** The bound for a range error, or the typed date. */
      readonly date: Temporal.PlainDate;
    };

// The day picker stays out of the page bundle. It preloads when the browser
// is idle or the trigger is approached, and the popover opens only once it is
// loaded, so the popover never shows a loading state. An open requested
// before then is dropped if the user moves on.
const reservationCalendar = createPreloadableModule(
  () => import("@/shared/components/ui/calendar")
);
type CalendarModule = typeof import("@/shared/components/ui/calendar");

const parseCalendarDate = (value: string | undefined) =>
  value ? Option.getOrUndefined(parsePlainDate(value)) : undefined;

const getCalendarDate = (date: Temporal.PlainDate) =>
  new Date(date.year, date.month - 1, date.day, 12);

const getPlainDateFromCalendar = (date: Date) =>
  Temporal.PlainDate.from({
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
  });

const resolveDateBound = (bound: ReservationDatePickerProps["maximum"]) =>
  parseCalendarDate(Predicate.isFunction(bound) ? bound() : bound);

const formatLongDate = (date: Temporal.PlainDate, locale: string | undefined) =>
  formatPlainDate({ date, dateStyle: "long", locale });

/** The numeric date format the field takes, worded for the visitor. */
const getDateInputFormat = (locale: string | undefined) => {
  const messageLocale = isLocale(locale) ? { locale } : undefined;
  const tokens = {
    day: m.reservationDateInputDayToken({}, messageLocale),
    month: m.reservationDateInputMonthToken({}, messageLocale),
    year: m.reservationDateInputYearToken({}, messageLocale),
  };
  return {
    format: formatNumericPlainDatePattern({ locale, tokens }),
    isoFormat: `${tokens.year}-${tokens.month}-${tokens.day}`,
    messageLocale,
  };
};

const getTypedDateErrorMessage = (
  typedError: TypedDateError | undefined,
  locale: string | undefined,
  { format, isoFormat, messageLocale }: ReturnType<typeof getDateInputFormat>
) => {
  if (!typedError) return undefined;
  if (typedError.kind === "invalid") {
    return m.reservationDateInputInvalid({ format, isoFormat }, messageLocale);
  }
  return {
    afterMaximum: m.reservationDateInputAfterMaximum,
    beforeMinimum: m.reservationDateInputBeforeMinimum,
    unavailable: m.reservationDateInputUnavailable,
  }[typedError.kind](
    { date: formatLongDate(typedError.date, locale) },
    messageLocale
  );
};

/**
 * The calendar popover's open state. The popover opens only once the
 * calendar is loaded; until then, leaving the trigger drops the open request.
 */
function useReservationCalendarPopover(onBlur: (() => void) | undefined) {
  const [openRequested, setOpenRequested] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Escape and a pick close the calendar back into the text field, as in the
  // APG pattern; other closes keep Radix's focus handling.
  const closesToFieldRef = useRef(false);
  const calendar = useLoadedModule(reservationCalendar);
  usePreloadWhenIdle(reservationCalendar);
  const openPending = openRequested && calendar === undefined;

  useEffect(() => {
    if (!openPending) return;

    // Leaving the trigger dismisses the pending open as it would dismiss the
    // open popover, including the blur that runs onBlur validation.
    const dismiss = () => {
      setOpenRequested(false);
      onBlur?.();
    };
    const dismissOutside = (event: Event) => {
      if (
        event.target instanceof Node &&
        triggerRef.current?.contains(event.target)
      ) {
        return;
      }
      dismiss();
    };
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") dismiss();
    };

    document.addEventListener("pointerdown", dismissOutside, true);
    document.addEventListener("focusin", dismissOutside);
    document.addEventListener("keydown", dismissOnEscape);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside, true);
      document.removeEventListener("focusin", dismissOutside);
      document.removeEventListener("keydown", dismissOnEscape);
    };
  }, [onBlur, openPending]);

  return {
    calendar,
    closesToFieldRef,
    inputRef,
    open: openRequested && calendar !== undefined,
    requestOpen: () => {
      reservationCalendar.preload();
      setOpenRequested(true);
    },
    setOpenRequested,
    triggerRef,
  };
}

/**
 * The field's typed text and the date it commits. Text that is no date, or a
 * date the calendar would not offer, clears the committed value and keeps
 * why.
 */
function useTypedReservationDate({
  committedValue,
  isDateDisabled,
  locale,
  maximum,
  minimum,
  onChange,
}: Pick<
  ReservationDatePickerProps,
  "isDateDisabled" | "locale" | "maximum" | "minimum" | "onChange"
> & { readonly committedValue: string }) {
  const selectedDate = parseCalendarDate(committedValue);
  const maximumDate = resolveDateBound(maximum);
  const minimumDate = resolveDateBound(minimum);
  const formatText = (date: string) => {
    const parsedDate = parseCalendarDate(date);
    return parsedDate
      ? formatNumericPlainDate({ date: parsedDate, locale })
      : date;
  };

  const [text, setText] = useState(() => formatText(committedValue));
  const [typedError, setTypedError] = useState<TypedDateError>();
  const [syncedValue, setSyncedValue] = useState(committedValue);
  if (committedValue !== syncedValue) {
    // A date set from outside the field, such as a restored selection,
    // replaces whatever was typed.
    setSyncedValue(committedValue);
    setText(formatText(committedValue));
    setTypedError(undefined);
  }

  const getUnavailability = (
    date: Temporal.PlainDate
  ): TypedDateError | undefined => {
    if (minimumDate && Temporal.PlainDate.compare(date, minimumDate) < 0) {
      return { kind: "beforeMinimum", date: minimumDate };
    }
    if (maximumDate && Temporal.PlainDate.compare(date, maximumDate) > 0) {
      return { kind: "afterMaximum", date: maximumDate };
    }
    return isDateDisabled?.(date) ? { kind: "unavailable", date } : undefined;
  };

  const commitValue = (nextValue: string) => {
    setSyncedValue(nextValue);
    if (nextValue !== committedValue) onChange?.(nextValue);
  };

  /** Makes the typed text the field's value; false when it holds no usable date. */
  const commitText = () => {
    if (text.trim() === "") {
      setTypedError(undefined);
      commitValue("");
      return true;
    }

    // Unchanged text stands for the committed date, which still has to be one
    // the calendar would offer: a prefilled date can be unavailable, and the
    // bounds can move after it was chosen.
    const typedDate =
      selectedDate && text === formatText(committedValue)
        ? selectedDate
        : Option.getOrUndefined(parseNumericPlainDate({ locale, text }));
    const error: TypedDateError | undefined = typedDate
      ? getUnavailability(typedDate)
      : { kind: "invalid" };
    setTypedError(error);
    if (!typedDate || error) {
      commitValue("");
      return false;
    }

    setText(formatNumericPlainDate({ date: typedDate, locale }));
    commitValue(typedDate.toString());
    return true;
  };

  /** Commits a date picked in the calendar, which offers only available dates. */
  const pickDate = (date: Temporal.PlainDate) => {
    setText(formatNumericPlainDate({ date, locale }));
    setTypedError(undefined);
    commitValue(date.toString());
  };

  return {
    commitText,
    getUnavailability,
    pickDate,
    selectedDate,
    setText,
    text,
    typedError,
  };
}

function ReservationDateCalendar({
  calendar,
  isUnavailable,
  locale,
  onPick,
  selectedDate,
}: {
  readonly calendar: CalendarModule | undefined;
  readonly isUnavailable: (date: Temporal.PlainDate) => boolean;
  readonly locale: string | undefined;
  readonly onPick: (date: Temporal.PlainDate) => void;
  readonly selectedDate: Temporal.PlainDate | undefined;
}) {
  if (!calendar) return null;

  return (
    <calendar.Calendar
      autoFocus
      defaultMonth={selectedDate ? getCalendarDate(selectedDate) : undefined}
      locale={calendar.getCalendarLocale(locale)}
      disabled={(date) => isUnavailable(getPlainDateFromCalendar(date))}
      mode="single"
      onSelect={(date) => {
        if (date) onPick(getPlainDateFromCalendar(date));
      }}
      selected={selectedDate ? getCalendarDate(selectedDate) : undefined}
    />
  );
}

/**
 * A date field that takes a typed date or a calendar pick, following the APG
 * date picker combobox: the text field is the control, and its button or Down
 * Arrow opens the calendar dialog. Typed text becomes the field's value on
 * blur, Enter, or opening the calendar. Text that is no date, or a date the
 * calendar would not offer, clears the value and shows why, so the form never
 * holds a date the field does not show. Escape or a pick closes the calendar
 * back into the text field.
 */
export function ReservationDatePicker({
  ariaDescribedBy,
  ariaInvalid,
  ariaLabel,
  ariaLabelledBy,
  ariaRequired,
  className,
  displayValue,
  isDateDisabled,
  locale,
  id,
  maximum,
  minimum,
  name,
  onBlur,
  onChange,
  value,
  variant = "default",
}: ReservationDatePickerProps) {
  // Destructured, so the React Compiler sees the refs as refs and the open
  // state as a plain value.
  const {
    calendar,
    closesToFieldRef,
    inputRef,
    open,
    requestOpen,
    setOpenRequested,
    triggerRef,
  } = useReservationCalendarPopover(onBlur);
  const baseId = useId();
  const calendarId = `${baseId}-calendar`;
  const formatId = `${baseId}-format`;
  const errorId = `${baseId}-error`;
  const committedValue = value ?? "";
  const typed = useTypedReservationDate({
    committedValue,
    isDateDisabled,
    locale,
    maximum,
    minimum,
    onChange,
  });
  const inputFormat = getDateInputFormat(locale);
  const { format, isoFormat, messageLocale } = inputFormat;
  const { selectedDate, typedError } = typed;
  const controlsId = open ? calendarId : undefined;

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      {name && <input name={name} type="hidden" value={committedValue} />}
      <Popover
        open={open}
        onOpenChange={(nextOpen) => {
          // The popover opens once the calendar is loaded. A failed chunk load
          // leaves it closed; the next open request retries it.
          if (nextOpen) {
            typed.commitText();
            reservationCalendar.preload();
          }
          setOpenRequested(nextOpen);
          // Closing the calendar is the field's blur; this lets onBlur form
          // validation run.
          if (!nextOpen) onBlur?.();
        }}
      >
        <div className="relative">
          <Input
            ref={inputRef}
            id={id}
            role="combobox"
            aria-autocomplete="none"
            aria-controls={controlsId}
            aria-describedby={[formatId, errorId, ariaDescribedBy]
              .filter(Boolean)
              .join(" ")}
            aria-expanded={open}
            aria-haspopup="dialog"
            aria-invalid={Boolean(ariaInvalid || typedError)}
            aria-label={ariaLabelledBy ? undefined : ariaLabel}
            aria-labelledby={ariaLabelledBy}
            autoComplete="off"
            className="pe-12"
            onBlur={() => {
              if (typed.commitText()) onBlur?.();
            }}
            onChange={(event) => typed.setText(event.currentTarget.value)}
            onKeyDown={(event) => {
              // Enter commits before the form's implicit submission reads
              // the value; Down Arrow opens the calendar, as in the APG
              // pattern.
              if (event.key === "Enter") typed.commitText();
              if (event.key === "ArrowDown") {
                event.preventDefault();
                typed.commitText();
                requestOpen();
              }
            }}
            placeholder={format}
            required={ariaRequired}
            type="text"
            value={typed.text}
            variant={typedError ? "error" : variant}
          />
          <PopoverTrigger asChild>
            <button
              ref={triggerRef}
              aria-controls={controlsId}
              aria-label={m.reservationDateCalendarButtonLabel(
                { field: ariaLabel },
                messageLocale
              )}
              onFocus={reservationCalendar.preload}
              onPointerDown={reservationCalendar.preload}
              onPointerEnter={reservationCalendar.preload}
              className="absolute inset-y-1 end-1 flex w-10 cursor-pointer items-center justify-center rounded-[0.85rem] text-burned-orange outline-none transition hover:bg-burned-orange/10 focus-visible:ring-2 focus-visible:ring-burned-orange"
              type="button"
            >
              <CalendarIcon aria-hidden="true" className="h-5 w-5" />
            </button>
          </PopoverTrigger>
        </div>
        <PopoverContent
          id={calendarId}
          align="end"
          aria-label={ariaLabel}
          className="w-auto p-3"
          // The calendar focuses the selected day, or today, itself.
          onOpenAutoFocus={(event) => event.preventDefault()}
          onEscapeKeyDown={() => {
            closesToFieldRef.current = true;
          }}
          onCloseAutoFocus={(event) => {
            if (!closesToFieldRef.current) return;
            closesToFieldRef.current = false;
            event.preventDefault();
            inputRef.current?.focus();
          }}
        >
          <ReservationDateCalendar
            calendar={calendar}
            isUnavailable={(date) =>
              typed.getUnavailability(date) !== undefined
            }
            locale={locale}
            onPick={(date) => {
              if (typed.getUnavailability(date)) return;

              typed.pickDate(date);
              closesToFieldRef.current = true;
              setOpenRequested(false);
              onBlur?.();
            }}
            selectedDate={selectedDate}
          />
        </PopoverContent>
      </Popover>
      <span id={formatId} className="sr-only">
        {m.reservationDateInputFormat({ format, isoFormat }, messageLocale)}
      </span>
      {selectedDate && (
        <p className="text-sm text-navy-blue/72">
          {displayValue ?? formatLongDate(selectedDate, locale)}
        </p>
      )}
      <p
        id={errorId}
        aria-live="polite"
        className="text-sm font-medium text-burned-orange empty:sr-only"
      >
        {getTypedDateErrorMessage(typedError, locale, inputFormat)}
      </p>
    </div>
  );
}

export function ReservationFormDatePicker(props: ReservationDatePickerProps) {
  const { error, formItemId, formLabelId, formMessageId } = useFormField();

  return (
    <ReservationDatePicker
      {...props}
      id={formItemId}
      ariaDescribedBy={error ? formMessageId : undefined}
      ariaInvalid={Boolean(error)}
      ariaLabelledBy={formLabelId}
      ariaRequired
    />
  );
}
