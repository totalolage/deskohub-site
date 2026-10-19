import { Layer } from "effect";
import { CheckoutPricingService } from "@/features/checkout/backend/checkout/checkout-pricing.service";
import { OfficeReservationFeatureFlagService } from "@/features/office/backend/office-reservation-feature-flag.service";
import { ReferralFeatureFlagRequest } from "@/features/referrals/referral-feature-flag.server";
import { SharedAvailabilityInventoryLive } from "@/features/reservation/backend/availability-inventory-cache.server";
import { WorkspaceAvailabilityService } from "@/features/reservation/backend/workspace-availability.service";
import type { AgentTool } from "./agent-tool";
import { checkAvailabilityTool } from "./check-availability.tool";
import { getQuoteTool } from "./get-quote.tool";
import { listOfferingsTool } from "./list-offerings.tool";

/**
 * The services customer tools read through. Availability and office capacity
 * come only from the shared advisory snapshots, never from Dotypos directly.
 */
export const CustomerAgentToolsLive = Layer.mergeAll(
  WorkspaceAvailabilityService.Live,
  SharedAvailabilityInventoryLive,
  CheckoutPricingService.Live.pipe(
    Layer.provideMerge(ReferralFeatureFlagRequest)
  ),
  OfficeReservationFeatureFlagService.Live
);

/** Every tool customers' agents can call, in the order agents see them. */
export const customerAgentTools: ReadonlyArray<
  AgentTool<Layer.Success<typeof CustomerAgentToolsLive>>
> = [listOfferingsTool, checkAvailabilityTool, getQuoteTool];
