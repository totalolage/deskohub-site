import "server-only";

import { DotyposService } from "@deskohub/dotypos";
import { Effect } from "effect";
import { DotyposServiceLive } from "@/shared/backend/config/dotypos.config";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";
import { getOfficeReservationSeatCapacity } from "./office-reservation-capacity";

export const loadOfficeReservationSeatCapacity = () =>
  Effect.gen(function* () {
    const dotypos = yield* DotyposService;
    return yield* getOfficeReservationSeatCapacity(yield* dotypos.getTables());
  }).pipe(
    Effect.provide(DotyposServiceLive),
    runWorkspaceEffect("reservation.office.load-seat-capacity", {
      boundary: "page",
    })
  );
