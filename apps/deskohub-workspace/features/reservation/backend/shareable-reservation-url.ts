import { Effect } from "effect";
import {
  type ReservationSelectionSearchParams,
  setReservationSelectionSearchParams,
} from "@/features/reservation/reservation-checkout-query";
import type { ReservationOrderData } from "@/features/reservation/reservation-order";
import { getShareableReservationStartPath } from "@/features/reservation/routes";
import { getWorkspaceRuntimeCallbackOrigin } from "@/shared/backend/config/workspace-url.config";

/**
 * An absolute reservation page link on the running deployment, without a
 * locale prefix, for links customers receive outside the app. The selection
 * cannot carry contact details.
 */
export const getShareableReservationUrl = (
  kind: ReservationOrderData["kind"],
  selection: ReservationSelectionSearchParams = {}
) =>
  getWorkspaceRuntimeCallbackOrigin.pipe(
    Effect.map((origin) => {
      const searchParams = new URLSearchParams();
      setReservationSelectionSearchParams(searchParams, selection);
      return new URL(
        getShareableReservationStartPath(kind, searchParams),
        origin
      ).toString();
    })
  );
