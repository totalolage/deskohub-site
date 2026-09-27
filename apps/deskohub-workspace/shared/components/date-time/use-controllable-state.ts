"use client";

import { useCallback, useRef, useState } from "react";

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
  const everControlledRef = useRef(false);
  if (value !== undefined) everControlledRef.current = true;
  const isControlled = everControlledRef.current;
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
