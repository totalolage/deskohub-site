"use client";

import type {
  AudienceBooleanCondition,
  AudienceChoiceParam,
  AudienceCountAttributeDefinition,
  AudienceCountCondition,
  AudienceDateAttributeDefinition,
  AudienceDateCondition,
  AudienceSetAttributeDefinition,
  AudienceSetCondition,
  DatePeriodUnitType,
} from "@deskohub/workspace-admin-api";
import { Match } from "effect";
import { ChevronDown } from "lucide-react";
import { useId, useState } from "react";
import { m } from "@/features/administration/i18n";
import type { Locale } from "@/features/i18n";
import { useRouteLocale } from "@/features/i18n/route-locale";
import { getCurrentWorkspaceDate } from "@/features/reservation/reservation-date";
import { Button } from "@/shared/components/ui/button";
import { Checkbox } from "@/shared/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import { Input } from "@/shared/components/ui/input";
import { SegmentedControl } from "@/shared/components/ui/segmented-control";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { cn } from "@/shared/utils";
import type { DatePeriod } from "../../date-period";
import type {
  AudienceValueLookups,
  AudienceValueOption,
} from "../audience-filter-summary";
import type {
  AudienceBooleanWording,
  AudienceChoiceWording,
  AudienceCountWording,
  AudienceDateWording,
  AudienceMessage,
  AudienceSetWording,
  AudienceValueEntryWording,
} from "./audience-attribute-wording";
import {
  ConditionLine,
  ConditionText,
  type ControlProps,
  CountComparisonControl,
  compactInputClassName,
  compactSelectClassName,
  countComparisonError,
  FieldError,
  type FieldErrorLookup,
  numberFromInput,
  numberInputValue,
  SetOperatorSelect,
  ValueChips,
  withPath,
} from "./audience-control-primitives";
import {
  type DatePeriodKind,
  isDatePeriodUnit,
  switchDatePeriod,
  toggleSetValue,
} from "./audience-filter-editing";
import { ProductFilterControl } from "./reservation-product-filter-control";

const datePeriodKinds: readonly DatePeriodKind[] = [
  "AnyTime",
  "Last",
  "Range",
  "Since",
  "Onward",
  "Until",
];

const isDatePeriodKind = (value: string): value is DatePeriodKind =>
  datePeriodKinds.some((kind) => kind === value);

/** The unit after "in the last N", for N. */
const datePeriodUnits: Readonly<
  Record<DatePeriodUnitType, AudienceMessage<{ readonly count: number }>>
> = {
  day: m.emailCampaignsAudiencePeriodUnitDay,
  week: m.emailCampaignsAudiencePeriodUnitWeek,
  month: m.emailCampaignsAudiencePeriodUnitMonth,
  year: m.emailCampaignsAudiencePeriodUnitYear,
};

const datePeriodUnit = (
  unit: DatePeriodUnitType,
  count: number,
  locale: Locale
) => datePeriodUnits[unit]({ count }, { locale });

const today = () => getCurrentWorkspaceDate().toString();

/**
 * Any time, the last N days/weeks/months/years, from–to, since, or until. The
 * same control picks every period an audience condition uses.
 */
