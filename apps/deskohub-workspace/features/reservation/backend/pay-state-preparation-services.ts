import { EmailRecipientDomainService } from "@deskohub/email/backend/recipient-domain.service";
import { Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { CheckoutPricingService } from "@/features/checkout/backend/checkout";
import { ReservationHoldCleanupScheduleService } from "@/features/checkout/backend/holds";
import { WorkspaceTableAssignmentService } from "@/features/checkout/backend/reservation";
import { WorkspaceFeatureFlagService } from "@/features/feature-flags/backend";
import { CustomerMarketingConsentRepository } from "@/features/legal/backend/customer-marketing-consent.repository";
import { OfficeReservationFeatureFlagService } from "@/features/office/backend/office-reservation-feature-flag.service";
import { ReferralService } from "@/features/referrals";
import { ReferralFeatureFlagRequest } from "@/features/referrals/referral-feature-flag.server";
import { WorkspaceAvailabilityService } from "@/features/reservation/backend/workspace-availability.service";
import { WorkspaceReservationRepository } from "@/features/reservation/backend/workspace-reservation.repository";
import { ReviewAccounts, ReviewSandbox } from "@/features/review-accounts";
import { PostHogEventService } from "@/shared/backend/analytics/posthog-event.service";
import { WorkspaceDotyposLayer } from "@/shared/backend/config/dotypos.config";

/**
 * The services `prepareWorkspacePayState` books through, except the account
 * services (`OptionalAccountActivityGuard` and
 * `CustomerAccountContactService`): each caller provides those for its own
 * authentication, the browser session or an agent's access token.
 */
export const payStatePreparationServices = Layer.mergeAll(
  Layer.mergeAll(
    WorkspaceReservationRepository.Default,
    CustomerMarketingConsentRepository.Default,
    ReviewAccounts.Default,
    ReviewSandbox.Default
  ).pipe(Layer.provide(WorkspaceDatabase.Default)),
  WorkspaceAvailabilityService.Live,
  EmailRecipientDomainService.Live,
  WorkspaceTableAssignmentService.Default.pipe(
    Layer.provide(WorkspaceReservationRepository.Live),
    Layer.provide(WorkspaceDotyposLayer)
  ),
  ReservationHoldCleanupScheduleService.Default,
  PostHogEventService.Live,
  WorkspaceDotyposLayer,
  CheckoutPricingService.Live,
  ReferralService.Live,
  OfficeReservationFeatureFlagService.Default.pipe(
    Layer.provide(WorkspaceFeatureFlagService.Default)
  )
).pipe(Layer.provideMerge(ReferralFeatureFlagRequest));
