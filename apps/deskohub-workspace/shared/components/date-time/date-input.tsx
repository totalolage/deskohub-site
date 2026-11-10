"use client";

import { Option } from "effect";
import { CalendarIcon } from "lucide-react";
import { type Ref, useEffect, useId, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { isLocale, m } from "@/features/i18n";
import { useRouteLocale } from "@/features/i18n/route-locale";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/shared/components/ui/popover";
import { cn } from "@/shared/utils";
import { composeRefs } from "@/shared/utils/compose-refs";
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
import {
  type ControlBound,
  fromCalendarDate,
  parseCanonicalDate,
  resolveBound,
  toCalendarDate,
} from "./canonical-value";
import { useControllableValue } from "./use-controllable-value";
import { useFormReset } from "./use-form-reset";
import { useSubmitGuard } from "./use-submit-guard";

/** Values are canonical `YYYY-MM-DD` dates; an empty string is no date. */
export type DateInputProps = {
  readonly "aria-describedby"?: string | undefined;
  readonly "aria-invalid"?: boolean | undefined;
  /** A visible label that names the text field instead of `label`. */
  readonly "aria-labelledby"?: string | undefined;
  readonly className?: string | undefined;
  readonly defaultValue?: string | undefined;
  readonly disabled?: boolean | undefined;
  /**
   * The selected date as shown under the field: the long date by default, or
   * nothing with `false`.
   */
  readonly displayValue?: string | false | undefined;
  readonly id?: string | undefined;
  /** Dates the calendar doesn't offer and typed text can't choose. */
  readonly isDateDisabled?: ((date: Temporal.PlainDate) => boolean) | undefined;
  /** Names the field, its calendar button, and the calendar. */
  readonly label: string;
  /** Defaults to the route locale. */
  readonly locale?: string | undefined;
  readonly maximum?: ControlBound | undefined;
  readonly minimum?: ControlBound | undefined;
  /** Submits the value with the form under this name. */
  readonly name?: string | undefined;
  readonly onBlur?: (() => void) | undefined;
  readonly onChange?: ((value: string) => void) | undefined;
  readonly ref?: Ref<HTMLInputElement> | undefined;
  readonly required?: boolean | undefined;
  readonly value?: string | undefined;
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
// is idle or the calendar button is approached, and the popover opens only
// once it is loaded, so the popover never shows a loading state. An open
// requested before then is dropped if the user moves on.
const calendarModule = createPreloadableModule(
  () => import("@/shared/components/ui/calendar")
);
type CalendarModule = typeof import("@/shared/components/ui/calendar");

const formatLongDate = (date: Temporal.PlainDate, locale: string) =>
  formatPlainDate({ date, dateStyle: "long", locale });

/** The numeric date format the field takes, worded for the reader. */
const getDateInputFormat = (locale: string) => {
  const messageLocale = isLocale(locale) ? { locale } : undefined;
  const tokens = {
    day: m.dateInputDayToken({}, messageLocale),
    month: m.dateInputMonthToken({}, messageLocale),
    year: m.dateInputYearToken({}, messageLocale),
  };
  return {
    format: formatNumericPlainDatePattern({ locale, tokens }),
    isoFormat: `${tokens.year}-${tokens.month}-${tokens.day}`,
    messageLocale,
  };
};

const getTypedDateErrorMessage = (
  typedError: TypedDateError | undefined,
  locale: string,
  { format, isoFormat, messageLocale }: ReturnType<typeof getDateInputFormat>
) => {
  if (!typedError) return undefined;
  if (typedError.kind === "invalid") {
    return m.dateInputInvalid({ format, isoFormat }, messageLocale);
  }
  return {
    afterMaximum: m.dateInputAfterMaximum,
    beforeMinimum: m.dateInputBeforeMinimum,
    unavailable: m.dateInputUnavailable,
  }[typedError.kind](
    { date: formatLongDate(typedError.date, locale) },
    messageLocale
  );
};

/**
 * The calendar popover's open state. The popover opens only once the
 * calendar is loaded; until then, leaving the calendar button drops the open
 * request.
 */
function useCalendarPopover(onBlur: (() => void) | undefined) {
  const [openRequested, setOpenRequested] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const fieldRef = useRef<HTMLInputElement>(null);
  // Escape, a pick, and Clear close the calendar back into the text field,
  // as in the APG pattern; other closes keep Radix's focus handling.
  const closesToFieldRef = useRef(false);
  const calendar = useLoadedModule(calendarModule);
  usePreloadWhenIdle(calendarModule);
  const openPending = openRequested && calendar === undefined;

  useEffect(() => {
    if (!openPending) return;

    // Leaving the button dismisses the pending open as it would dismiss the
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
    fieldRef,
    open: openRequested && calendar !== undefined,
    requestOpen: () => {
      calendarModule.preload();
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
function useTypedDate({
  committedValue,
  isDateDisabled,
  locale,
  maximum,
  minimum,
  setValue,
}: Pick<DateInputProps, "isDateDisabled" | "maximum" | "minimum"> & {
  readonly committedValue: string;
  readonly locale: string;
  readonly setValue: (value: string) => void;
}) {
  const selectedDate = parseCanonicalDate(committedValue);
  const formatText = (date: string) => {
    const parsedDate = parseCanonicalDate(date);
    return parsedDate
      ? formatNumericPlainDate({ date: parsedDate, locale })
      : "";
  };

  const [text, setText] = useState(() => formatText(committedValue));
  const [typedError, setTypedError] = useState<TypedDateError>();
  const [syncedValue, setSyncedValue] = useState(committedValue);
  if (committedValue !== syncedValue) {
    // A date set from outside the field, such as a restored selection or a
    // form reset, replaces whatever was typed.
    setSyncedValue(committedValue);
    setText(formatText(committedValue));
    setTypedError(undefined);
  }

  // Bounds are read at each check, so a bound that moved since the last
  // render still holds.
  const getUnavailability = (
    date: Temporal.PlainDate
  ): TypedDateError | undefined => {
    const minimumDate = parseCanonicalDate(resolveBound(minimum));
    const maximumDate = parseCanonicalDate(resolveBound(maximum));
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
    if (nextValue !== committedValue) setValue(nextValue);
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
  const pickDate = (date: Temporal.PlainDate | undefined) => {
    setText(date ? formatNumericPlainDate({ date, locale }) : "");
    setTypedError(undefined);
    commitValue(date?.toString() ?? "");
  };

  /** Shows the value's date and drops any typed text and its error. */
  const showValue = (nextValue: string) => {
    setSyncedValue(nextValue);
    setText(formatText(nextValue));
    setTypedError(undefined);
  };

  return {
    commitText,
    getUnavailability,
    pickDate,
    showValue,
    selectedDate,
    setText,
    text,
    typedError,
  };
}

function DateInputCalendar({
  calendar,
  isUnavailable,
  locale,
  maximumDate,
  minimumDate,
  onPick,
  selectedDate,
}: {
  readonly calendar: CalendarModule | undefined;
  readonly isUnavailable: (date: Temporal.PlainDate) => boolean;
  readonly locale: string;
  readonly maximumDate: Temporal.PlainDate | undefined;
  readonly minimumDate: Temporal.PlainDate | undefined;
  readonly onPick: (date: Temporal.PlainDate) => void;
  readonly selectedDate: Temporal.PlainDate | undefined;
}) {
  if (!calendar) return null;

  return (
    <calendar.Calendar
      autoFocus
      defaultMonth={selectedDate ? toCalendarDate(selectedDate) : undefined}
      // The calendar keeps to the bounds' months, so it opens on a month
      // with days it offers, even when today is outside the bounds.
      endMonth={maximumDate ? toCalendarDate(maximumDate) : undefined}
      startMonth={minimumDate ? toCalendarDate(minimumDate) : undefined}
      locale={calendar.getCalendarLocale(locale)}
      disabled={(date) => isUnavailable(fromCalendarDate(date))}
      mode="single"
      onSelect={(date) => {
        if (date) onPick(fromCalendarDate(date));
      }}
      selected={selectedDate ? toCalendarDate(selectedDate) : undefined}
    />
  );
}

/**
 * A date field that takes a typed date or a calendar pick, following the APG
 * date picker combobox: the text field is the control, and its button or Down
 * Arrow opens the calendar dialog. Typed text becomes the field's value on
 * blur, Enter, or opening the calendar. Text that is no date, or a date the
 * calendar would not offer, clears the value and shows why, so the form never
 * holds a date the field does not show; while it shows such text, the owning
 * form doesn't submit. Escape, a pick, or Clear closes the calendar back into
 * the text field.
 */
export function DateInput({
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
  "aria-labelledby": ariaLabelledBy,
  className,
  defaultValue,
  disabled = false,
  displayValue,
  id,
  isDateDisabled,
  label,
  locale: localeProp,
  maximum,
  minimum,
  name,
  onBlur,
  onChange,
  ref,
  required = false,
  value,
}: DateInputProps) {
  const routeLocale = useRouteLocale();
  const locale = localeProp ?? routeLocale;
  // Destructured, so the React Compiler sees the refs as refs and the open
  // state as a plain value.
  const {
    calendar,
    closesToFieldRef,
    fieldRef,
    open,
    requestOpen,
    setOpenRequested,
    triggerRef,
  } = useCalendarPopover(onBlur);
  const baseId = useId();
  const calendarId = `${baseId}-calendar`;
  const formatId = `${baseId}-format`;
  const errorId = `${baseId}-error`;
  // A value that is no canonical date shows as empty instead of being
  // re-shaped.
  const toCanonical = (date: string | undefined) =>
    parseCanonicalDate(date) ? (date ?? "") : "";
  const committed = useControllableValue({
    defaultValue: toCanonical(defaultValue),
    onChange,
    value: value === undefined ? undefined : toCanonical(value),
  });
  const typed = useTypedDate({
    committedValue: committed.value,
    isDateDisabled,
    locale,
    maximum,
    minimum,
    setValue: committed.setValue,
  });
  const inputFormat = getDateInputFormat(locale);
  const { format, isoFormat, messageLocale } = inputFormat;
  const { selectedDate, typedError } = typed;
  const controlsId = open ? calendarId : undefined;
  const hiddenFieldRef = useRef<HTMLInputElement>(null);
  useFormReset(hiddenFieldRef, () => {
    committed.reset();
    typed.showValue(
      committed.isControlled ? committed.value : toCanonical(defaultValue)
    );
  });
  // Text the field cannot take blocks submission, so the form never submits
  // an empty value while the field shows text.
  useSubmitGuard(hiddenFieldRef, () => {
    if (disabled) return false;
    // The submission reads the form right after this, so the commit renders
    // now.
    if (flushSync(() => typed.commitText())) return false;
    fieldRef.current?.focus();
    return true;
  });

  const closeToField = () => {
    closesToFieldRef.current = true;
    setOpenRequested(false);
    onBlur?.();
  };

  return (
    // The field's own width decides where the calendar button goes: beside
    // the text where the cell leaves room for a whole date, on its own row
    // below in a narrow cell, so the text keeps the full width.
    <div
      className={cn(
        "@container/date-field flex min-w-0 flex-col gap-2",
        className
      )}
    >
      <input
        ref={hiddenFieldRef}
        disabled={disabled}
        name={name}
        type="hidden"
        value={committed.value}
      />
      <Popover
        open={open}
        onOpenChange={(nextOpen) => {
          if (disabled) return;
          // The popover opens once the calendar is loaded. A failed chunk load
          // leaves it closed; the next open request retries it.
          if (nextOpen) {
            typed.commitText();
            calendarModule.preload();
          }
          setOpenRequested(nextOpen);
          // Closing the calendar is the field's blur; this lets onBlur form
          // validation run.
          if (!nextOpen) onBlur?.();
        }}
      >
        <div className="relative @max-[12rem]/date-field:grid @max-[12rem]/date-field:gap-2">
          <Input
            ref={composeRefs(fieldRef, ref)}
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
            aria-label={ariaLabelledBy ? undefined : label}
            aria-labelledby={ariaLabelledBy}
            autoComplete="off"
            className="pe-12 @max-[12rem]/date-field:px-3"
            disabled={disabled}
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
            required={required}
            type="text"
            value={typed.text}
            variant={ariaInvalid || typedError ? "error" : "default"}
          />
          <PopoverTrigger asChild>
            <button
              ref={triggerRef}
              aria-controls={controlsId}
              aria-label={m.dateInputCalendarButtonLabel(
                { field: label },
                messageLocale
              )}
              disabled={disabled}
              onFocus={calendarModule.preload}
              onPointerDown={calendarModule.preload}
              onPointerEnter={calendarModule.preload}
              className="absolute inset-y-1 end-1 flex w-10 cursor-pointer items-center justify-center rounded-[0.85rem] text-burned-orange outline-none transition hover:bg-burned-orange/10 focus-visible:ring-2 focus-visible:ring-burned-orange disabled:cursor-not-allowed disabled:opacity-50 @max-[12rem]/date-field:static @max-[12rem]/date-field:h-10 @max-[12rem]/date-field:w-full @max-[12rem]/date-field:border @max-[12rem]/date-field:border-navy-blue/45 @max-[12rem]/date-field:bg-white"
              type="button"
            >
              <CalendarIcon aria-hidden="true" className="h-5 w-5" />
            </button>
          </PopoverTrigger>
        </div>
        <PopoverContent
          id={calendarId}
          align="end"
          aria-label={label}
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
            fieldRef.current?.focus();
          }}
        >
          <div className="grid gap-2">
            <DateInputCalendar
              calendar={calendar}
              isUnavailable={(date) =>
                typed.getUnavailability(date) !== undefined
              }
              locale={locale}
              maximumDate={parseCanonicalDate(resolveBound(maximum))}
              minimumDate={parseCanonicalDate(resolveBound(minimum))}
              onPick={(date) => {
                if (typed.getUnavailability(date)) return;

                typed.pickDate(date);
                closeToField();
              }}
              selectedDate={selectedDate}
            />
            {selectedDate && (
              <Button
                className="justify-self-start"
                onClick={() => {
                  typed.pickDate(undefined);
                  closeToField();
                }}
                size="sm"
                type="button"
                variant="ghost"
              >
                {m.dateInputClear({}, messageLocale)}
              </Button>
            )}
          </div>
        </PopoverContent>
      </Popover>
      <span id={formatId} className="sr-only">
        {m.dateInputFormat({ format, isoFormat }, messageLocale)}
      </span>
      {selectedDate && displayValue !== false && (
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
