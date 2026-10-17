import { Effect } from "effect";
import type { ReservationOrderData } from "@/features/reservation/reservation-order";
import { getShareableReservationStartPath } from "@/features/reservation/routes";
import { getWorkspaceRuntimeCallbackOrigin } from "@/shared/backend/config/workspace-url.config";

/**
 * An absolute reservation page link on the running deployment, without a
 * locale prefix, for links customers receive outside the app.
 */
export const getShareableReservationUrl = (
  kind: ReservationOrderData["kind"],
  searchParams?: URLSearchParams
) =>
  getWorkspaceRuntimeCallbackOrigin.pipe(
    Effect.map((origin) =>
      new URL(
        getShareableReservationStartPath(kind, searchParams),
        origin
      ).toString()
    )
  );
