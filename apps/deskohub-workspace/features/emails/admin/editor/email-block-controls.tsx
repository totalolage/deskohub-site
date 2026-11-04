"use client";

import { type ReactNode, useEffect, useState } from "react";
import { useWatch } from "react-hook-form";
import type { Locale } from "@/features/i18n";
import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/components/ui/select";
import {
  type EmailDraftComponent,
  useEmailDraftForm,
} from "./email-draft-form";
import {
  EmailFieldProblems,
  useEmailFieldProblems,
} from "./email-editor-context";
import { emailEditorFieldIds } from "./email-editor-field-ids";
import { EmailInlineTextField } from "./email-inline-text-field";
import {
  emailBlockTextKeys,
  withoutEmailTexts,
} from "./email-structure-blocks";

/**
 * The block at `index` of the host form's structure and a writer that
 * replaces it whole, so unset settings leave no key behind.
 */
export const useEmailBlock = (
  index: number
): readonly [
  EmailDraftComponent | undefined,
  (next: EmailDraftComponent) => void,
] => {
  const { control, setValue } = useEmailDraftForm();
  const component = useWatch({ control, name: `structure.${index}` });
  const update = (next: EmailDraftComponent) =>
    setValue(`structure.${index}`, next, { shouldDirty: true });
  return [component, update] as const;
};

/**
 * Deletes the texts `textKeys` name from every language, including the ones
 * the editor doesn't show, once the block or item owning them is gone. Call
 * it after removing the owner from the structure: a text another block still
 * uses stays.
 */
export const useRemoveEmailTexts = () => {
  const { getValues, setValue } = useEmailDraftForm();
  return (textKeys: readonly string[]) => {
    const translations = getValues("translations");
    const inUse = new Set(
      (getValues("structure") ?? []).flatMap(emailBlockTextKeys)
    );
    const unused = textKeys.filter((textKey) => !inUse.has(textKey));
    if (!translations || unused.length === 0) return;
    const next = withoutEmailTexts(translations, unused);
    if (next) setValue("translations", next, { shouldDirty: true });
  };
};

/**
 * Where focus goes once the row at `position` is removed, given the same
 * control of each remaining row: the row that took its place, else the row
 * before it, else `fallback`.
 */
export const emailRowRemovalFocus = (
  remainingRowControlIds: readonly string[],
  position: number,
  fallback: string
): readonly string[] =>
  [
    remainingRowControlIds[position],
    remainingRowControlIds[position - 1],
    fallback,
  ].filter((id): id is string => id !== undefined);

/**
 * Moves focus after the structure changed under it: to the first of
 * `candidates`, by element id, that is rendered and enabled once React has
 * committed the change. A moved control's element may be remounted, and a
 * button may turn disabled at the end of its list.
 */
export const useEmailFocusAfterChange = () => {
  // Each request is a new object, so the effect runs once per request.
  const [request, setRequest] = useState<{
    readonly candidates: readonly string[];
  }>();
  useEffect(() => {
    for (const id of request?.candidates ?? []) {
      const element = document.getElementById(id);
      if (!element || element.hasAttribute("disabled")) continue;
      element.focus();
      return;
    }
  }, [request]);
  return (candidates: readonly string[]) => setRequest({ candidates });
};

/** A labelled shared setting with its problems under it. */
function EmailBlockSettingFrame({
  children,
  fieldId,
  hint,
  label,
}: {
  readonly children: ReactNode;
  readonly fieldId: string;
  readonly hint?: string;
  readonly label: string;
}) {
  return (
    <div className="min-w-0 space-y-1.5">
      <Label className="text-navy-blue text-xs" htmlFor={fieldId}>
        {label}
      </Label>
      {children}
      {hint && <p className="text-navy-blue/60 text-xs">{hint}</p>}
      <EmailFieldProblems fieldId={fieldId} />
    </div>
  );
}

const compactInput = "h-9 min-h-9 rounded-lg px-3 py-1.5 text-sm";

