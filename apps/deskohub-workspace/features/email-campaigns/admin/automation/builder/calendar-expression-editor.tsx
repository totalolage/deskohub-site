"use client";

import {
  type CalendarExpressionType as CalendarExpression,
  type CalendarWeekdayType as CalendarWeekday,
  type CalendarWeekdayOccurrence,
  calendarWeekdays,
  emailAutomationScheduleMinutes,
} from "@deskohub/workspace-admin-api";
import { ChevronDown, Plus, X } from "lucide-react";
import { useId, useState } from "react";
import { m } from "@/features/administration/i18n";
import type { Locale } from "@/features/i18n";
import { useRouteLocale } from "@/features/i18n/route-locale";
import { Button } from "@/shared/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import { Input } from "@/shared/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import {
  ToggleGroup,
  type ToggleGroupOption,
} from "@/shared/components/ui/toggle-group";
import { cn } from "@/shared/utils";
import {
  compactInputClassName,
  compactSelectClassName,
  fieldErrorAttributes,
  ValueChips,
} from "../../audiences/audience-control-primitives";
import type { CalendarUsage } from "./calendar-preview";

/** The "X of Ys" rows a calendar can have, finest first. */
const calendarParts = [
  "minutes",
  "hours",
  "weekdays",
  "daysOfMonth",
  "weekdayOccurrences",
  "weeksOfYear",
  "months",
] as const;
type CalendarPart = (typeof calendarParts)[number];

const isCalendarPart = (key: string): key is CalendarPart =>
  calendarParts.some((part) => part === key);

type PartValue<Part extends CalendarPart> = NonNullable<
  CalendarExpression[Part]
>;

/** What a newly added or switched row starts with. */
const partDefaults = {
  minutes: [0],
  hours: [9],
  weekdays: ["monday"],
  daysOfMonth: [1],
  weekdayOccurrences: [{ occurrence: 1, weekday: "monday" }],
  weeksOfYear: [1],
  months: [1],
} satisfies { readonly [Part in CalendarPart]: PartValue<Part> };

const partsOf = (expression: CalendarExpression) =>
  Object.keys(expression).filter(isCalendarPart);

/** The expression with `from`'s row turned into `to`, in the same place. */
const switchPart = (
  expression: CalendarExpression,
  from: CalendarPart,
  to: CalendarPart
): CalendarExpression =>
  Object.fromEntries(
    Object.entries(expression).map(([part, value]) =>
      part === from ? [to, partDefaults[to]] : [part, value]
    )
  );

const withoutPart = (
  expression: CalendarExpression,
  removed: CalendarPart
): CalendarExpression =>
  Object.fromEntries(
    Object.entries(expression).filter(([part]) => part !== removed)
  );

/** A list with at least one value, as every calendar part needs. */
const nonEmpty = <Value,>(
  values: readonly Value[]
): readonly [Value, ...Value[]] | undefined =>
  values.length > 0 ? (values as readonly [Value, ...Value[]]) : undefined;

const twoDigits = (value: number) => value.toString().padStart(2, "0");

/** Localized short weekday and month names; no time, so they hydrate alike. */
const weekdayName = (weekday: CalendarWeekday, locale: Locale) =>
  new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }).format(
    // 2024-01-01 was a Monday.
    Date.UTC(2024, 0, 1 + calendarWeekdays.indexOf(weekday))
  );

const monthName = (month: number, locale: Locale) =>
  new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" }).format(
    Date.UTC(2024, month - 1, 1)
  );

/**
 * One part's values in one grouped box. The last chosen value can't be
 * turned off, because a part needs at least one; remove the part instead.
 */
function PartToggles<Value extends string | number>({
  label,
  options,
  selected,
  onChange,
  className,
}: {
  readonly label: string;
  readonly options: readonly ToggleGroupOption<Value>[];
  readonly selected: readonly Value[];
  readonly onChange: (values: readonly [Value, ...Value[]]) => void;
  readonly className?: string;
}) {
  return (
    <ToggleGroup
      label={label}
      className={className}
      options={options.map((option) => ({
        ...option,
        disabled: selected.length === 1 && selected.includes(option.value),
      }))}
      value={selected}
      onValueChange={(values) => {
        const chosen = nonEmpty(values);
        if (chosen) onChange(chosen);
      }}
    />
  );
}

