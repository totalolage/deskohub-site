"use client";

import { type RefObject, useEffect } from "react";

/**
 * Restores the canonical default when the owning form resets, matching the
 * incumbent native form-reset semantics of the temporal inputs.
 */
export const useFormReset = ({
  defaultCanonicalValue,
  fieldRef,
  onReset,
}: {
  readonly defaultCanonicalValue: string;
  readonly fieldRef: RefObject<HTMLInputElement | null>;
  readonly onReset: (next: string) => void;
}) => {
  useEffect(() => {
    const form = fieldRef.current?.form;
    if (!form) return;
    const handleReset = () => onReset(defaultCanonicalValue);
    form.addEventListener("reset", handleReset);
    return () => form.removeEventListener("reset", handleReset);
  }, [defaultCanonicalValue, fieldRef, onReset]);
};
