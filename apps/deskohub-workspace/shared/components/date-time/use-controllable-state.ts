"use client";

import { useCallback, useState } from "react";

/**
 * Shared controlled/uncontrolled value state for the date-time controls.
 * A control is controlled once the parent asserts any `value`, including an
 * explicit empty string: control ownership is independent of emptiness, so
 * a parent holding `value=""` stays authoritative even when it rejects an
 * edit. `undefined` starts uncontrolled and stays that way. In both modes
 * `onChange` reports accepted edits, including explicit clears as
 * `undefined`.
 */
export const useControllableState = ({
  defaultValue,
  onChange,
  value,
}: {
  readonly defaultValue?: string;
  readonly onChange?: (value: string | undefined) => void;
  readonly value?: string;
}): readonly [
  string | undefined,
  (next: string | undefined) => void,
  boolean,
] => {
  // React's "adjust state during render" pattern: deriving sticky ownership
  // from state keeps controlled-mode tracking out of render-time ref access.
  // The update fires only when this very component's render observes a first
  // defined `value`; React discards the output and re-renders immediately.
  const [everControlled, setEverControlled] = useState(value !== undefined);
  if (value !== undefined && !everControlled) setEverControlled(true);
  const isControlled = everControlled;
  const [internal, setInternal] = useState<string | undefined>(defaultValue);
  const state = isControlled ? value : internal;

  const setState = useCallback(
    (next: string | undefined) => {
      if (!isControlled) setInternal(next);
      onChange?.(next);
    },
    [isControlled, onChange]
  );

  return [state, setState, isControlled] as const;
};
