"use client";

import { useCallback, useState } from "react";

/**
 * Shared controlled/uncontrolled value state for the date-time controls.
 * A control is controlled when `value` is provided; otherwise it keeps the
 * `defaultValue` internally. In both modes `onChange` reports accepted edits.
 * The empty/optional state is `undefined`.
 */
export const useControllableState = <T>({
  defaultValue,
  onChange,
  value,
}: {
  readonly defaultValue?: T;
  readonly onChange?: (value: T | undefined) => void;
  readonly value?: T;
}): readonly [T | undefined, (next: T | undefined) => void] => {
  const isControlled = value !== undefined;
  const [internal, setInternal] = useState<T | undefined>(defaultValue);
  const state = isControlled ? value : internal;

  const setState = useCallback(
    (next: T | undefined) => {
      if (!isControlled) setInternal(next);
      onChange?.(next);
    },
    [isControlled, onChange]
  );

  return [state, setState] as const;
};
