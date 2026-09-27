"use client";

import { useCallback, useRef, useState } from "react";

/**
 * Shared controlled/uncontrolled value state for the date-time controls.
 * A control is controlled once the parent asserts a non-empty `value` and
 * stays controlled: `undefined` and `""` are CONTROLLED-EMPTY states, not a
 * switch back to uncontrolled mode, so a parent can always reset to empty
 * and the user can still construct a value from it. In both modes `onChange`
 * reports accepted edits, including explicit clears as `undefined`.
 */
export const useControllableState = ({
  defaultValue,
  onChange,
  value,
}: {
  readonly defaultValue?: string;
  readonly onChange?: (value: string | undefined) => void;
  readonly value?: string;
}): readonly [string | undefined, (next: string | undefined) => void] => {
  const everControlledRef = useRef(false);
  if (value !== undefined && value !== "") everControlledRef.current = true;
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

  return [state, setState] as const;
};
