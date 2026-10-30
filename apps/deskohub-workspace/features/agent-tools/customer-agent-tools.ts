import { Layer } from "effect";
import { CustomerReservationHistoryService } from "@/features/account";
import { CheckoutPricingService } from "@/features/checkout/backend/checkout/checkout-pricing.service";
import { CheckoutStatusService } from "@/features/checkout/backend/checkout/checkout-status.service";
import { OfficeReservationFeatureFlagService } from "@/features/office/backend/office-reservation-feature-flag.service";
import { ReferralFeatureFlagRequest } from "@/features/referrals/referral-feature-flag.server";
import { RememberedReferral } from "@/features/referrals/remembered-referral.service";
import { SharedAvailabilityInventoryLive } from "@/features/reservation/backend/availability-inventory-cache.server";
import { payStatePreparationServices } from "@/features/reservation/backend/pay-state-preparation-services";
import { SharedReservationRecordsLive } from "@/features/reservation/backend/reservation-records-cache.server";
import { WorkspaceAvailabilityService } from "@/features/reservation/backend/workspace-availability.service";
import { WorkspaceReservationRepository } from "@/features/reservation/backend/workspace-reservation.repository";
import { ReviewSandbox } from "@/features/review-accounts";

/**
 * The services customer tools read through. Public tools read availability
 * and office capacity only from the shared advisory snapshots, never from
 * Dotypos directly. Signed-in tools book live and read the customer's own
 * reservations from the shared reservation records, which protects the
 * Dotypos quota bookings share; browser pages read those live. An agent's
 * tool call has no browser, so it remembers no referral code.
 */
export const CustomerAgentToolsLive = Layer.mergeAll(
  WorkspaceAvailabilityService.Live,
  SharedAvailabilityInventoryLive,
  CheckoutPricingService.Live.pipe(
    Layer.provideMerge(ReferralFeatureFlagRequest)
  ),
  OfficeReservationFeatureFlagService.Live,
  payStatePreparationServices,
  RememberedReferral.none,
  WorkspaceReservationRepository.Live,
  CheckoutStatusService.withRecords(SharedReservationRecordsLive),
  CustomerReservationHistoryService.withRecords(SharedReservationRecordsLive),
  ReviewSandbox.Live
);
