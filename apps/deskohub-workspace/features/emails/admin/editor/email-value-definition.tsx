"use client";

import { ArrowDown, ArrowUp, ChevronDown, Trash2 } from "lucide-react";
import { useId, useRef } from "react";
import { flushSync } from "react-dom";
import { useWatch } from "react-hook-form";
import { m } from "@/features/administration/i18n";
import { useRouteLocale } from "@/features/i18n/route-locale";
import { Badge } from "@/shared/components/ui/badge";
import { Button } from "@/shared/components/ui/button";
import { fieldTriggerVariants } from "@/shared/components/ui/field-trigger";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import { cn } from "@/shared/utils";
import {
  type EmailDraftValueDefinition,
  type EmailDraftValueSource,
  useEmailDraftForm,
} from "./email-draft-form";
import {
  EmailFieldProblems,
  useEmailEditor,
  useEmailFieldProblems,
} from "./email-editor-context";
import { emailEditorFieldIds } from "./email-editor-field-ids";
import { emailEditorLanguageName } from "./email-editor-problems";
import { EmailValueCustomerPicker } from "./email-value-customer-picker";
import { EmailValueCustomerSource } from "./email-value-customer-source";
import { EmailValueDiscountSource } from "./email-value-discount-source";
import { emailValueKindLabel } from "./email-value-kind-label";
import { suggestedEmailValueName } from "./email-value-names";
import {
  type EmailCustomerFieldPath,
  emailCustomerFieldPathLabel,
  emailValueKind,
} from "./email-value-options";
import type { EmailEditorDiscount } from "./email-values-section";

/**
 * The definition at `index` in the host's draft form and a function that
 * replaces it. Optional settings are removed by leaving their key out, so
 * the draft never holds `undefined` settings.
 */
const useEmailValueDefinition = (index: number) => {
  const { control, getValues, setValue } = useEmailDraftForm();
  const definition: EmailDraftValueDefinition =
    useWatch({ control, name: `values.${index}` }) ?? {};
  const update = (
    change: (current: EmailDraftValueDefinition) => EmailDraftValueDefinition
  ) =>
    setValue(`values.${index}`, change(getValues(`values.${index}`) ?? {}), {
      shouldDirty: true,
    });
  const takenNames = () =>
    (getValues("values") ?? [])
      .filter((_, other) => other !== index)
      .map(({ name }) => name);
  return { definition, update, takenNames } as const;
};

