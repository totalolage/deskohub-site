import { Layer } from "effect";
import { WorkspaceDatabaseLive } from "@/db/database.service";
import { DotyposServiceLive } from "@/shared/backend/config/dotypos.config";
import { NexiServiceLive } from "@/shared/backend/config/nexi.config";
import { AdministrationService } from "./administration.service";
import { PaymentAdministrationService } from "./payment-administration.service";
import { PostHogReservationHistory } from "./posthog-reservation-history";

const PaymentAdministrationLive = PaymentAdministrationService.Live.pipe(
  Layer.provide(Layer.merge(WorkspaceDatabaseLive, NexiServiceLive))
);

const AdministrationDependenciesLive = Layer.mergeAll(
  WorkspaceDatabaseLive,
  DotyposServiceLive,
  PaymentAdministrationLive,
  PostHogReservationHistory.Default
);

export const AdministrationLive = AdministrationService.Live.pipe(
  Layer.provide(AdministrationDependenciesLive)
);
