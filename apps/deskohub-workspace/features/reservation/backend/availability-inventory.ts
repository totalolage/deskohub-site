import {
  type DotyposReadFailure,
  type DotyposReservationInterval,
  DotyposService,
  type DotyposTable,
} from "@deskohub/dotypos";
import type {
  GoogleCalendarError,
  GoogleCalendarEventQuery,
} from "@deskohub/google-calendar";
import { Context, Effect, Layer } from "effect";
import type { SharedSnapshotLoadFailure } from "@/shared/backend/shared-snapshot";
import {
  GoogleCalendarWorkspaceLimitationsService,
  type WorkspaceCalendarLimitation,
} from "./google-calendar-workspace-limitations.service";
import type { ReservationRecord } from "./reservation-record";

export type AvailabilityInventoryError =
  | DotyposReadFailure
  | GoogleCalendarError
  | SharedSnapshotLoadFailure;

/** The provider reads that availability is computed from. */
export interface AvailabilityInventory {
  readonly tables: Effect.Effect<
    readonly DotyposTable[],
    AvailabilityInventoryError
  >;
  readonly listActiveReservationsOverlapping: (
    interval: DotyposReservationInterval
  ) => Effect.Effect<readonly ReservationRecord[], AvailabilityInventoryError>;
  readonly listLimitations: (
    query: GoogleCalendarEventQuery
  ) => Effect.Effect<
    readonly WorkspaceCalendarLimitation[],
    AvailabilityInventoryError
  >;
}

/** Reads every availability input live from its provider. */
export const makeProviderInventory = Effect.gen(function* () {
  const dotypos = yield* DotyposService;
  const calendarLimitations = yield* GoogleCalendarWorkspaceLimitationsService;

  return {
    tables: dotypos.getTables(),
    listActiveReservationsOverlapping: (interval) =>
      dotypos.listActiveReservationsOverlapping(interval),
    listLimitations: (query) => calendarLimitations.listLimitations(query),
  } satisfies AvailabilityInventory;
});

/**
 * The inventory behind advisory availability reads, which may serve a shared
 * snapshot. Checks that guard a booking read the providers directly instead.
 */
export class AdvisoryAvailabilityInventory extends Context.Service<
  AdvisoryAvailabilityInventory,
  AvailabilityInventory
>()("@deskohub-workspace/reservation/AdvisoryAvailabilityInventory") {
  static Provider = Layer.effect(this, makeProviderInventory);
}
