"use client";

import { Clock } from "lucide-react";
import {
  type FocusEvent,
  type FormEvent,
  type Ref,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { isLocale, m } from "@/features/i18n";
import { useRouteLocale } from "@/features/i18n/route-locale";
import { Input } from "@/shared/components/ui/input";
import { cn } from "@/shared/utils";
import { composeRefs } from "@/shared/utils/compose-refs";
import {
  type ControlBound,
  formatCanonicalTime,
  parseCanonicalTime,
  resolveBound,
} from "./canonical-value";
import { useControllableValue } from "./use-controllable-value";
import { useFormReset } from "./use-form-reset";
import { useSubmitGuard } from "./use-submit-guard";

/** Values are canonical `HH:mm` times; an empty string is no time. */
export type TimeInputProps = {
  readonly "aria-describedby"?: string | undefined;
  readonly "aria-invalid"?: boolean | undefined;
  /** A visible label that names the field instead of `label`. */
  readonly "aria-labelledby"?: string | undefined;
  readonly className?: string | undefined;
  readonly defaultValue?: string | undefined;
  readonly disabled?: boolean | undefined;
  readonly id?: string | undefined;
  /** Names the field. */
  readonly label: string;
  /** Defaults to the route locale. */
  readonly locale?: string | undefined;
  readonly maximum?: ControlBound | undefined;
  readonly minimum?: ControlBound | undefined;
  /** Submits the value with the form under this name. */
  readonly name?: string | undefined;
  readonly onBlur?: (() => void) | undefined;
  readonly onChange?: ((value: string) => void) | undefined;
  readonly ref?: Ref<HTMLInputElement> | undefined;
  readonly required?: boolean | undefined;
  /**
   * Minutes between the times the field takes, counted from midnight, such
   * as 60 for whole hours. Use a step that divides the day.
   */
  readonly stepMinutes?: number | undefined;
  readonly value?: string | undefined;
};

const minutesOfDay = (time: Temporal.PlainTime) => time.hour * 60 + time.minute;

/** The step in whole minutes, at least one. */
export const resolveStepMinutes = (stepMinutes: number | undefined) =>
  Math.max(1, Math.trunc(stepMinutes ?? 1));

/**
 * The first time on the step sequence at or after `minimum`, so the native
 * editor, which counts steps from its `min`, keeps the midnight sequence.
 * Undefined when no step time is left that day.
 */
export const roundTimeUpToStep = (
  minimum: Temporal.PlainTime,
  stepMinutes: number
) => {
  const minutes = Math.ceil(minutesOfDay(minimum) / stepMinutes) * stepMinutes;
  return minutes < 24 * 60
    ? Temporal.PlainTime.from({
        hour: Math.floor(minutes / 60),
        minute: minutes % 60,
      })
    : undefined;
};

/**
 * Whether the time is on the step sequence and inside the bounds. Bounds are
 * canonical `HH:mm` values read at the check.
 */
const isTimeAccepted = ({
  maximum,
  minimum,
  stepMinutes,
  time,
}: {
  readonly maximum: string | undefined;
  readonly minimum: string | undefined;
  readonly stepMinutes: number;
  readonly time: Temporal.PlainTime;
}) => {
  const minimumTime = parseCanonicalTime(minimum);
  const maximumTime = parseCanonicalTime(maximum);
  return (
    minutesOfDay(time) % stepMinutes === 0 &&
    time.second === 0 &&
    (!minimumTime || Temporal.PlainTime.compare(time, minimumTime) >= 0) &&
    (!maximumTime || Temporal.PlainTime.compare(time, maximumTime) <= 0)
  );
};

/**
 * A time-of-day field on the browser's time editor, with optional bounds and
 * a step. Only a complete time inside the bounds and on the step becomes the
 * value. Any other edit stays on screen and keeps the owning form from
 * submitting while it is there. While the field has focus the value stays,
 * so a second keystroke can finish the edit; when the field loses focus the
 * value empties and the field is marked invalid, so the form never holds a
 * time the field does not show. The field says why when the form can't
 * submit.
 */
export function TimeInput({
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
  "aria-labelledby": ariaLabelledBy,
  className,
  defaultValue,
  disabled = false,
  id,
  label,
  locale: localeProp,
  maximum,
  minimum,
  name,
  onBlur,
  onChange,
  ref,
  required = false,
  stepMinutes,
  value,
}: TimeInputProps) {
  const routeLocale = useRouteLocale();
  const locale = localeProp ?? routeLocale;
  // A value that is no canonical minute time shows as empty instead of
  // being re-shaped.
  const toCanonical = (time: string | undefined) => {
    const parsed = parseCanonicalTime(time);
    return parsed ? formatCanonicalTime(parsed) : "";
  };
  const committed = useControllableValue({
    defaultValue: toCanonical(defaultValue),
    onChange,
    value: value === undefined ? undefined : toCanonical(value),
  });
  const hiddenFieldRef = useRef<HTMLInputElement>(null);
  const resolvedStepMinutes = resolveStepMinutes(stepMinutes);
  const minimumTime = parseCanonicalTime(resolveBound(minimum));
  const editorMinimum = minimumTime
    ? roundTimeUpToStep(minimumTime, resolvedStepMinutes)
    : undefined;

  const editorRef = useRef<HTMLInputElement>(null);
  const problemId = useId();
  /**
   * Why the edit on screen can't be the value. It holds while the value is
   * the one it was found with, so a value set from outside takes it away.
   * The field says why once the owning form can't submit; until then it is
   * only marked invalid, as a message appearing when the field loses focus
   * would move a submit button out from under the pointer pressing it.
   */
  const [problemState, setProblemState] = useState<{
    readonly explained: boolean;
    readonly kind: "incomplete" | "unavailable";
    readonly value: string;
  }>();
  const [syncedValue, setSyncedValue] = useState(committed.value);
  if (committed.value !== syncedValue) {
    // A value set from outside replaces the edit, and its problem for good.
    setSyncedValue(committed.value);
    if (problemState && problemState.value !== committed.value)
      setProblemState(undefined);
  }
  const problem =
    problemState?.value === committed.value ? problemState : undefined;
  const explainedProblem = problem?.explained ? problem.kind : undefined;
  /** Set while the value empties for an edit that stays on screen. */
  const keepsEditRef = useRef(false);
  // The editor's text is the browser's own, so an unfinished segmented edit
  // survives re-renders. A changed value replaces whatever it shows, except
  // the empty value an edit left on screen gave it.
  useEffect(() => {
    const keepsEdit = keepsEditRef.current;
    keepsEditRef.current = false;
    if (keepsEdit && committed.value === "") return;
    if (editorRef.current) editorRef.current.value = committed.value;
  }, [committed.value]);
  useFormReset(hiddenFieldRef, () => {
    // The browser puts the editor itself back to its default.
    committed.reset();
    setProblemState(undefined);
  });

  /** Whether the time is on the step and inside the bounds as they are now. */
  const isAccepted = (time: Temporal.PlainTime) =>
    isTimeAccepted({
      maximum: resolveBound(maximum),
      minimum: resolveBound(minimum),
      stepMinutes: resolvedStepMinutes,
      time,
    });
  /** The committed time still holds: bounds can move after it was chosen. */
  const isCommittedAccepted = () => {
    const time = parseCanonicalTime(committed.value);
    return !time || isAccepted(time);
  };
  const getProblem = (editor: HTMLInputElement) => {
    if (editor.validity.badInput) return "incomplete";
    if (editor.value !== committed.value || !isCommittedAccepted())
      return "unavailable";
    return undefined;
  };
  /** Whether the editor shows an edit the field itself can't take. */
  const showsRejectedEdit = (editor: HTMLInputElement) => {
    if (editor.validity.badInput) return true;
    if (editor.value === "") return false;
    const time = parseCanonicalTime(editor.value);
    return !(time && isAccepted(time));
  };
  useSubmitGuard(hiddenFieldRef, () => {
    const editor = editorRef.current;
    const nextProblem = editor && !disabled ? getProblem(editor) : undefined;
    if (!nextProblem) return false;
    setProblemState({
      explained: true,
      kind: nextProblem,
      value: committed.value,
    });
    editor?.focus();
    return true;
  });

  const handleInput = (event: FormEvent<HTMLInputElement>) => {
    const editor = event.currentTarget;
    // The browser reports an unfinished segmented edit as bad input with an
    // empty value. It stays on screen; the value stays.
    if (editor.validity.badInput) return;
    if (editor.value === "") {
      setProblemState(undefined);
      committed.setValue("");
      return;
    }
    // A time outside the bounds or off the step stays on screen too, so a
    // second keystroke can finish it (typing 1 then 1 for 11:00 passes
    // 01:00). It never becomes the value.
    const time = parseCanonicalTime(editor.value);
    if (time && isAccepted(time)) {
      setProblemState(undefined);
      committed.setValue(formatCanonicalTime(time));
    }
  };

  const handleBlur = (event: FocusEvent<HTMLInputElement>) => {
    const editor = event.currentTarget;
    if (showsRejectedEdit(editor)) {
      // An unfinished or rejected edit stays on screen and empties the value,
      // so neither leaving the field nor pressing a submit button, which
      // takes focus first, swaps the edit for the time before it.
      const kind = editor.validity.badInput ? "incomplete" : "unavailable";
      setProblemState({
        explained: problem?.explained === true && problem.kind === kind,
        kind,
        value: "",
      });
      if (committed.value !== "") {
        keepsEditRef.current = true;
        committed.setValue("");
      }
    } else if (editor.value !== committed.value) {
      // A controlled parent didn't take the edit: the field shows its value.
      editor.value = committed.value;
      if (isCommittedAccepted()) setProblemState(undefined);
    }
    onBlur?.();
  };
  const messageLocale = isLocale(locale) ? { locale } : undefined;
  const invalid = Boolean(ariaInvalid || problem);

  return (
    // The field keeps its own height when a neighbouring column grows, so
    // the clock centers on the field.
    <div className={cn("min-w-0 self-start", className)}>
      <input
        ref={hiddenFieldRef}
        disabled={disabled}
        name={name}
        type="hidden"
        value={committed.value}
      />
      <div className="relative">
        <Input
          ref={composeRefs(editorRef, ref)}
          id={id}
          aria-describedby={
            [ariaDescribedBy, explainedProblem ? problemId : undefined]
              .filter(Boolean)
              .join(" ") || undefined
          }
          aria-invalid={invalid}
          aria-label={ariaLabelledBy ? undefined : label}
          aria-labelledby={ariaLabelledBy}
          // Chromium draws its own clock button. It stays clickable as a
          // transparent hit area under the orange clock, so the field shows one
          // clock.
          className="relative pe-12 [&::-webkit-calendar-picker-indicator]:absolute [&::-webkit-calendar-picker-indicator]:inset-y-0 [&::-webkit-calendar-picker-indicator]:end-0 [&::-webkit-calendar-picker-indicator]:m-0 [&::-webkit-calendar-picker-indicator]:h-auto [&::-webkit-calendar-picker-indicator]:w-12 [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-0"
          disabled={disabled}
          max={resolveBound(maximum)}
          min={editorMinimum ? formatCanonicalTime(editorMinimum) : undefined}
          defaultValue={committed.value}
          onBlur={handleBlur}
          onInput={handleInput}
          required={required}
          step={resolvedStepMinutes * 60}
          type="time"
          variant={invalid ? "error" : "default"}
        />
        {/* After the field, so the positioned field doesn't paint over it. */}
        <Clock
          aria-hidden="true"
          className="pointer-events-none absolute end-4 top-1/2 h-5 w-5 -translate-y-1/2 text-burned-orange"
        />
      </div>
      <p
        id={problemId}
        aria-live="polite"
        className="mt-2 text-sm font-medium text-burned-orange empty:sr-only"
      >
        {explainedProblem &&
          {
            incomplete: m.timeInputIncomplete,
            unavailable: m.timeInputUnavailable,
          }[explainedProblem]({}, messageLocale)}
      </p>
    </div>
  );
}
