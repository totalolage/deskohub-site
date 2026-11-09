import { Effect } from "effect";
import { AdvisoryAvailabilityInventory } from "@/features/reservation/backend/availability-inventory";
import { getOfficeReservationSeatCapacity } from "./office-reservation-capacity";

/**
 * The office seat capacity from the shared advisory table snapshot, for reads
 * that must not reach Dotypos on their own.
 */
export const loadAdvisoryOfficeSeatCapacity =
  AdvisoryAvailabilityInventory.pipe(
    Effect.flatMap((inventory) => inventory.tables),
    Effect.flatMap(getOfficeReservationSeatCapacity),
    Effect.withSpan("office.loadAdvisorySeatCapacity")
  );
