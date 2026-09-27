"use client";

import { Option, Schema } from "effect";
import { Clock } from "lucide-react";
import { type FormEvent, useCallback, useRef } from "react";
import { Input } from "@/shared/components/ui/input";
import { cn } from "@/shared/utils";
import { localTimeSchema } from "@/shared/utils/temporal";
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
  readonly maximum?: string;
  readonly minimum?: string;
  readonly name?: string;
  readonly onBlur?: () => void;
  readonly onChange?: (value: string | undefined) => void;
  readonly required?: boolean;
  readonly timeStepMinutes?: number;
  readonly value?: string;
};

const decodeLocalTimeOption = Schema.decodeUnknownOption(localTimeSchema);

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
  const [selectedTime, setSelectedTime] = useControllableState({
    defaultValue,
    onChange,
    value,
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

  const isTimeAccepted = (candidate: string) => {
    const decoded = Option.getOrUndefined(decodeLocalTimeOption(candidate));
    if (decoded === undefined) return false;
    const parsed = Temporal.PlainTime.from(decoded);
    if ((parsed.hour * 60 + parsed.minute) % resolvedStepMinutes !== 0) {
      return false;
    }
    if (minimum !== undefined && candidate < minimum) return false;
    if (maximum !== undefined && candidate > maximum) return false;
    return true;
  };

  const handleEditorInput = (event: FormEvent<HTMLInputElement>) => {
    const editor = event.currentTarget;
    // Native time editors report badInput/valueMissing with a partial value
    // while a segmented edit is incomplete. Keep the committed value instead
    // of coercing an unfinished edit into null, and keep the draft off the
    // owning form.
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

  return (
    <div className={cn("relative", className)}>
      {name && (
        <input
          aria-hidden="true"
          className="sr-only pointer-events-none"
          disabled={disabled}
          id={id ? `${id}-canonical` : undefined}
          max={maximum}
          min={minimum}
          name={name}
          onChange={() => undefined}
          ref={fieldRef}
          required={required}
          step={resolvedStepSeconds}
          tabIndex={-1}
          type="time"
          value={selectedTime ?? ""}
        />
      )}
      <Clock className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-burned-orange" />
      <Input
        aria-describedby={ariaDescribedBy}
        aria-invalid={ariaInvalid}
        aria-label={ariaLabel}
        aria-required={required || undefined}
        className="pl-11"
        disabled={disabled}
        id={id}
        onBlur={onBlur}
        onInput={handleEditorInput}
        required={required}
        type="time"
        value={selectedTime ?? ""}
      />
    </div>
  );
}
