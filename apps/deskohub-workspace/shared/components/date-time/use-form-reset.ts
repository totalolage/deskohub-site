"use client";

import { type RefObject, useEffect } from "react";

/**
 * Calls `onReset` when the form that owns `fieldRef` resets, as a native
 * field returns to its default value then.
 */
export const useFormReset = (
  fieldRef: RefObject<HTMLInputElement | null>,
  onReset: () => void
) => {
  useEffect(() => {
    const form = fieldRef.current?.form;
    if (!form) return;
    form.addEventListener("reset", onReset);
    return () => form.removeEventListener("reset", onReset);
  }, [fieldRef, onReset]);
};