function DatePeriodControl({
  value,
  onChange,
  errorAt,
  label,
}: ControlProps<DatePeriod> & {
  /** What the period applies to, for screen readers. */
  readonly label: string;
}) {
  const locale = useRouteLocale();
  const subject = { subject: label };
  const dateInput = (
    date: string,
    field: string,
    fieldLabel: string,
    update: (date: string) => DatePeriod,
    bounds: { readonly min?: string; readonly max?: string } = {}
  ) => (
    <Input
      type="date"
      value={date}
      {...bounds}
      onChange={(event) => onChange(update(event.target.value))}
      aria-label={fieldLabel}
      variant={errorAt(field) || errorAt("") ? "error" : "default"}
      className={cn(compactInputClassName, "w-40 max-w-full")}
    />
  );

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <Select
        value={value._tag}
        onValueChange={(kind) => {
          if (isDatePeriodKind(kind)) {
            onChange(switchDatePeriod(value, kind, today()));
          }
        }}
      >
        <SelectTrigger
          aria-label={m.emailCampaignsAudiencePeriodLabel(subject, { locale })}
          className={compactSelectClassName}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {datePeriodKinds.map((kind) => (
            <SelectItem key={kind} value={kind}>
              {kind === "Last" && value._tag === "Last"
                ? m.emailCampaignsAudiencePeriodLast(
                    { count: value.count },
                    { locale }
                  )
                : m.emailCampaignsAudiencePeriodKind({ kind }, { locale })}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {value._tag === "Last" && (
        <span className="inline-flex items-center gap-1.5">
          <Input
            type="number"
            inputMode="numeric"
            min={1}
            step={1}
            value={numberInputValue(value.count)}
            onChange={(event) =>
              onChange({
                ...value,
                count: numberFromInput(event.target.value),
              })
            }
            aria-label={m.emailCampaignsAudiencePeriodCountLabel(
              // Any count above one names the units in general.
              { subject: label, units: datePeriodUnit(value.unit, 2, locale) },
              { locale }
            )}
            variant={errorAt("count") ? "error" : "default"}
            className={cn(compactInputClassName, "w-20")}
          />
          <Select
            value={value.unit}
            onValueChange={(unit) => {
              if (isDatePeriodUnit(unit)) onChange({ ...value, unit });
            }}
          >
            <SelectTrigger
              aria-label={m.emailCampaignsAudiencePeriodUnitLabel(subject, {
                locale,
              })}
              className={compactSelectClassName}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {Object.keys(datePeriodUnits)
                .filter(isDatePeriodUnit)
                .map((unit) => (
                  <SelectItem key={unit} value={unit}>
                    {datePeriodUnit(unit, value.count, locale)}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </span>
      )}
      {value._tag === "Range" && (
        <>
          {dateInput(
            value.from,
            "from",
            m.emailCampaignsAudiencePeriodStartLabel(subject, { locale }),
            (from) => ({ ...value, from }),
            { max: value.to }
          )}
          <ConditionText>
            {m.emailCampaignsAudiencePeriodTo({}, { locale })}
          </ConditionText>
          {dateInput(
            value.to,
            "to",
            m.emailCampaignsAudiencePeriodEndLabel(subject, { locale }),
            (to) => ({ ...value, to }),
            { min: value.from }
          )}
        </>
      )}
      {(value._tag === "Since" ||
        value._tag === "Onward" ||
        value._tag === "Until") &&
        dateInput(
          value.date,
          "date",
          m.emailCampaignsAudiencePeriodDateLabel(subject, { locale }),
          (date) => ({ ...value, date })
        )}
      {value._tag === "Onward" && (
        <ConditionText>
          {m.emailCampaignsAudiencePeriodOnward({}, { locale })}
        </ConditionText>
      )}
    </span>
  );
}

/** Plain instructions for a period's invalid fields. */
const datePeriodErrors = (
  errorAt: FieldErrorLookup,
  locale: Locale
): readonly string[] => [
  ...(errorAt("count")
    ? [m.emailCampaignsAudiencePeriodCountError({}, { locale })]
    : []),
  ...(errorAt("from") || errorAt("to") || errorAt("date")
    ? [m.emailCampaignsAudiencePeriodDateError({}, { locale })]
    : []),
  ...(errorAt("")
    ? [m.emailCampaignsAudiencePeriodOrderError({}, { locale })]
    : []),
];

/** A choice parameter's value; an optional one can be unset. */
function ChoiceParamControl({
  param,
  wording,
  value,
  onChange,
}: {
  readonly param: AudienceChoiceParam;
  readonly wording: AudienceChoiceWording | undefined;
  readonly value: unknown;
  readonly onChange: (value: string | undefined) => void;
}) {
  const options = Object.keys(param.options).map((option) => ({
    option,
    label: wording?.options[option] ?? option,
  }));
  const label = wording?.label ?? "";
  const chosen = Object.keys(param.options).find((option) => option === value);
  const pick = (next: string) => {
    if (next === absentValue && param.absent) onChange(undefined);
    else if (Object.hasOwn(param.options, next)) onChange(next);
  };
  const name = useId();
  return Match.value(param.control).pipe(
    Match.when("toggle", () => (
      <SegmentedControl
        label={label}
        name={name}
        onValueChange={pick}
        options={options.map(({ option, label: optionLabel }) => ({
          label: optionLabel,
          value: option,
        }))}
        size="sm"
        value={chosen ?? ""}
      />
    )),
    Match.when("select", () => (
      <Select value={chosen ?? absentValue} onValueChange={pick}>
        <SelectTrigger aria-label={label} className={compactSelectClassName}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {param.absent && (
            <SelectItem value={absentValue}>{wording?.absent ?? ""}</SelectItem>
          )}
          {options.map(({ option, label: optionLabel }) => (
            <SelectItem key={option} value={option}>
              {optionLabel}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )),
    Match.exhaustive
  );
}

/** The select value standing for an unset optional choice. */
const absentValue = "absent";

/**
 * "Number of <lead>", the reservation product for reservation-based
 * attributes, then "<period> is <comparison>". Every count attribute edits
 * through it: its catalogue entry gives the parameters, its wording the words.
 */
export function CountConditionControls<
  Condition extends AudienceCountCondition,
>({
  entry,
  wording,
  value: condition,
  onChange,
  errorAt,
}: ControlProps<Condition> & {
  readonly entry: AudienceCountAttributeDefinition;
  readonly wording: AudienceCountWording;
}) {
  const locale = useRouteLocale();
  const { params } = condition;
  const changeParams = (next: AudienceCountCondition["params"]) =>
    // The entry's params keep the condition's own shape.
    onChange({ ...condition, params: next } as Condition);
  const periodErrorAt = withPath(errorAt, "params.period");
  return (
    <div className="space-y-2">
      <ConditionLine>
        <ConditionText>
          {m.emailCampaignsAudienceCountNumberOf({}, { locale })}
        </ConditionText>
        {wording.lead.map((token) => {
          if ("text" in token) {
            return <ConditionText key={token.text}>{token.text}</ConditionText>;
          }
          const param = entry.params[token.param];
          return (
            param?.part === "choice" && (
              <ChoiceParamControl
                key={token.param}
                param={param}
                wording={wording.choices[token.param]}
                value={params[token.param]}
                onChange={(value) => {
                  const { [token.param]: _, ...rest } = params;
                  changeParams(
                    value === undefined
                      ? { ...rest, period: params.period }
                      : { ...params, [token.param]: value }
                  );
                }}
              />
            )
          );
        })}
      </ConditionLine>
      {entry.reservationProduct && (
        <ProductFilterControl
          value={params.product}
          onChange={(product) => {
            const { product: _, ...rest } = params;
            changeParams(product ? { ...rest, product } : rest);
          }}
          errorAt={withPath(errorAt, "params.product")}
        />
      )}
      <ConditionLine>
        <DatePeriodControl
          value={params.period}
          onChange={(period) => changeParams({ ...params, period })}
          errorAt={periodErrorAt}
          label={wording.period}
        />
        <ConditionText>
          {m.emailCampaignsAudienceCountIs({}, { locale })}
        </ConditionText>
        <CountComparisonControl
          operator={condition.operator}
          value={condition.value}
          onChange={(comparison) => onChange({ ...condition, ...comparison })}
          errorAt={errorAt}
          label={wording.count}
        />
      </ConditionLine>
      {[
        ...datePeriodErrors(periodErrorAt, locale),
        countComparisonError(errorAt, condition.operator, locale),
      ].map(
        (message) => message && <FieldError key={message} message={message} />
      )}
    </div>
  );
}

const dateOperatorKeys = ["in", "notIn", "none"] as const;

/**
 * "is in <period>", "is not in <period>" (a value exists outside it), or the
 * attribute's own wording for no value ("never visited"), then the
 * reservation product for reservation-based attributes.
 */
export function DateConditionControls<Condition extends AudienceDateCondition>({
  entry: { reservationProduct },
  wording: { label, noValue },
  value: condition,
  onChange,
  errorAt,
}: ControlProps<Condition> & {
  readonly entry: AudienceDateAttributeDefinition;
  readonly wording: AudienceDateWording;
}) {
  const locale = useRouteLocale();
  const period =
    condition.operator === "none"
      ? ({ _tag: "Last", count: 30, unit: "day" } as const)
      : condition.value;
  const operatorLabels = {
    in: m.emailCampaignsAudienceDateIn({}, { locale }),
    notIn: m.emailCampaignsAudienceDateNotIn({}, { locale }),
    none: noValue,
  } as const;
  const periodErrorAt = withPath(errorAt, "value");
  // Attribute parameters, such as a last visit's product, stay.
  const params = condition.params && { params: condition.params };
  return (
    <div className="space-y-2">
      <ConditionLine>
        <ConditionText>{label}</ConditionText>
        <Select
          value={condition.operator}
          onValueChange={(operator) => {
            if (operator === "none") {
              onChange({
                _tag: "Condition",
                attribute: condition.attribute,
                ...params,
                operator,
              } as Condition);
            } else if (operator === "in" || operator === "notIn") {
              onChange({
                _tag: "Condition",
                attribute: condition.attribute,
                ...params,
                operator,
                value: period,
              } as Condition);
            }
          }}
        >
          <SelectTrigger
            aria-label={m.emailCampaignsAudienceDateConditionLabel(
              { subject: label },
              { locale }
            )}
            className={compactSelectClassName}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {dateOperatorKeys.map((operator) => (
              <SelectItem key={operator} value={operator}>
                {operatorLabels[operator]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {condition.operator !== "none" && (
          <DatePeriodControl
            value={condition.value}
            onChange={(value) => onChange({ ...condition, value })}
            errorAt={periodErrorAt}
            label={label}
          />
        )}
      </ConditionLine>
      {datePeriodErrors(periodErrorAt, locale).map((message) => (
        <FieldError key={message} message={message} />
      ))}
      {reservationProduct && (
        <ProductFilterControl
          value={condition.params?.product}
          onChange={(product) => {
            const { params: _, ...rest } = condition;
            onChange(
              (product ? { ...rest, params: { product } } : rest) as Condition
            );
          }}
          errorAt={withPath(errorAt, "params.product")}
        />
      )}
    </div>
  );
}

/** Free-text values: type one and press Enter or a comma to add it. */
function ValueEntry({
  values,
  onChange,
  wording,
  invalid,
}: {
  readonly values: readonly string[];
  readonly onChange: (values: readonly string[]) => void;
  readonly wording: AudienceValueEntryWording;
  readonly invalid: boolean;
}) {
  const [draft, setDraft] = useState("");
  const commit = () => {
    const value = draft.trim();
    if (value && !values.includes(value)) onChange([...values, value]);
    setDraft("");
  };
  return (
    <>
      <ValueChips
        values={values}
        labelOf={(value) => value}
        onRemove={(value) => onChange(values.filter((v) => v !== value))}
        removeLabel={wording.remove}
      />
      <Input
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === ",") {
            event.preventDefault();
            commit();
          }
        }}
        onBlur={commit}
        placeholder={wording.placeholder}
        aria-label={wording.add}
        variant={invalid ? "error" : "default"}
        className={cn(compactInputClassName, "w-44 max-w-full")}
      />
    </>
  );
}

/** Looked-up values to pick from, shown as chips. */
function LookupPicker({
  values,
  onChange,
  options,
  wording,
  invalid,
}: {
  readonly values: readonly string[];
  readonly onChange: (values: readonly string[]) => void;
  readonly options: readonly AudienceValueOption[];
  readonly wording: Extract<
    AudienceSetWording["values"],
    { readonly _tag: "Lookup" }
  >;
  readonly invalid: boolean;
}) {
  const nameOf = (id: string) =>
    options.find((option) => option.id === id)?.name ?? wording.unknown(id);
  return (
    <>
      <ValueChips
        values={values}
        labelOf={nameOf}
        onRemove={(id) => onChange(toggleSetValue(values, id, false))}
        removeLabel={wording.remove}
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="secondary"
            tone={invalid ? "burned-orange" : "navy-blue"}
            size="sm"
            aria-invalid={invalid}
          >
            {wording.choose}
            <ChevronDown className="h-3.5 w-3.5" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {options.map((option) => (
            <DropdownMenuCheckboxItem
              key={option.id}
              checked={values.includes(option.id)}
              onCheckedChange={(checked) =>
                onChange(toggleSetValue(values, option.id, checked))
              }
              onSelect={(event) => event.preventDefault()}
            >
              {option.name}
            </DropdownMenuCheckboxItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

/**
 * "<lead> <match> <values>": checkboxes for fixed options, chips with a
 * picker for looked-up values, or chips with free-text entry.
 */
export function SetConditionControls<Condition extends AudienceSetCondition>({
  entry,
  wording,
  value: condition,
  onChange,
  errorAt,
  path,
  lookups,
}: ControlProps<Condition> & {
  readonly entry: AudienceSetAttributeDefinition;
  readonly wording: AudienceSetWording;
  /** Form path of the condition, for checkbox IDs. */
  readonly path: string;
  readonly lookups: AudienceValueLookups;
}) {
  const invalid = errorAt("value") !== undefined;
  const setValues = (value: readonly string[]) =>
    onChange({ ...condition, value });
  const freeText = (entryWording: AudienceValueEntryWording) => (
    <ValueEntry
      values={condition.value}
      onChange={setValues}
      wording={entryWording}
      invalid={invalid}
    />
  );
  const values = wording.values;
  return (
    <div className="space-y-2">
      <ConditionLine>
        <ConditionText>{wording.lead}</ConditionText>
        <SetOperatorSelect
          operators={entry.operators}
          value={condition.operator}
          onChange={(operator) => onChange({ ...condition, operator })}
          label={wording.label}
        />
        {Match.value(entry.values).pipe(
          Match.tagsExhaustive({
            Options: ({ options }) =>
              Object.keys(options).map((option) => {
                const id = `${path}.value.${option}`;
                return (
                  <label
                    key={option}
                    htmlFor={id}
                    className="flex items-center gap-2 text-sm"
                  >
                    <Checkbox
                      id={id}
                      checked={condition.value.includes(option)}
                      onCheckedChange={(next) =>
                        setValues(
                          toggleSetValue(condition.value, option, next === true)
                        )
                      }
                      className="size-5"
                    />
                    {(values._tag === "Options" &&
                      values.options[option]?.label) ||
                      option}
                  </label>
                );
              }),
            FreeText: () =>
              values._tag === "FreeText" && freeText(values.entry),
            Lookup: ({ lookup }) => {
              if (values._tag !== "Lookup") return null;
              const options = lookups[lookup];
              return options ? (
                <LookupPicker
                  values={condition.value}
                  onChange={setValues}
                  options={options}
                  wording={values}
                  invalid={invalid}
                />
              ) : (
                freeText(values.entry)
              );
            },
          })
        )}
      </ConditionLine>
      {invalid && <FieldError message={wording.emptyError} />}
    </div>
  );
}

/** "<true or false> <object>", as in "Has a Workspace account". */
export function BooleanConditionControls<
  Condition extends AudienceBooleanCondition,
>({
  wording,
  value: condition,
  onChange,
}: ControlProps<Condition> & {
  readonly wording: AudienceBooleanWording;
}) {
  const name = useId();

  return (
    <ConditionLine>
      <SegmentedControl
        label={wording.label}
        name={name}
        onValueChange={(next) =>
          onChange({ ...condition, value: next === "true" })
        }
        options={[
          { label: wording.true, value: "true" },
          { label: wording.false, value: "false" },
        ]}
        size="sm"
        value={String(condition.value)}
      />
      <ConditionText>{wording.object}</ConditionText>
    </ConditionLine>
  );
}
