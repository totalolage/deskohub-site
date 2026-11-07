import { EmailRecipientDomainService } from "@deskohub/email/backend/recipient-domain.service";
import { Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { CheckoutAnalytics } from "@/features/checkout/backend/analytics";
import { CheckoutPricingService } from "@/features/checkout/backend/checkout";
import { ReservationHoldCleanupScheduleService } from "@/features/checkout/backend/holds";
import { WorkspaceTableAssignmentService } from "@/features/checkout/backend/reservation";
import { MarketingConsentLedger } from "@/features/legal/backend/marketing-consent-ledger";
import { OfficeReleaseGate } from "@/features/office/backend/office-release-gate";
import { ReferralService } from "@/features/referrals";
import { ReferralReleaseGateRequest } from "@/features/referrals/referral-release-gate.server";
import { WorkspaceAvailabilityService } from "@/features/reservation/backend/workspace-availability.service";
import { WorkspaceReservationRepository } from "@/features/reservation/backend/workspace-reservation.repository";
import { ReviewAccounts, ReviewSandbox } from "@/features/review-accounts";
import { WorkspaceDotyposLayer } from "@/shared/backend/config/dotypos.config";
import { SealedStateKeys } from "@/shared/backend/sealed-state-keys.service";
import type { payStatePreparationServices } from "./pay-state-preparation-services";

/**
 * The site and the customer agent tools book through
 * `payStatePreparationServices`; making the release gates a parameter must
 * leave that Layer as it was: the composition below, never called.
 */
const compositionBeforeGateParameter = () =>
  Layer.mergeAll(
    Layer.mergeAll(
      WorkspaceReservationRepository.Default,
      MarketingConsentLedger.Default,
      ReviewAccounts.Default,
      ReviewSandbox.Default
    ).pipe(Layer.provide(WorkspaceDatabase.Default)),
    WorkspaceAvailabilityService.Live,
    EmailRecipientDomainService.Live,
    WorkspaceTableAssignmentService.Default.pipe(
      Layer.provide(WorkspaceReservationRepository.Live),
      Layer.provide(WorkspaceDotyposLayer)
    ),
    ReservationHoldCleanupScheduleService.Live,
    CheckoutAnalytics.Live,
    WorkspaceDotyposLayer,
    CheckoutPricingService.Live,
    ReferralService.Live,
    OfficeReleaseGate.Live,
    SealedStateKeys.Default
  ).pipe(Layer.provideMerge(ReferralReleaseGateRequest));

type Before = ReturnType<typeof compositionBeforeGateParameter>;
type After = typeof payStatePreparationServices;

type IsExact<Actual, Expected> = [Actual] extends [Expected]
  ? [Expected] extends [Actual]
    ? true
    : false
  : false;
type AssertTrue<Value extends true> = Value;

export type PreparationProvidesTheSameServices = AssertTrue<
  IsExact<Layer.Success<After>, Layer.Success<Before>>
>;
export type PreparationFailsTheSameWay = AssertTrue<
  IsExact<Layer.Error<After>, Layer.Error<Before>>
>;
export type PreparationNeedsTheSameServices = AssertTrue<
  IsExact<Layer.Services<After>, Layer.Services<Before>>
>;