/** A shared text setting, such as a destination; empty means unset. */
export function EmailBlockTextSetting({
  fieldId,
  hint,
  label,
  onChange,
  placeholder,
  type = "text",
  value,
}: {
  readonly fieldId: string;
  readonly hint?: string;
  readonly label: string;
  readonly onChange: (value: string | undefined) => void;
  readonly placeholder?: string;
  readonly type?: "text" | "url";
  readonly value: string | undefined;
}) {
  const { controlProps } = useEmailFieldProblems(fieldId);
  return (
    <EmailBlockSettingFrame fieldId={fieldId} hint={hint} label={label}>
      <Input
        {...controlProps}
        className={compactInput}
        id={fieldId}
        onChange={(event) => onChange(event.target.value || undefined)}
        placeholder={placeholder}
        type={type}
        value={value ?? ""}
      />
    </EmailBlockSettingFrame>
  );
}

/**
 * A shared whole-number setting. An empty field unsets it; a number below
 * `min` or with a fraction is kept only in the field, never written, and the
 * field shows the stored number again when it loses focus.
 */
export function EmailBlockNumberSetting({
  fieldId,
  hint,
  label,
  min,
  onChange,
  value,
}: {
  readonly fieldId: string;
  readonly hint?: string;
  readonly label: string;
  readonly min: number;
  readonly onChange: (value: number | undefined) => void;
  readonly value: number | undefined;
}) {
  const { controlProps } = useEmailFieldProblems(fieldId);
  const stored = value === undefined ? "" : String(value);
  const [previous, setPrevious] = useState(stored);
  const [draft, setDraft] = useState(stored);
  if (previous !== stored) {
    setPrevious(stored);
    setDraft(stored);
  }
  return (
    <EmailBlockSettingFrame fieldId={fieldId} hint={hint} label={label}>
      <Input
        {...controlProps}
        className={`${compactInput} w-32`}
        id={fieldId}
        inputMode="numeric"
        min={min}
        onBlur={() => setDraft(stored)}
        onChange={(event) => {
          const next = event.target.value;
          setDraft(next);
          if (next.trim() === "") return onChange(undefined);
          const number = Number(next);
          if (Number.isInteger(number) && number >= min) onChange(number);
        }}
        step={1}
        type="number"
        value={draft}
      />
    </EmailBlockSettingFrame>
  );
}

/** One choice of a select setting. */
export type EmailBlockOption = {
  readonly value: string;
  readonly label: string;
};

/** A shared setting chosen from `options`; an unset one shows `placeholder`. */
export function EmailBlockSelectSetting({
  fieldId,
  hint,
  label,
  onChange,
  options,
  placeholder,
  value,
}: {
  readonly fieldId: string;
  readonly hint?: string;
  readonly label: string;
  readonly onChange: (value: string) => void;
  readonly options: readonly EmailBlockOption[];
  readonly placeholder: string;
  readonly value: string | undefined;
}) {
  const { controlProps } = useEmailFieldProblems(fieldId);
  return (
    <EmailBlockSettingFrame fieldId={fieldId} hint={hint} label={label}>
      <Select onValueChange={onChange} value={value ?? ""}>
        <SelectTrigger
          {...controlProps}
          className="h-9 min-h-9 min-w-44 rounded-lg px-3 py-1.5 text-sm"
          id={fieldId}
        >
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              {option.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </EmailBlockSettingFrame>
  );
}

/** A plain text of a block, such as a button label, in `contentLocale`. */
export function EmailBlockLabelText({
  contentLocale,
  label,
  textKey,
}: {
  readonly contentLocale: Locale;
  readonly label: string;
  readonly textKey: string | undefined;
}) {
  return (
    textKey && (
      <EmailInlineTextField
        contentLocale={contentLocale}
        fieldId={emailEditorFieldIds.text(contentLocale, textKey)}
        label={label}
        mode="plain"
        target={{ kind: "text", textKey }}
      />
    )
  );
}
