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
  /**
   * Time-of-day anchor for the step sequence, separate from the lower
   * bound. Native steps anchor at the `min` attribute, but a composite
   * owner may drop the same-day bound on later dates while its canonical
   * datetime field keeps anchoring at the minimum's time; this keeps the
   * editor on the same sequence. Defaults to the minimum (midnight when
   * unset).
   */
  readonly stepAnchor?: TemporalTimeBoundInput;
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
  stepAnchor,
  timeStepMinutes = 1,
  value,
}: TimeInputProps) {
  const fieldRef = useRef<HTMLInputElement>(null);
  // Boundary props decode against the canonical local-time schema:
  // malformed or non-canonical values (seconds precision, out of range)
  // decode to empty instead of being re-shaped silently. An explicit
  // controlled empty stays controlled: the decoded empty is preserved as
  // "" so emptiness never switches ownership back to internal state.
  const decodeCanonicalTime = (raw: string | undefined) =>
    parseLocalTime(raw)?.toString({ smallestUnit: "minute" });
  const [selectedTime, setSelectedTime, isControlledTime] =
    useControllableState({
      defaultValue: decodeCanonicalTime(defaultValue),
      onChange,
      value:
        value === undefined ? undefined : (decodeCanonicalTime(value) ?? ""),
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
    // The step sequence anchors at the explicit step anchor when the owner
    // provides one, otherwise at the `min` bound (midnight when unset),
    // matching the native anchoring of the canonical field.
    const anchorMinutes =
      minutesOfDay(
        resolveTimeBound(stepAnchor) ?? resolvedMinimum ?? "00:00"
      ) ?? 0;
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
    const restoreControlledEditor = () => {
      if (isControlledTime) editor.value = selectedTime ?? "";
    };
    if (editor.value === "") {
      setSelectedTime(undefined);
      restoreControlledEditor();
      return;
    }
    if (!isTimeAccepted(editor.value)) {
      event.stopPropagation();
      editor.value = selectedTime ?? "";
      return;
    }
    setSelectedTime(editor.value);
    // In controlled mode the owner may reject the reported edit, in which
    // case no rerender restores the display: put the committed value back
    // on screen now. An accepting owner rerenders with the new value
    // immediately after.
    restoreControlledEditor();
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
          control contributes its value to form submission. When an explicit
          step anchor diverges from the min bound (composite owners), the
          owner's canonical field validates the step sequence instead. */}
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
        step={stepAnchor === undefined ? resolvedStepSeconds : undefined}
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
