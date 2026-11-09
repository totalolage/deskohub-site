"use client";

import { useState } from "react";

/**
 * A control's committed value, owned by the parent once it passes `value`
 * (an empty string included) and by the control otherwise. `onChange`
 * reports every accepted edit in both modes; a controlled parent may reject
 * one by not passing it back.
 */
export const useControllableValue = ({
  defaultValue = "",
  onChange,
  value,
}: {
  readonly defaultValue?: string | undefined;
  readonly onChange?: ((value: string) => void) | undefined;
  readonly value?: string | undefined;
}) => {
  // Ownership is sticky, so a parent that briefly passes `undefined` keeps
  // the value. Deriving it in state during render keeps it out of a ref.
  const [isControlled, setIsControlled] = useState(value !== undefined);
  if (value !== undefined && !isControlled) setIsControlled(true);
  const [internalValue, setInternalValue] = useState(defaultValue);

  return {
    isControlled,
    /** Puts the value back to its default, as a form reset does. */
    reset: () => {
      if (!isControlled) setInternalValue(defaultValue);
    },
    setValue: (next: string) => {
      if (!isControlled) setInternalValue(next);
      onChange?.(next);
    },
    value: isControlled ? (value ?? "") : internalValue,
  };
};
