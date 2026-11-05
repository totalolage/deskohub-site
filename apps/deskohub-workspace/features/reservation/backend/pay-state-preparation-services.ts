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

/**
 * The services `prepareWorkspacePayState` books through, except the account
 * services (`OptionalAccountActivityGuard` and
 * `CustomerAccountContactService`): each caller provides those for its own
 * authentication, the browser session or an agent's access token.
 */
export const payStatePreparationServices = Layer.mergeAll(
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
