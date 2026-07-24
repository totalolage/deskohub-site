"use server";

import { Effect, Layer } from "effect";
import { WorkspaceDatabaseLive } from "@/db/database.service";
import { CheckoutPricingServiceLiveWithDependencies } from "@/features/checkout/backend/checkout/checkout-pricing.runtime";
import { ReservationHoldCleanupScheduleService } from "@/features/checkout/backend/holds";
import { LegalEvidenceEventRepositoryLive } from "@/features/checkout/backend/repositories";
import {
  WorkspaceCheckoutAccessCodeServiceLive,
  WorkspaceTableAssignmentService,
} from "@/features/checkout/backend/reservation";
import { WorkspaceAvailabilityService } from "@/features/reservation/backend/workspace-availability.service";
import { WorkspaceReservationRepositoryLive } from "@/features/reservation/backend/workspace-reservation.repository";
import { PostHogEventServiceLive } from "@/shared/backend/analytics/posthog-event.service";
import { DotyposServiceLive } from "@/shared/backend/config/dotypos.config";
import { defineWorkspaceAction } from "@/shared/backend/workspace-action";
import { prepareWorkspacePayState } from "./prepare-pay-state";
import { preparePayStateSchema } from "./prepare-pay-state.schema";

const PreparePayStateLive = Layer.mergeAll(
  Layer.mergeAll(
    WorkspaceReservationRepositoryLive,
    LegalEvidenceEventRepositoryLive
  ).pipe(Layer.provide(WorkspaceDatabaseLive)),
  WorkspaceAvailabilityService.LiveWithDependencies,
  WorkspaceTableAssignmentService.Live.pipe(
    Layer.provide(
      WorkspaceReservationRepositoryLive.pipe(
        Layer.provide(WorkspaceDatabaseLive)
      )
    ),
    Layer.provide(DotyposServiceLive)
  ),
  WorkspaceCheckoutAccessCodeServiceLive,
  ReservationHoldCleanupScheduleService.Live,
  PostHogEventServiceLive,
  DotyposServiceLive,
  CheckoutPricingServiceLiveWithDependencies
);

const preparePayStateAction = defineWorkspaceAction(
  {
    operation: "checkout.prepare-pay-state",
    schema: preparePayStateSchema,
  },
  (input) =>
    prepareWorkspacePayState(input).pipe(Effect.provide(PreparePayStateLive))
);

export const preparePayState: typeof preparePayStateAction = async (
  ...args: Parameters<typeof preparePayStateAction>
) => await preparePayStateAction(...args);
