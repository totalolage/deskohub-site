"use client";

import { useEffect, useEffectEvent, useRef } from "react";
import {
  type Control,
  type FieldPath,
  type FieldPathValue,
  type FieldValues,
  useWatch,
} from "react-hook-form";
import {
  type ReservationSelectionSearchParams,
  setReservationSelectionSearchParams,
} from "@/features/reservation/reservation-checkout-query";

/** The form's current selection: the fields its selection link names. */
export function useWatchedSelection<
  Values extends FieldValues,
  Param extends FieldPath<Values>,
  Transformed,
>(
  link: { readonly params: readonly Param[] },
  control: Control<Values, unknown, Transformed>
): { readonly [Name in Param]: FieldPathValue<Values, Name> } {
  const values: readonly unknown[] = useWatch({ control, name: link.params });
  return Object.fromEntries(
    link.params.map((name, index) => [name, values[index]])
  ) as { readonly [Name in Param]: FieldPathValue<Values, Name> };
}

/**
 * Mirrors a reservation form's selection into the page URL through its
 * selection link as the customer edits it, so a reload or a copied link
 * reopens the same selection.
 *
 * The write replaces the current history entry, so it adds no Back step and
 * makes no server request; Next's App Router keeps `useSearchParams` in step
 * with it. The selection the page opened with stays as the URL already
 * describes it. Pass `undefined` while the selection is incomplete to leave
 * the URL alone.
 */
export function useReservationSelectionUrl<Selection>(
  link: {
    readonly write: (selection: Selection) => ReservationSelectionSearchParams;
  },
  selection: Selection | undefined
) {
  const searchParams =
    selection === undefined ? undefined : link.write(selection);
  // Entries keep the parameters a selection removes (set to `undefined`).
  const selectionKey =
    searchParams && JSON.stringify(Object.entries(searchParams));
  const writtenSelectionKey = useRef(selectionKey);
  const writeSelection = useEffectEvent(() => {
    if (searchParams === undefined) return;

    const url = new URL(window.location.href);
    setReservationSelectionSearchParams(url.searchParams, searchParams);
    if (url.href !== window.location.href) {
      window.history.replaceState(null, "", url);
    }
  });

  useEffect(() => {
    if (
      selectionKey === undefined ||
      selectionKey === writtenSelectionKey.current
    ) {
      return;
    }
    writtenSelectionKey.current = selectionKey;
    writeSelection();
  }, [selectionKey]);
}
