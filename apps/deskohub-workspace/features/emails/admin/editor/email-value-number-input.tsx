"use client";

import { Input } from "@/shared/components/ui/input";
import { Label } from "@/shared/components/ui/label";
import {
  EmailFieldProblems,
  useEmailFieldProblems,
} from "./email-editor-context";

/**
 * The whole number an input holds. An empty input, or one holding a fraction
 * or anything else, has none, so the setting is unset and never rounded.
 */
const enteredWholeNumber = (text: string): number | undefined => {
  if (text.trim() === "") return undefined;
  const number = Number(text);
  return Number.isSafeInteger(number) ? number : undefined;
};

/**
 * A value setting that holds an optional whole number. Clearing the input
 * unsets the setting.
 */
export function EmailValueNumberInput({
  hint,
  id,
  label,
  onChange,
  value,
}: {
  readonly hint?: string;
  readonly id: string;
  readonly label: string;
  readonly onChange: (value: number | undefined) => void;
  readonly value: number | undefined;
}) {
  const { invalid, controlProps } = useEmailFieldProblems(id);
  const hintId = `${id}-hint`;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        min={1}
        step={1}
        className="h-9 min-h-9 w-32 rounded-md px-3 py-1.5 text-sm"
        variant={invalid ? "error" : "default"}
        value={value ?? ""}
        onChange={(event) => onChange(enteredWholeNumber(event.target.value))}
        {...controlProps}
        aria-describedby={
          [controlProps["aria-describedby"], hint && hintId]
            .filter(Boolean)
            .join(" ") || undefined
        }
      />
      {hint && (
        <p className="text-navy-blue/55 text-xs" id={hintId}>
          {hint}
        </p>
      )}
      <EmailFieldProblems fieldId={id} />
    </div>
  );
}
