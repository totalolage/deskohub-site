"use client";

import { useEffect, useEffectEvent, useRef } from "react";
import {
  type ReservationSelectionSearchParams,
  setReservationSelectionSearchParams,
} from "@/features/reservation/reservation-checkout-query";

/**
 * Mirrors a reservation form's selection into the page URL as the customer
 * edits it, so a reload or a copied link reopens the same selection.
 *
 * The write replaces the current history entry, so it adds no Back step and
 * makes no server request; Next's App Router keeps `useSearchParams` in step
 * with it. The selection the page opened with stays as the URL already
 * describes it. Pass `undefined` while the selection is incomplete to leave
 * the URL alone.
 */
export function useReservationSelectionUrl(
  selection: ReservationSelectionSearchParams | undefined
) {
  // Entries keep the parameters a selection removes (set to `undefined`).
  const selectionKey = selection && JSON.stringify(Object.entries(selection));
  const writtenSelectionKey = useRef(selectionKey);
  const writeSelection = useEffectEvent(() => {
    if (selection === undefined) return;

    const url = new URL(window.location.href);
    setReservationSelectionSearchParams(url.searchParams, selection);
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