/** One named value: its name, source settings, fallbacks and order. */
export function EmailValueDefinition({
  count,
  discounts,
  index,
  onDelete,
  onMove,
  referencedNames,
}: {
  readonly count: number;
  readonly discounts: readonly EmailEditorDiscount[];
  readonly index: number;
  readonly onDelete: () => void;
  readonly onMove: (to: number) => void;
  /** The value names the email's texts and blocks refer to. */
  readonly referencedNames: ReadonlySet<string>;
}) {
  const locale = useRouteLocale();
  const { locales } = useEmailEditor();
  const { definition, update, takenNames } = useEmailValueDefinition(index);
  const headingId = useId();
  const moveUpRef = useRef<HTMLButtonElement>(null);
  const moveDownRef = useRef<HTMLButtonElement>(null);
  const containerId = emailEditorFieldIds.value(index);
  const nameId = emailEditorFieldIds.valueSetting(index, "name");
  const pathId = emailEditorFieldIds.valueSetting(index, "path");
  const containerProblems = useEmailFieldProblems(containerId);
  const nameProblems = useEmailFieldProblems(nameId);
  const pathProblems = useEmailFieldProblems(pathId);
  const source = definition.source;
  const kind = emailValueKind(definition);
  const used = referencedNames.has(definition.name ?? "");
  const title =
    definition.name ||
    m.emailsEditorValuesUnnamed({ number: index + 1 }, { locale });

  const changeSource = (next: EmailDraftValueSource) =>
    update((current) => ({ ...current, source: next }));
  const choosePath = (path: EmailCustomerFieldPath) =>
    update(
      ({
        customerShape: _selectedField,
        customerSortShape: _sortField,
        ...current
      }) => ({
        ...current,
        name: current.name || suggestedEmailValueName(path, takenNames()),
        source: { kind: "customer", path: [...path] },
      })
    );
  const changeFallback = (language: string, text: string) =>
    update(({ fallback, ...current }) => {
      const { [language]: _previous, ...others } = fallback ?? {};
      const next = text === "" ? others : { ...others, [language]: text };
      return Object.keys(next).length > 0
        ? { ...current, fallback: next }
        : current;
    });
  const move = (to: number) => {
    // Commit the move first: it enables and disables the buttons.
    flushSync(() => onMove(to));
    // A move to either end disables its button; keep focus on the other one.
    if (to === 0) moveDownRef.current?.focus();
    if (to === count - 1) moveUpRef.current?.focus();
  };

  return (
    <li
      id={containerId}
      tabIndex={-1}
      aria-labelledby={headingId}
      className="space-y-4 rounded-xl border border-navy-blue/10 bg-white p-4 outline-none focus-visible:ring-2 focus-visible:ring-burned-orange"
      aria-describedby={containerProblems.describedBy}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h3
            id={headingId}
            className="min-w-0 truncate font-mono font-semibold text-navy-blue text-sm"
          >
            {title}
          </h3>
          {kind && (
            <Badge className="px-1.5 py-0 text-[11px]" variant="subtle">
              {emailValueKindLabel(kind, locale)}
            </Badge>
          )}
          {!used && (
            <Badge className="px-1.5 py-0 text-[11px]" variant="default">
              {m.emailsEditorValuesUnused({}, { locale })}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-1">
          <Button
            ref={moveUpRef}
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={index === 0}
            aria-label={m.emailsEditorValuesMoveUp({ name: title }, { locale })}
            onClick={() => move(index - 1)}
          >
            <ArrowUp className="size-4" aria-hidden />
          </Button>
          <Button
            ref={moveDownRef}
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={index === count - 1}
            aria-label={m.emailsEditorValuesMoveDown(
              { name: title },
              { locale }
            )}
            onClick={() => move(index + 1)}
          >
            <ArrowDown className="size-4" aria-hidden />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label={m.emailsEditorValuesDelete({ name: title }, { locale })}
            onClick={onDelete}
          >
            <Trash2 className="size-4" aria-hidden />
          </Button>
        </div>
      </div>
      {!used && (
        <p className="text-navy-blue/60 text-xs">
          {m.emailsEditorValuesUnusedHint({}, { locale })}
        </p>
      )}
      <EmailFieldProblems fieldId={containerId} />

      <div className="space-y-1.5">
        <Label htmlFor={nameId}>
          {m.emailsEditorValuesNameLabel({}, { locale })}
        </Label>
        <Input
          id={nameId}
          autoComplete="off"
          spellCheck={false}
          className="h-9 min-h-9 max-w-sm rounded-md px-3 py-1.5 font-mono text-sm"
          variant={nameProblems.invalid ? "error" : "default"}
          value={definition.name ?? ""}
          onChange={(event) => {
            const name = event.target.value;
            update(({ name: _name, ...current }) =>
              name === "" ? current : { ...current, name }
            );
          }}
          {...nameProblems.controlProps}
          aria-describedby={[nameProblems.describedBy, `${nameId}-hint`]
            .filter(Boolean)
            .join(" ")}
        />
        <p className="text-navy-blue/55 text-xs" id={`${nameId}-hint`}>
          {m.emailsEditorValuesNameHint({}, { locale })}
        </p>
        <EmailFieldProblems fieldId={nameId} />
      </div>

      {source?.kind !== "discount" && (
        <>
          <div className="space-y-1.5">
            <Label htmlFor={pathId}>
              {m.emailsEditorValuesPathLabel({}, { locale })}
            </Label>
            <EmailValueCustomerPicker
              selectedPath={source?.path}
              onSelect={choosePath}
              trigger={(open) => (
                <button
                  id={pathId}
                  type="button"
                  role="combobox"
                  aria-expanded={open}
                  className={cn(
                    fieldTriggerVariants({
                      variant: pathProblems.invalid ? "error" : "default",
                    }),
                    "min-h-9 w-auto min-w-56 max-w-full justify-between rounded-md px-3 py-1.5 text-sm"
                  )}
                  data-placeholder={source?.path?.length ? undefined : ""}
                  {...pathProblems.controlProps}
                >
                  <span className="min-w-0 truncate font-mono text-[13px]">
                    {source?.path?.length
                      ? emailCustomerFieldPathLabel(source.path)
                      : m.emailsEditorValuesPathChoose({}, { locale })}
                  </span>
                  <ChevronDown
                    className="size-4 shrink-0 text-navy-blue/60"
                    aria-hidden
                  />
                </button>
              )}
            />
            <EmailFieldProblems fieldId={pathId} />
          </div>
          <EmailValueCustomerSource
            definition={definition}
            index={index}
            onChange={changeSource}
          />
        </>
      )}
      {source?.kind === "discount" && (
        <EmailValueDiscountSource
          discounts={discounts}
          index={index}
          source={source}
          onChange={changeSource}
        />
      )}

      <fieldset className="space-y-2">
        <legend className="font-medium text-sm leading-none">
          {m.emailsEditorValuesFallbackHeading({}, { locale })}
        </legend>
        <p className="text-navy-blue/55 text-xs">
          {m.emailsEditorValuesFallbackHint({}, { locale })}
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {locales.map((language) => (
            <EmailValueFallbackInput
              key={language}
              id={`${containerId}-fallback-${language}`}
              language={language}
              value={definition.fallback?.[language] ?? ""}
              onChange={(text) => changeFallback(language, text)}
            />
          ))}
        </div>
      </fieldset>
    </li>
  );
}

/** The text one language shows in place of the value. */
function EmailValueFallbackInput({
  id,
  language,
  onChange,
  value,
}: {
  readonly id: string;
  readonly language: string;
  readonly onChange: (text: string) => void;
  readonly value: string;
}) {
  const locale = useRouteLocale();
  const { invalid, controlProps } = useEmailFieldProblems(id);
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>
        {m.emailsEditorValuesFallbackLabel(
          { language: emailEditorLanguageName(language, locale) },
          { locale }
        )}
      </Label>
      <Input
        id={id}
        lang={language}
        className="h-9 min-h-9 rounded-md px-3 py-1.5 text-sm"
        variant={invalid ? "error" : "default"}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        {...controlProps}
      />
      <EmailFieldProblems fieldId={id} />
    </div>
  );
}
