"use client";

import type {
  AudienceCountOperatorType,
  AudienceSetOperatorType,
} from "@deskohub/workspace-admin-api";
import { X } from "lucide-react";
import type { ReactNode } from "react";
import { m } from "@/features/administration/i18n";
import type { Locale } from "@/features/i18n";
import { useRouteLocale } from "@/features/i18n/route-locale";
import { Button } from "@/shared/components/ui/button";
import { Input } from "@/shared/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import { cn } from "@/shared/utils";

export const compactSelectClassName =
  "min-h-9 w-auto rounded-md px-3 py-1.5 text-sm";
export const compactInputClassName =
  "h-9 min-h-9 rounded-md px-3 py-1.5 text-sm";

/** Error message for a field path relative to the control, if any. */
export type FieldErrorLookup = (field: string) => string | undefined;

export type ControlProps<Value> = {
  readonly value: Value;
  readonly onChange: (value: Value) => void;
  readonly errorAt: FieldErrorLookup;
};

export function FieldError({ message }: { readonly message: string }) {
  return (
    <p role="alert" className="text-burned-orange text-sm">
      {message}
    </p>
  );
}

/** Wording kept apart from the controls so the row reads as a sentence. */
export function ConditionText({ children }: { readonly children: ReactNode }) {
  return <span className="text-sm">{children}</span>;
}

/** One line of a condition sentence; it wraps on narrow screens. */
export function ConditionLine({ children }: { readonly children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-2">
      {children}
    </div>
  );
}

const countOperators: Readonly<Record<AudienceCountOperatorType, string>> = {
  eq: "=",
  ne: "≠",
  lt: "<",
  lte: "≤",
  gt: ">",
  gte: "≥",
};

const isCountOperator = (value: string): value is AudienceCountOperatorType =>
  Object.hasOwn(countOperators, value);

/** Parses a number field; an empty or partial entry stays invalid for the schema. */
export const numberFromInput = (raw: string) =>
  raw.trim() === "" ? Number.NaN : Number(raw);

export const numberInputValue = (value: number) =>
  Number.isNaN(value) ? "" : String(value);

/**
 * What is wrong with a comparison: a never-true "< 0" or always-true "≥ 0",
 * which the schema rejects on the operator, or a value that isn't a whole
 * number.
 */
export const countComparisonError = (
  errorAt: FieldErrorLookup,
  operator: AudienceCountOperatorType,
  locale: Locale
) => {
  if (errorAt("operator") !== undefined) {
    return operator === "lt"
      ? m.emailCampaignsAudienceCountNeverMatchesError({}, { locale })
      : m.emailCampaignsAudienceCountAlwaysMatchesError({}, { locale });
  }
  return errorAt("value") === undefined
    ? undefined
    : m.emailCampaignsAudienceCountWholeNumberError({}, { locale });
};

/** An operator and a non-negative whole number: "≥ 2", "= 0". */
export function CountComparisonControl({
  operator,
  value,
  onChange,
  errorAt,
  label,
}: {
  readonly operator: AudienceCountOperatorType;
  readonly value: number;
  readonly onChange: (comparison: {
    readonly operator: AudienceCountOperatorType;
    readonly value: number;
  }) => void;
  readonly errorAt: FieldErrorLookup;
  /** What is counted, for screen readers ("Reservation count"). */
  readonly label: string;
}) {
  const locale = useRouteLocale();
  const invalid = errorAt("value") !== undefined;
  return (
    <span className="inline-flex items-center gap-1.5">
      <Select
        value={operator}
        onValueChange={(next) => {
          if (isCountOperator(next)) onChange({ operator: next, value });
        }}
      >
        <SelectTrigger
          aria-label={m.emailCampaignsAudienceCountComparisonLabel(
            { subject: label },
            { locale }
          )}
          aria-invalid={errorAt("operator") !== undefined}
          className={cn(compactSelectClassName, "min-w-16 font-semibold")}
        >
          <SelectValue>{countOperators[operator]}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {Object.entries(countOperators).map(([key, symbol]) => (
            <SelectItem key={key} value={key}>
              <span className="inline-block w-5 font-semibold">{symbol}</span>
              {m.emailCampaignsAudienceCountOperator(
                { operator: key },
                { locale }
              )}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Input
        type="number"
        inputMode="numeric"
        min={0}
        step={1}
        value={numberInputValue(value)}
        onChange={(event) =>
          onChange({ operator, value: numberFromInput(event.target.value) })
        }
        aria-label={label}
        aria-invalid={invalid}
        variant={invalid ? "error" : "default"}
        className={cn(compactInputClassName, "w-20")}
      />
    </span>
  );
}

export const withPath =
  (errorAt: FieldErrorLookup, prefix: string): FieldErrorLookup =>
  (field) =>
    errorAt(field === "" ? prefix : `${prefix}.${field}`);

export function SetOperatorSelect<Operator extends AudienceSetOperatorType>({
  operators,
  value,
  onChange,
  label,
}: {
  readonly operators: readonly Operator[];
  readonly value: Operator;
  readonly onChange: (operator: Operator) => void;
  readonly label: string;
}) {
  const locale = useRouteLocale();
  return (
    <Select
      value={value}
      onValueChange={(next) => {
        const operator = operators.find((candidate) => candidate === next);
        if (operator) onChange(operator);
      }}
    >
      <SelectTrigger
        aria-label={m.emailCampaignsAudienceSetMatchLabel(
          { subject: label },
          { locale }
        )}
        className={compactSelectClassName}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {operators.map((operator) => (
          <SelectItem key={operator} value={operator}>
            {m.emailCampaignsAudienceSetOperator({ operator }, { locale })}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Chosen values as removable chips. */
export function ValueChips({
  values,
  labelOf,
  onRemove,
  removeLabel,
}: {
  readonly values: readonly string[];
  readonly labelOf: (value: string) => string;
  readonly onRemove: (value: string) => void;
  /** Names a chip's remove button for its value's label. */
  readonly removeLabel: (label: string) => string;
}) {
  return values.map((value) => (
    <span
      key={value}
      className="inline-flex h-8 items-center gap-1 rounded-full border border-navy-blue/20 bg-navy-blue/[0.04] pr-1 pl-3 text-sm"
    >
      {labelOf(value)}
      <Button
        type="button"
        variant="ghost"
        tone="muted"
        size="icon-xs"
        onClick={() => onRemove(value)}
        aria-label={removeLabel(labelOf(value))}
      >
        <X className="h-3.5 w-3.5" aria-hidden />
      </Button>
    </span>
  ));
}
