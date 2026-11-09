"use client";

import { type RefObject, useEffect, useEffectEvent } from "react";

/**
 * Asks `isBlocked` when the form that owns `fieldRef` submits, and stops the
 * submission when it answers true, so a control can keep an unfinished entry
 * from being submitted as a different value. `isBlocked` runs at submit time,
 * after any commit the submitting key or click caused, and may commit or
 * focus the entry itself. It holds in `noValidate` forms, where native
 * constraint validation never runs. The listener sits on the form, so it runs
 * before React's delegated submit handlers, form actions, and React Hook
 * Form's `handleSubmit`.
 */
export const useSubmitGuard = (
  fieldRef: RefObject<HTMLInputElement | null>,
  isBlocked: () => boolean
) => {
  const guard = useEffectEvent((event: SubmitEvent) => {
    if (!isBlocked()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  });

  useEffect(() => {
    const form = fieldRef.current?.form;
    if (!form) return;
    const listener = (event: SubmitEvent) => guard(event);
    form.addEventListener("submit", listener, { capture: true });
    return () =>
      form.removeEventListener("submit", listener, { capture: true });
  }, [fieldRef]);
};
