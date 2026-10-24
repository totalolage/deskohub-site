"use client";

import {
  AdministrationCampaignId,
  type AudienceBooleanCondition,
  type AudienceChoiceParam,
  type AudienceCountAttributeDefinition,
  type AudienceCountCondition,
  type AudienceDateAttributeDefinition,
  type AudienceDateCondition,
  type AudienceSetAttributeDefinition,
  type AudienceSetCondition,
  type CampaignEmailSourceType,
  type DatePeriodUnitType,
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
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/shared/components/ui/command";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/shared/components/ui/dropdown-menu";
import { fieldTriggerVariants } from "@/shared/components/ui/field-trigger";
import { Input } from "@/shared/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/shared/components/ui/popover";
import { SegmentedControl } from "@/shared/components/ui/segmented-control";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { cn } from "@/shared/utils";
import {
  type AudienceFilterHolder,
  canHoldCampaignSource,
  canHoldPeriod,
} from "../../audience-filter-usage";
import type { DatePeriod } from "../../date-period";
import type {
  AudienceCampaignOption,
  AudienceValueLookups,
  AudienceValueOption,
} from "../audience-filter-summary";
import { CampaignStateBadge } from "../campaign-list/campaign-badges";
import type {
  AudienceBooleanWording,
  AudienceCampaignSourceWording,
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
  fieldErrorAttributes,
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

/** Every period kind, in the order the period select lists them. */
const datePeriodKinds: readonly DatePeriodKind[] = [
  "AnyTime",
  "Past",
  "Last",
  "TriggerWindow",
  "Range",
  "Since",
  "Onward",
  "Until",
];

const isDatePeriodKind = (value: string): value is DatePeriodKind =>
  datePeriodKinds.some((kind) => kind === value);

const triggerWindowSides = ["before", "after"] as const;

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
 * Any time, any time so far, the last N days/weeks/months/years, within N
 * units before or after the trigger, from–to, since, or until, as far as
 * `holder` can hold them. The same control picks every period an audience
 * condition uses.
 */
function DatePeriodControl({
  value,
  onChange,
  errorAt,
  errorId,
  label,
  holder,
}: ControlProps<DatePeriod> & {
  /** The id of the `FieldError` that explains the period's errors. */
  readonly errorId: string;
  /** What the period applies to, for screen readers. */
  readonly label: string;
  readonly holder: AudienceFilterHolder;
}) {
  const locale = useRouteLocale();
  const subject = { subject: label };
  const kinds = datePeriodKinds.filter((kind) => canHoldPeriod(holder, kind));
  const kindLabel = (kind: DatePeriodKind) =>
    Match.value(kind).pipe(
      Match.when("Last", () =>
        value._tag === "Last"
          ? m.emailCampaignsAudiencePeriodLast(
              { count: value.count },
              { locale }
            )
          : m.emailCampaignsAudiencePeriodKind({ kind }, { locale })
      ),
      Match.when("TriggerWindow", () =>
        value._tag === "TriggerWindow"
          ? m.emailAutomationFlowPeriodWithin({}, { locale })
          : m.emailAutomationFlowPeriodTriggerWindow({}, { locale })
      ),
      Match.orElse(() =>
        m.emailCampaignsAudiencePeriodKind({ kind }, { locale })
      )
    );
  const countAndUnit = (
    period: Extract<DatePeriod, { readonly _tag: "Last" | "TriggerWindow" }>,
    countLabel: string
  ) => (
    <span className="inline-flex items-center gap-1.5">
      <Input
        type="number"
        inputMode="numeric"
        min={1}
        step={1}
        value={numberInputValue(period.count)}
        onChange={(event) =>
          onChange({
            ...period,
            count: numberFromInput(event.target.value),
          })
        }
        aria-label={countLabel}
        {...fieldErrorAttributes(errorId, errorAt("count") !== undefined)}
        variant={errorAt("count") ? "error" : "default"}
        className={cn(compactInputClassName, "w-20")}
      />
      <Select
        value={period.unit}
        onValueChange={(unit) => {
          if (isDatePeriodUnit(unit)) onChange({ ...period, unit });
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
                {datePeriodUnit(unit, period.count, locale)}
              </SelectItem>
            ))}
        </SelectContent>
      </Select>
    </span>
  );
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
      {...fieldErrorAttributes(
        errorId,
        errorAt(field) !== undefined || errorAt("") !== undefined
      )}
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
          {kinds.map((kind) => (
            <SelectItem key={kind} value={kind}>
              {kindLabel(kind)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {value._tag === "Last" &&
        countAndUnit(
          value,
          m.emailCampaignsAudiencePeriodCountLabel(
            // Any count above one names the units in general.
            { subject: label, units: datePeriodUnit(value.unit, 2, locale) },
            { locale }
          )
        )}
      {value._tag === "TriggerWindow" && (
        <>
          {countAndUnit(
            value,
            m.emailAutomationFlowPeriodTriggerWindowCountLabel(subject, {
              locale,
            })
          )}
          <Select
            value={value.side}
            onValueChange={(side) => {
              const next = triggerWindowSides.find((known) => known === side);
              if (next) onChange({ ...value, side: next });
            }}
          >
            <SelectTrigger
              aria-label={m.emailAutomationFlowPeriodTriggerWindowSideLabel(
                subject,
                { locale }
              )}
              className={compactSelectClassName}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {triggerWindowSides.map((side) => (
                <SelectItem key={side} value={side}>
                  {m.emailAutomationFlowPeriodTriggerWindowSide(
                    { side },
                    { locale }
                  )}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </>
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

/** The command value standing for the automation's own campaign. */
const thisCampaignValue = "this";

/**
 * Whose emails count: any campaign, this campaign where `holder` can hold
 * it, or one picked by name, searchable and badged with each campaign's
 * state. A chosen campaign missing from the list, such as a deleted one,
 * stays chosen under the wording's label for it.
 */
function CampaignSourceControl({
  wording,
  campaigns = [],
  value,
  onChange,
  holder,
}: {
  readonly wording: AudienceCampaignSourceWording;
  readonly campaigns: readonly AudienceCampaignOption[] | undefined;
  readonly value: CampaignEmailSourceType | undefined;
  readonly onChange: (value: CampaignEmailSourceType | undefined) => void;
  readonly holder: AudienceFilterHolder;
}) {
  const locale = useRouteLocale();
  const [open, setOpen] = useState(false);
  const chosen = value?._tag === "Specific" ? value.campaignId : undefined;
  const chosenCampaign = campaigns.find(({ id }) => id === chosen);
  const lost = chosen !== undefined && chosenCampaign === undefined;
  const thisCampaign = m.emailAutomationFlowCampaignSourceThis({}, { locale });
  const pick = (next: CampaignEmailSourceType | undefined) => {
    onChange(next);
    setOpen(false);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          aria-label={wording.label}
          className={cn(
            fieldTriggerVariants(),
            compactSelectClassName,
            "max-w-72 justify-between"
          )}
        >
          <span className="min-w-0 truncate">
            {value?._tag === "This"
              ? thisCampaign
              : (chosenCampaign?.name ??
                (lost ? wording.unknown : wording.absent))}
          </span>
          <ChevronDown
            className="h-4 w-4 shrink-0 text-navy-blue/60"
            aria-hidden
          />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[min(22rem,calc(100vw-2rem))] overflow-hidden p-0"
      >
        <Command label={wording.search}>
          <CommandInput placeholder={wording.search} />
          <CommandList>
            <CommandGroup>
              <CommandItem
                value={absentValue}
                keywords={[wording.absent]}
                selected={value === undefined}
                onSelect={() => pick(undefined)}
              >
                {wording.absent}
              </CommandItem>
              {canHoldCampaignSource(holder, "This") && (
                <CommandItem
                  value={thisCampaignValue}
                  keywords={[thisCampaign]}
                  selected={value?._tag === "This"}
                  onSelect={() => pick({ _tag: "This" })}
                >
                  {thisCampaign}
                </CommandItem>
              )}
              {lost && (
                <CommandItem
                  value={chosen}
                  keywords={[wording.unknown]}
                  selected
                  onSelect={() => setOpen(false)}
                >
                  {wording.unknown}
                </CommandItem>
              )}
              {campaigns.map((campaign) => (
                <CommandItem
                  key={campaign.id}
                  value={campaign.id}
                  keywords={[campaign.name]}
                  selected={campaign.id === chosen}
                  onSelect={() =>
                    pick({
                      _tag: "Specific",
                      campaignId: AdministrationCampaignId.make(campaign.id),
                    })
                  }
                >
                  <span className="min-w-0 flex-1 truncate">
                    {campaign.name}
                  </span>
                  <CampaignStateBadge locale={locale} campaign={campaign} />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
          <CommandEmpty>{wording.empty}</CommandEmpty>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/**
 * One campaign's emails count whatever their purpose, so while a campaign
 * param is set, a choice offering "any" holds it and is hidden.
 */
const pinnedChoice = "any";

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
  lookups,
  holder = "saved-audience",
}: ControlProps<Condition> & {
  readonly entry: AudienceCountAttributeDefinition;
  readonly wording: AudienceCountWording;
  readonly lookups: AudienceValueLookups;
  /** What holds the condition, which decides the periods and campaigns offered. */
  readonly holder?: AudienceFilterHolder;
}) {
  const locale = useRouteLocale();
  const { params } = condition;
  const changeParams = (next: AudienceCountCondition["params"]) =>
    // The entry's params keep the condition's own shape.
    onChange({ ...condition, params: next } as Condition);
  const campaignChosen = Object.entries(entry.params).some(
    ([name, param]) => param.part === "campaign" && params[name] !== undefined
  );
  const pinsChoice = (param: AudienceChoiceParam) =>
    campaignChosen && Object.hasOwn(param.options, pinnedChoice);
  const periodErrorAt = withPath(errorAt, "params.period");
  const errorId = useId();
  return (
    <div className="flex flex-col gap-2">
      <ConditionLine>
        <ConditionText>
          {m.emailCampaignsAudienceCountNumberOf({}, { locale })}
        </ConditionText>
        {wording.lead.map((token) => {
          if ("text" in token) {
            return <ConditionText key={token.text}>{token.text}</ConditionText>;
          }
          const param = entry.params[token.param];
          const sourceWording = wording.campaignSources?.[token.param];
          if (param?.part === "campaign" && sourceWording) {
            return (
              <CampaignSourceControl
                key={token.param}
                wording={sourceWording}
                campaigns={lookups.campaigns}
                holder={holder}
                value={params[token.param] as CampaignEmailSourceType}
                onChange={(source) => {
                  const { [token.param]: _, ...rest } = params;
                  if (source === undefined) {
                    changeParams({ ...rest, period: params.period });
                    return;
                  }
                  const pinned = Object.fromEntries(
                    Object.entries(entry.params).flatMap(([name, other]) =>
                      other.part === "choice" &&
                      Object.hasOwn(other.options, pinnedChoice)
                        ? [[name, pinnedChoice]]
                        : []
                    )
                  );
                  changeParams({
                    ...params,
                    ...pinned,
                    [token.param]: source,
                  });
                }}
              />
            );
          }
          return (
            param?.part === "choice" &&
            !pinsChoice(param) && (
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
          errorId={errorId}
          label={wording.period}
          holder={holder}
        />
        <ConditionText>
          {m.emailCampaignsAudienceCountIs({}, { locale })}
        </ConditionText>
        <CountComparisonControl
          operator={condition.operator}
          value={condition.value}
          onChange={(comparison) => onChange({ ...condition, ...comparison })}
          errorAt={errorAt}
          errorId={errorId}
          label={wording.count}
        />
      </ConditionLine>
      <FieldError
        id={errorId}
        messages={[
          ...datePeriodErrors(periodErrorAt, locale),
          countComparisonError(errorAt, condition.operator, locale),
        ]}
      />
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
  holder = "saved-audience",
}: ControlProps<Condition> & {
  readonly entry: AudienceDateAttributeDefinition;
  readonly wording: AudienceDateWording;
  /** What holds the condition, which decides the periods offered. */
  readonly holder?: AudienceFilterHolder;
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
  const errorId = useId();
  return (
    <div className="flex flex-col gap-2">
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
            errorId={errorId}
            label={label}
            holder={holder}
          />
        )}
      </ConditionLine>
      <FieldError
        id={errorId}
        messages={datePeriodErrors(periodErrorAt, locale)}
      />
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
  errorId,
}: {
  readonly values: readonly string[];
  readonly onChange: (values: readonly string[]) => void;
  readonly wording: AudienceValueEntryWording;
  readonly invalid: boolean;
  readonly errorId: string;
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
        {...fieldErrorAttributes(errorId, invalid)}
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
  errorId,
}: {
  readonly values: readonly string[];
  readonly onChange: (values: readonly string[]) => void;
  readonly options: readonly AudienceValueOption[];
  readonly wording: Extract<
    AudienceSetWording["values"],
    { readonly _tag: "Lookup" }
  >;
  readonly invalid: boolean;
  readonly errorId: string;
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
            aria-describedby={invalid ? errorId : undefined}
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
  const errorId = useId();
  const setValues = (value: readonly string[]) =>
    onChange({ ...condition, value });
  const freeText = (entryWording: AudienceValueEntryWording) => (
    <ValueEntry
      values={condition.value}
      onChange={setValues}
      wording={entryWording}
      invalid={invalid}
      errorId={errorId}
    />
  );
  const values = wording.values;
  return (
    <div className="flex flex-col gap-2">
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
                      {...fieldErrorAttributes(errorId, invalid)}
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
                  errorId={errorId}
                />
              ) : (
                freeText(values.entry)
              );
            },
          })
        )}
      </ConditionLine>
      <FieldError
        id={errorId}
        messages={[invalid ? wording.emptyError : undefined]}
      />
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
