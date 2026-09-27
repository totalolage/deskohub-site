"use client";

import { Clock } from "lucide-react";
import { type FocusEvent, type FormEvent, useCallback, useRef } from "react";
import { Input } from "@/shared/components/ui/input";
import { cn } from "@/shared/utils";
import {
  parseLocalTime,
  resolveTimeBound,
  type TemporalTimeBoundInput,
} from "./temporal-parts";
import { useControllableState } from "./use-controllable-state";
import { useFormReset } from "./use-form-reset";

/**
 * Canonical value type at input boundaries is a plain `HH:mm` string,
 * matching localTimeSchema at minute precision; branded values are
 * assignable without casts.
 */
export type TimeInputProps = {
  readonly ariaDescribedBy?: string;
  readonly ariaInvalid?: boolean;
  readonly ariaLabel: string;
  readonly className?: string;
  readonly defaultValue?: string;
  readonly disabled?: boolean;
  readonly id?: string;
  readonly maximum?: TemporalTimeBoundInput;
  readonly minimum?: TemporalTimeBoundInput;
  readonly name?: string;
  readonly onBlur?: () => void;
  readonly onChange?: (value: string | undefined) => void;
  readonly required?: boolean;
  readonly timeStepMinutes?: number;
  readonly value?: string;
};

const minutesOfDay = (time: string) => {
  const parsed = parseLocalTime(time);
  if (!parsed) return undefined;
  return parsed.hour * 60 + parsed.minute;
};

export function TimeInput({
  ariaDescribedBy,
  ariaInvalid = false,
  ariaLabel,
  className,
  defaultValue,
  disabled = false,
  id,
  maximum,
  minimum,
  name,
  onBlur,
  onChange,
  required = false,
  timeStepMinutes = 1,
  value,
}: TimeInputProps) {
  const fieldRef = useRef<HTMLInputElement>(null);
  // Boundary props decode against the canonical local-time schema:
  // malformed or non-canonical values (seconds precision, out of range)
  // decode to empty instead of being re-shaped silently.
  const decodeCanonicalTime = (raw: string | undefined) =>
    parseLocalTime(raw)?.toString({ smallestUnit: "minute" });
  const [selectedTime, setSelectedTime] = useControllableState({
    defaultValue: decodeCanonicalTime(defaultValue),
    onChange,
    value: decodeCanonicalTime(value),
  });
  const handleReset = useCallback(
    (next: string) => setSelectedTime(next || undefined),
    [setSelectedTime]
  );
  useFormReset({
    defaultCanonicalValue: defaultValue ?? "",
    fieldRef,
    onReset: handleReset,
  });

  const resolvedStepMinutes = Math.max(1, Math.trunc(timeStepMinutes));
  const resolvedStepSeconds = resolvedStepMinutes * 60;

  // Bounds resolve at event time so dynamic minimums and maximums are
  // honored even when the owning form has not re-rendered yet.
  const isTimeAccepted = (candidate: string) => {
    const parsed = parseLocalTime(candidate);
    if (!parsed) return false;
    const resolvedMinimum = resolveTimeBound(minimum);
    const resolvedMaximum = resolveTimeBound(maximum);
    // Native time steps anchor at the `min` attribute (midnight when
    // unset), so the editor anchors at the same bound.
    const anchorMinutes = minutesOfDay(resolvedMinimum ?? "00:00") ?? 0;
    const offset =
      (((parsed.hour * 60 + parsed.minute - anchorMinutes) % 1440) + 1440) %
      1440;
    if (offset % resolvedStepMinutes !== 0) return false;
    if (resolvedMinimum !== undefined && candidate < resolvedMinimum)
      return false;
    if (resolvedMaximum !== undefined && candidate > resolvedMaximum)
      return false;
    return true;
  };

  const handleEditorInput = (event: FormEvent<HTMLInputElement>) => {
    const editor = event.currentTarget;
    // Native time editors report badInput/valueMissing with a partial value
    // while a segmented edit is incomplete. The editor owns its draft: keep
    // the incomplete keystrokes on screen and the committed value canonical
    // instead of coercing an unfinished edit into null.
    if (!editor.validity.valid) {
      event.stopPropagation();
      return;
    }
    if (editor.value === "") {
      setSelectedTime(undefined);
      return;
    }
    if (!isTimeAccepted(editor.value)) {
      event.stopPropagation();
      editor.value = selectedTime ?? "";
      return;
    }
    setSelectedTime(editor.value);
  };

  const handleEditorBlur = (event: FocusEvent<HTMLInputElement>) => {
    const editor = event.currentTarget;
    // An abandoned incomplete or rejected edit reverts to the committed
    // value instead of lingering as an invisible draft.
    const committed = selectedTime ?? "";
    if (editor.value !== committed) editor.value = committed;
    onBlur?.();
  };

  return (
    <div className={cn("relative", className)}>
      {/* The canonical field validates even when unnamed; only a named
          control contributes its value to form submission. */}
      <input
        aria-hidden="true"
        className="sr-only pointer-events-none"
        disabled={disabled}
        id={id ? `${id}-canonical` : undefined}
        max={resolveTimeBound(maximum)}
        min={resolveTimeBound(minimum)}
        name={name}
        onChange={() => undefined}
        ref={fieldRef}
        required={required}
        step={resolvedStepSeconds}
        tabIndex={-1}
        type="time"
        value={selectedTime ?? ""}
      />
      <Clock className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-burned-orange" />
      <Input
        aria-describedby={ariaDescribedBy}
        aria-invalid={ariaInvalid}
        aria-label={ariaLabel}
        aria-required={required || undefined}
        className="pl-11"
        disabled={disabled}
        id={id}
        onBlur={handleEditorBlur}
        onInput={handleEditorInput}
        required={required}
        type="time"
        value={selectedTime ?? ""}
      />
    </div>
  );
}
