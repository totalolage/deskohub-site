import { Effect } from "effect";
import {
  getShareableSelectionPath,
  type ReservationSelection,
} from "@/features/reservation/selection-path";
import { getWorkspaceRuntimeCallbackOrigin } from "@/shared/backend/config/workspace-url.config";

/**
 * An absolute reservation page link on the running deployment, without a
 * locale prefix, for links customers receive outside the app. The selection
 * cannot carry contact details.
 */
export const getShareableReservationUrl = (selection: ReservationSelection) =>
  getWorkspaceRuntimeCallbackOrigin.pipe(
    Effect.map((origin) =>
      new URL(getShareableSelectionPath(selection), origin).toString()
    )
  );
