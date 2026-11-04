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
  type EmailValueKind,
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

type EmailValueDefinitionUpdate = ReturnType<
  typeof useEmailValueDefinition
>["update"];

/** A value's title and badges, and the buttons that move and delete it. */
function EmailValueDefinitionHeader({
  count,
  headingId,
  index,
  kind,
  onDelete,
  onMove,
  title,
  used,
}: {
  readonly count: number;
  readonly headingId: string;
  readonly index: number;
  readonly kind: EmailValueKind | undefined;
  readonly onDelete: () => void;
  readonly onMove: (to: number) => void;
  readonly title: string;
  readonly used: boolean;
}) {
  const locale = useRouteLocale();
  const moveUpRef = useRef<HTMLButtonElement>(null);
  const moveDownRef = useRef<HTMLButtonElement>(null);
  const move = (to: number) => {
    // Commit the move first: it enables and disables the buttons.
    flushSync(() => onMove(to));
    // A move to either end disables its button; keep focus on the other one.
    if (to === 0) moveDownRef.current?.focus();
    if (to === count - 1) moveUpRef.current?.focus();
  };

  return (
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
          aria-label={m.emailsEditorValuesMoveDown({ name: title }, { locale })}
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
  );
}

/** The name texts and blocks refer to the value by. */
function EmailValueNameField({
  index,
  name,
  update,
}: {
  readonly index: number;
  readonly name: string | undefined;
  readonly update: EmailValueDefinitionUpdate;
}) {
  const locale = useRouteLocale();
  const nameId = emailEditorFieldIds.valueSetting(index, "name");
  const nameProblems = useEmailFieldProblems(nameId);

  return (
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
        value={name ?? ""}
        onChange={(event) => {
          const next = event.target.value;
          update(({ name: _name, ...current }) =>
            next === "" ? current : { ...current, name: next }
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
  );
}

/** The customer field a value shows, picked from the catalogue. */
function EmailValueCustomerPath({
  index,
  path,
  onSelect,
}: {
  readonly index: number;
  readonly path: EmailCustomerFieldPath | undefined;
  readonly onSelect: (path: EmailCustomerFieldPath) => void;
}) {
  const locale = useRouteLocale();
  const pathId = emailEditorFieldIds.valueSetting(index, "path");
  const pathProblems = useEmailFieldProblems(pathId);

  return (
    <div className="space-y-1.5">
      <Label htmlFor={pathId}>
        {m.emailsEditorValuesPathLabel({}, { locale })}
      </Label>
      <EmailValueCustomerPicker
        selectedPath={path}
        onSelect={onSelect}
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
            data-placeholder={path?.length ? undefined : ""}
            {...pathProblems.controlProps}
          >
            <span className="min-w-0 truncate font-mono text-[13px]">
              {path?.length
                ? emailCustomerFieldPathLabel(path)
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
  );
}

/** Where a value comes from: a customer field and its settings, or a discount. */
function EmailValueSourceSettings({
  definition,
  discounts,
  index,
  takenNames,
  update,
}: {
  readonly definition: EmailDraftValueDefinition;
  readonly discounts: readonly EmailEditorDiscount[];
  readonly index: number;
  readonly takenNames: () => readonly (string | undefined)[];
  readonly update: EmailValueDefinitionUpdate;
}) {
  const source = definition.source;
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

  if (source?.kind === "discount")
    return (
      <EmailValueDiscountSource
        discounts={discounts}
        index={index}
        source={source}
        onChange={changeSource}
      />
    );
  return (
    <>
      <EmailValueCustomerPath
        index={index}
        path={source?.path}
        onSelect={choosePath}
      />
      <EmailValueCustomerSource
        definition={definition}
        index={index}
        onChange={changeSource}
      />
    </>
  );
}

/** The text each language shows in place of a value it can't show. */
function EmailValueFallbacks({
  containerId,
  fallback,
  update,
}: {
  readonly containerId: string;
  readonly fallback: EmailDraftValueDefinition["fallback"];
  readonly update: EmailValueDefinitionUpdate;
}) {
  const locale = useRouteLocale();
  const { locales } = useEmailEditor();
  const changeFallback = (language: string, text: string) =>
    update(({ fallback: previous, ...current }) => {
      const { [language]: _previous, ...others } = previous ?? {};
      const next = text === "" ? others : { ...others, [language]: text };
      return Object.keys(next).length > 0
        ? { ...current, fallback: next }
        : current;
    });

  return (
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
            value={fallback?.[language] ?? ""}
            onChange={(text) => changeFallback(language, text)}
          />
        ))}
      </div>
    </fieldset>
  );
}

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
  const { definition, update, takenNames } = useEmailValueDefinition(index);
  const headingId = useId();
  const containerId = emailEditorFieldIds.value(index);
  const containerProblems = useEmailFieldProblems(containerId);
  const used = referencedNames.has(definition.name ?? "");
  const title =
    definition.name ||
    m.emailsEditorValuesUnnamed({ number: index + 1 }, { locale });

  return (
    <li
      id={containerId}
      tabIndex={-1}
      aria-labelledby={headingId}
      className="space-y-4 rounded-xl border border-navy-blue/10 bg-white p-4 outline-none focus-visible:ring-2 focus-visible:ring-burned-orange"
      aria-describedby={containerProblems.describedBy}
    >
      <EmailValueDefinitionHeader
        count={count}
        headingId={headingId}
        index={index}
        kind={emailValueKind(definition)}
        onDelete={onDelete}
        onMove={onMove}
        title={title}
        used={used}
      />
      {!used && (
        <p className="text-navy-blue/60 text-xs">
          {m.emailsEditorValuesUnusedHint({}, { locale })}
        </p>
      )}
      <EmailFieldProblems fieldId={containerId} />
      <EmailValueNameField
        index={index}
        name={definition.name}
        update={update}
      />
      <EmailValueSourceSettings
        definition={definition}
        discounts={discounts}
        index={index}
        takenNames={takenNames}
        update={update}
      />
      <EmailValueFallbacks
        containerId={containerId}
        fallback={definition.fallback}
        update={update}
      />
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
