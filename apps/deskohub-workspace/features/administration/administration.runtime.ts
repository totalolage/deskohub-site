import { Layer } from "effect";
import { WorkspaceDatabaseLive } from "@/db/database.service";
import { DotyposServiceLive } from "@/shared/backend/config/dotypos.config";
import { AdministrationService } from "./administration.service";
import { PostHogReservationHistory } from "./posthog-reservation-history";

const AdministrationDependenciesLive = Layer.mergeAll(
  WorkspaceDatabaseLive,
  DotyposServiceLive,
  PostHogReservationHistory.Default
);

export const AdministrationLive = AdministrationService.Live.pipe(
  Layer.provide(AdministrationDependenciesLive)
);
