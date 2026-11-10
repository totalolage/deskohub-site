import { Context, Layer } from "effect";
import { CheckoutPricingService } from "@/features/checkout/backend/checkout/checkout-pricing.service";
import { OfficeReleaseGateForRun } from "@/features/office/backend/office-release-gate-run";
import { ReferralReleaseGateForRun } from "@/features/referrals/referral-release-gate-run";
import { SharedAvailabilityInventoryLive } from "@/features/reservation/backend/availability-inventory-cache.server";
import { WorkspaceAvailabilityLoaderLive } from "@/features/reservation/backend/workspace-availability-loader";
import { SealedStateKeys } from "@/shared/backend/sealed-state-keys.service";

const liveCatalogLayers = {
  /** Anonymous pricing: the catalog prices and any public sale. */
  pricing: CheckoutPricingService.Live,
  /**
   * The shared advisory snapshots of tables and reservations, which give the
   * office its seat maximum.
   */
  inventory: SharedAvailabilityInventoryLive,
  /** Availability and the replacement hold it may ignore. */
  availability: WorkspaceAvailabilityLoaderLive,
  /** Seals the quote a checkout starts from. */
  sealedStateKeys: SealedStateKeys.Default,
  /**
   * The release gates, each decided once per build, so an endpoint that
   * reads one builds it per request.
   */
  releases: {
    office: OfficeReleaseGateForRun,
    referral: ReferralReleaseGateForRun,
  },
};

/** The Layers the booking catalog's endpoints build their reads from. */
export type CustomerBookingCatalogLayerSet = typeof liveCatalogLayers;

/**
 * The booking catalog Layers each customer API request builds its read from,
 * inside the request's Workspace request context, so a Layer that can't be
 * built fails only the requests that use it, as unavailable. A read that
 * carries a release gate, directly or under pricing's discounts, builds them
 * with `providePerRequest`, so the gate decides once for its request alone.
 */
export class CustomerBookingCatalogLayers extends Context.Service<
  CustomerBookingCatalogLayers,
  CustomerBookingCatalogLayerSet
>()("@deskohub-workspace/customer-api/CustomerBookingCatalogLayers") {
  static Live = Layer.succeed(this, liveCatalogLayers);
}