/**
 * Typed values beside quick chips, such as minute 10 or week 23: each shows
 * as a removable chip, and a number field adds more.
 */
function TypedValues({
  values,
  labelOf,
  min,
  max,
  inputLabel,
  addLabel,
  removable,
  onAdd,
  onRemove,
  errorId,
}: {
  readonly values: readonly number[];
  readonly labelOf: (value: number) => string;
  readonly min: number;
  readonly max: number;
  readonly inputLabel: string;
  readonly addLabel: string;
  readonly removable: boolean;
  readonly onAdd: (value: number) => void;
  readonly onRemove: (value: number) => void;
  /** The id of the port's refusal of these values, while there is one. */
  readonly errorId?: string;
}) {
  const locale = useRouteLocale();
  const [draft, setDraft] = useState("");
  const parsed = Number(draft);
  const valid =
    draft !== "" && Number.isInteger(parsed) && parsed >= min && parsed <= max;
  const add = () => {
    if (!valid) return;
    onAdd(parsed);
    setDraft("");
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {values.length > 0 && (
        <ValueChips
          values={values.map(String)}
          labelOf={(value) => labelOf(Number(value))}
          onRemove={(value) => removable && onRemove(Number(value))}
          removeLabel={(label) =>
            m.emailAutomationFlowCalendarRemoveValue(
              { value: label },
              { locale }
            )
          }
        />
      )}
      <span className="inline-flex items-center gap-1">
        <Input
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          step={1}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              add();
            }
          }}
          aria-label={inputLabel}
          placeholder={inputLabel}
          {...(errorId === undefined
            ? {}
            : fieldErrorAttributes(errorId, true))}
          variant={errorId === undefined ? "default" : "error"}
          className={cn(compactInputClassName, "w-40")}
        />
        <Button
          type="button"
          variant="ghost"
          tone="outline"
          size="sm"
          disabled={!valid}
          onClick={add}
        >
          <Plus className="h-4 w-4" aria-hidden />
          {addLabel}
        </Button>
      </span>
    </div>
  );
}

/** Adds `value` to a sorted numeric part, keeping it ascending. */
const withNumber = (values: readonly number[], value: number) =>
  nonEmpty([...new Set([...values, value])].sort((a, b) => a - b));

/**
 * The quarter-hour minutes in one grouped box. A schedule can only start on
 * the contract's quarter hours (D36), so it offers nothing else and only
 * lets stray saved minutes be removed; a wait can also take any typed minute.
 */
function MinutesPicker({
  value,
  onChange,
  usage,
  errorId,
}: {
  readonly value: PartValue<"minutes">;
  readonly onChange: (value: PartValue<"minutes">) => void;
  readonly usage: CalendarUsage;
  /** The id of the port's refusal of these minutes, while there is one. */
  readonly errorId: string | undefined;
}) {
  const locale = useRouteLocale();
  const others = value.filter(
    (minute) => !emailAutomationScheduleMinutes.includes(minute)
  );
  const remove = (minute: number) => {
    const next = nonEmpty(value.filter((current) => current !== minute));
    if (next) onChange(next);
  };
  const labelOf = (minute: number) => `:${twoDigits(minute)}`;
  return (
    <div className="space-y-2">
      <ToggleGroup
        label={m.emailAutomationFlowCalendarPart(
          { part: "minutes" },
          { locale }
        )}
        className="inline-grid grid-cols-4"
        describedBy={errorId}
        options={emailAutomationScheduleMinutes.map((minute) => ({
          value: minute,
          label: labelOf(minute),
          className: "px-3",
          disabled: value.length === 1 && value.includes(minute),
        }))}
        // Typed minutes stay chosen while the quarter hours change.
        value={value}
        onValueChange={(quarters) => {
          const next = nonEmpty([...quarters, ...others].sort((a, b) => a - b));
          if (next) onChange(next);
        }}
      />
      {usage === "wait" ? (
        <TypedValues
          values={others}
          labelOf={labelOf}
          min={0}
          max={59}
          inputLabel={m.emailAutomationFlowCalendarMinuteOther({}, { locale })}
          addLabel={m.emailAutomationFlowCalendarMinuteAdd({}, { locale })}
          removable={value.length > 1}
          errorId={errorId}
          onAdd={(minute) => {
            const next = withNumber(value, minute);
            if (next) onChange(next);
          }}
          onRemove={remove}
        />
      ) : (
        others.length > 0 && (
          <ValueChips
            values={others.map(String)}
            labelOf={(minute) => labelOf(Number(minute))}
            onRemove={(minute) => value.length > 1 && remove(Number(minute))}
            removeLabel={(label) =>
              m.emailAutomationFlowCalendarRemoveValue(
                { value: label },
                { locale }
              )
            }
          />
        )
      )}
    </div>
  );
}

