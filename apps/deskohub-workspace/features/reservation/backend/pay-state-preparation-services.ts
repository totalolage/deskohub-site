import { EmailRecipientDomainService } from "@deskohub/email/backend/recipient-domain.service";
import { Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { CheckoutAnalytics } from "@/features/checkout/backend/analytics";
import { CheckoutPricingService } from "@/features/checkout/backend/checkout";
import { ReservationHoldCleanupScheduleService } from "@/features/checkout/backend/holds";
import { WorkspaceTableAssignmentService } from "@/features/checkout/backend/reservation";
import { AnalyticsConsentLedger } from "@/features/legal/backend/analytics-consent-ledger";
import { MarketingConsentLedger } from "@/features/legal/backend/marketing-consent-ledger";
import { OfficeReleaseGate } from "@/features/office/backend/office-release-gate";
import { ReferralService } from "@/features/referrals";
import type { ReferralReleaseGate } from "@/features/referrals/referral-release-gate";
import { ReferralReleaseGateRequest } from "@/features/referrals/referral-release-gate.server";
import { WorkspaceAvailabilityService } from "@/features/reservation/backend/workspace-availability.service";
import { WorkspaceReservationRepository } from "@/features/reservation/backend/workspace-reservation.repository";
import { ReviewAccounts, ReviewSandbox } from "@/features/review-accounts";
import { WorkspaceDotyposLayer } from "@/shared/backend/config/dotypos.config";
import { SealedStateKeys } from "@/shared/backend/sealed-state-keys.service";

const payStatePreparationServiceSet = Layer.mergeAll(
  Layer.mergeAll(
    WorkspaceReservationRepository.Default,
    MarketingConsentLedger.Default,
    AnalyticsConsentLedger.Default,
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
  SealedStateKeys.Default
);

/**
 * The services `prepareWorkspacePayState` books through, with the release
 * gates the caller decides, except the account services
 * (`CustomerAccountSections` and `CustomerAccountContactService`): each
 * caller provides those for its own authentication, the browser session or
 * an agent's access token. A caller that decides the gates once per request,
 * such as the customer HTTP API, passes the gates it built, so preparation
 * shares that request's decisions.
 */
export const payStatePreparationServicesWith = <E, R>(releases: {
  readonly referral: Layer.Layer<ReferralReleaseGate, E, R>;
  readonly office: Layer.Layer<OfficeReleaseGate, E, R>;
}) =>
  payStatePreparationServiceSet.pipe(
    Layer.provideMerge(Layer.mergeAll(releases.referral, releases.office))
  );

/**
 * The preparation services with the gates of a Next.js render or Server
 * Action, as the site and the customer agent tools book.
 */
export const payStatePreparationServices = payStatePreparationServicesWith({
  referral: ReferralReleaseGateRequest,
  office: OfficeReleaseGate.Live,
});
