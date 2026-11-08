import { Context, Layer } from "effect";
import { CheckoutService } from "@/features/checkout/backend/checkout";
import { OfficeReleaseGateForRun } from "@/features/office/backend/office-release-gate-run";
import { ReferralReleaseGateForRun } from "@/features/referrals/referral-release-gate-run";
import { SharedAvailabilityInventoryLive } from "@/features/reservation/backend/availability-inventory-cache.server";
import { CustomerCheckoutOperations } from "./customer-checkout-operations.service";

const liveCheckoutLayers = {
  /**
   * Holds, discount codes, price acceptance and the author check, built
   * over the request's release gates and referral updates.
   */
  operations: CustomerCheckoutOperations.Default,
  /** Submits a checkout for payment. */
  checkout: CheckoutService.Live,
  /**
   * The shared advisory snapshots that give an office selection its seat
   * maximum, as the quote read them.
   */
  inventory: SharedAvailabilityInventoryLive,
  /** The release gates, each decided once per request. */
  releases: {
    office: OfficeReleaseGateForRun,
    referral: ReferralReleaseGateForRun,
  },
};

/** The Layers the booking checkout's endpoints build their operations from. */
export type CustomerBookingCheckoutLayerSet = typeof liveCheckoutLayers;

/**
 * The booking checkout Layers each customer API request builds its
 * operation from, inside the request's Workspace request context, so a
 * release gate decides once per request and a Layer that can't be built
 * fails only the requests that use it, as unavailable.
 */
export class CustomerBookingCheckoutLayers extends Context.Service<
  CustomerBookingCheckoutLayers,
  CustomerBookingCheckoutLayerSet
>()("@deskohub-workspace/customer-api/CustomerBookingCheckoutLayers") {
  static Live = Layer.succeed(this, liveCheckoutLayers);
}