const occurrences = [1, 2, 3, 4, 5, "last"] as const;
type Occurrence = CalendarWeekdayOccurrence["occurrence"];
const isOccurrence = (value: string): Occurrence | undefined =>
  occurrences.find((occurrence) => String(occurrence) === value);
const isWeekday = (value: string): CalendarWeekday | undefined =>
  calendarWeekdays.find((weekday) => weekday === value);

function WeekdayOccurrencesPicker({
  value,
  onChange,
}: {
  readonly value: PartValue<"weekdayOccurrences">;
  readonly onChange: (value: PartValue<"weekdayOccurrences">) => void;
}) {
  const locale = useRouteLocale();
  const replaceAt = (index: number, next: CalendarWeekdayOccurrence) => {
    const list = nonEmpty(
      value.map((current, i) => (i === index ? next : current))
    );
    if (list) onChange(list);
  };
  const unused = occurrences
    .flatMap((occurrence) =>
      calendarWeekdays.map((weekday) => ({ occurrence, weekday }))
    )
    .find(
      (candidate) =>
        !value.some(
          (current) =>
            current.occurrence === candidate.occurrence &&
            current.weekday === candidate.weekday
        )
    );
  return (
    <div className="space-y-2">
      <ul className="space-y-1.5">
        {value.map((entry, index) => (
          <li
            key={`${entry.occurrence}-${entry.weekday}`}
            className="flex flex-wrap items-center gap-1.5"
          >
            <Select
              value={String(entry.occurrence)}
              onValueChange={(next) => {
                const occurrence = isOccurrence(next);
                if (occurrence !== undefined) {
                  replaceAt(index, { ...entry, occurrence });
                }
              }}
            >
              <SelectTrigger
                aria-label={m.emailAutomationFlowCalendarOccurrenceLabel(
                  {},
                  { locale }
                )}
                className={compactSelectClassName}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {occurrences.map((occurrence) => (
                  <SelectItem key={occurrence} value={String(occurrence)}>
                    {m.emailAutomationFlowCalendarOccurrence(
                      { occurrence: String(occurrence) },
                      { locale }
                    )}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select
              value={entry.weekday}
              onValueChange={(next) => {
                const weekday = isWeekday(next);
                if (weekday) replaceAt(index, { ...entry, weekday });
              }}
            >
              <SelectTrigger
                aria-label={m.emailAutomationFlowCalendarOccurrenceWeekdayLabel(
                  {},
                  { locale }
                )}
                className={compactSelectClassName}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {calendarWeekdays.map((weekday) => (
                  <SelectItem key={weekday} value={weekday}>
                    {weekdayName(weekday, locale)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              variant="ghost"
              tone="muted"
              size="icon-sm"
              disabled={value.length === 1}
              onClick={() => {
                const list = nonEmpty(value.filter((_, i) => i !== index));
                if (list) onChange(list);
              }}
              aria-label={m.emailAutomationFlowCalendarOccurrenceRemove(
                {},
                { locale }
              )}
            >
              <X className="h-4 w-4" aria-hidden />
            </Button>
          </li>
        ))}
      </ul>
      {unused && (
        <Button
          type="button"
          variant="ghost"
          tone="outline"
          size="sm"
          onClick={() => onChange([...value, unused])}
        >
          <Plus className="h-4 w-4" aria-hidden />
          {m.emailAutomationFlowCalendarOccurrenceAdd({}, { locale })}
        </Button>
      )}
    </div>
  );
}

/** The value picker that suits one part. */
function PartValuePicker({
  part,
  expression,
  onChange,
  usage,
  minutesErrorId,
}: {
  readonly part: CalendarPart;
  readonly expression: CalendarExpression;
  readonly onChange: (expression: CalendarExpression) => void;
  readonly usage: CalendarUsage;
  readonly minutesErrorId: string | undefined;
}) {
  const locale = useRouteLocale();
  const set = <Part extends CalendarPart>(name: Part, value: PartValue<Part>) =>
    onChange({ ...expression, [name]: value });
  const label = m.emailAutomationFlowCalendarPart({ part }, { locale });

  switch (part) {
    case "minutes":
      return (
        <MinutesPicker
          value={expression.minutes ?? partDefaults.minutes}
          onChange={(value) => set("minutes", value)}
          usage={usage}
          errorId={minutesErrorId}
        />
      );
    case "hours":
      return (
        <PartToggles
          label={label}
          className="grid grid-cols-6 @2xl:grid-cols-12"
          options={Array.from({ length: 24 }, (_, hour) => ({
            value: hour,
            label: twoDigits(hour),
            name: `${twoDigits(hour)}:00`,
          }))}
          selected={expression.hours ?? []}
          onChange={(value) => set("hours", value)}
        />
      );
    case "weekdays":
      return (
        <PartToggles
          label={label}
          className="grid max-w-sm grid-cols-7"
          options={calendarWeekdays.map((weekday) => ({
            value: weekday,
            label: weekdayName(weekday, locale),
          }))}
          selected={expression.weekdays ?? []}
          onChange={(value) => set("weekdays", value)}
        />
      );
    case "daysOfMonth":
      return (
        <PartToggles<number | "last">
          label={label}
          // A month sheet: seven columns, with "last" filling the fifth row.
          className="grid max-w-sm grid-cols-7"
          options={[
            ...Array.from({ length: 31 }, (_, index) => ({
              value: index + 1,
              label: String(index + 1),
            })),
            {
              value: "last" as const,
              label: m.emailAutomationFlowCalendarLastDay({}, { locale }),
              className: "col-span-4",
            },
          ]}
          selected={expression.daysOfMonth ?? []}
          onChange={(value) => set("daysOfMonth", value)}
        />
      );
    case "weekdayOccurrences":
      return (
        <WeekdayOccurrencesPicker
          value={
            expression.weekdayOccurrences ?? partDefaults.weekdayOccurrences
          }
          onChange={(value) => set("weekdayOccurrences", value)}
        />
      );
    case "weeksOfYear": {
      const weeks = expression.weeksOfYear ?? partDefaults.weeksOfYear;
      return (
        <TypedValues
          values={weeks}
          labelOf={(week) =>
            m.emailAutomationFlowCalendarWeekValue({ week }, { locale })
          }
          min={1}
          max={53}
          inputLabel={m.emailAutomationFlowCalendarWeekOther({}, { locale })}
          addLabel={m.emailAutomationFlowCalendarWeekAdd({}, { locale })}
          removable={weeks.length > 1}
          onAdd={(week) => {
            const next = withNumber(weeks, week);
            if (next) set("weeksOfYear", next);
          }}
          onRemove={(week) => {
            const next = nonEmpty(weeks.filter((current) => current !== week));
            if (next) set("weeksOfYear", next);
          }}
        />
      );
    }
    case "months":
      return (
        <PartToggles
          label={label}
          className="grid grid-cols-6 @2xl:grid-cols-12"
          options={Array.from({ length: 12 }, (_, index) => ({
            value: index + 1,
            label: monthName(index + 1, locale),
          }))}
          selected={expression.months ?? []}
          onChange={(value) => set("months", value)}
        />
      );
  }
}

/**
 * An "X of Ys" calendar in Prague time (D11, D16): one row per part, such
 * as hour of the day or day of the week, each with the values that match.
 * The port describes and checks the result; this only edits it.
 */
export function CalendarExpressionEditor({
  value,
  onChange,
  usage,
  minutesError,
}: {
  readonly value: CalendarExpression;
  readonly onChange: (value: CalendarExpression) => void;
  readonly usage: CalendarUsage;
  /** The port's refusal of this calendar's minutes, shown on their row. */
  readonly minutesError?: string | undefined;
}) {
  const locale = useRouteLocale();
  const rowId = useId();
  const parts = partsOf(value);
  const unused = calendarParts.filter((part) => !parts.includes(part));

  return (
    <div className="space-y-2" data-calendar-usage={usage}>
      <ol className="space-y-2">
        {parts.map((part) => (
          <li
            key={part}
            className="space-y-2 rounded-lg border border-navy-blue/12 bg-navy-blue/[0.02] p-2.5 @md:flex @md:items-start @md:gap-3 @md:space-y-0"
          >
            <div className="flex items-center justify-between gap-2 @md:w-52 @md:shrink-0">
              <Select
                value={part}
                onValueChange={(next) => {
                  if (isCalendarPart(next) && next !== part) {
                    onChange(switchPart(value, part, next));
                  }
                }}
              >
                <SelectTrigger
                  id={`${rowId}-${part}`}
                  aria-label={m.emailAutomationFlowCalendarPartLabel(
                    {},
                    { locale }
                  )}
                  className={cn(compactSelectClassName, "w-full bg-white")}
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {[part, ...unused].map((option) => (
                    <SelectItem key={option} value={option}>
                      {m.emailAutomationFlowCalendarPart(
                        { part: option },
                        { locale }
                      )}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                type="button"
                variant="ghost"
                tone="muted"
                size="icon-sm"
                className="@md:hidden"
                disabled={parts.length === 1}
                onClick={() => onChange(withoutPart(value, part))}
                aria-label={m.emailAutomationFlowCalendarRemovePart(
                  {
                    part: m.emailAutomationFlowCalendarPart(
                      { part },
                      { locale }
                    ),
                  },
                  { locale }
                )}
              >
                <X className="h-4 w-4" aria-hidden />
              </Button>
            </div>
            <div className="min-w-0 flex-1 space-y-2">
              <PartValuePicker
                part={part}
                expression={value}
                onChange={onChange}
                usage={usage}
                minutesErrorId={
                  minutesError === undefined
                    ? undefined
                    : `${rowId}-minutes-error`
                }
              />
              {part === "minutes" && (
                <p
                  id={`${rowId}-minutes-error`}
                  role="alert"
                  className="text-burned-orange text-sm empty:hidden"
                >
                  {minutesError}
                </p>
              )}
            </div>
            <Button
              type="button"
              variant="ghost"
              tone="muted"
              size="icon-sm"
              className="hidden @md:inline-flex"
              disabled={parts.length === 1}
              onClick={() => onChange(withoutPart(value, part))}
              aria-label={m.emailAutomationFlowCalendarRemovePart(
                {
                  part: m.emailAutomationFlowCalendarPart({ part }, { locale }),
                },
                { locale }
              )}
            >
              <X className="h-4 w-4" aria-hidden />
            </Button>
          </li>
        ))}
      </ol>
      {unused.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="secondary" size="sm">
              <Plus className="h-4 w-4" aria-hidden />
              {m.emailAutomationFlowCalendarAddPart({}, { locale })}
              <ChevronDown className="h-3.5 w-3.5" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {unused.map((part) => (
              <DropdownMenuItem
                key={part}
                onSelect={() =>
                  onChange({ ...value, [part]: partDefaults[part] })
                }
              >
                {m.emailAutomationFlowCalendarPart({ part }, { locale })}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}
