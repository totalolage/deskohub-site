import { Layer } from "effect";
import { CustomerReservationHistoryService } from "@/features/account";
import { CheckoutPricingService } from "@/features/checkout/backend/checkout/checkout-pricing.service";
import { CheckoutStatusService } from "@/features/checkout/backend/checkout/checkout-status.service";
import { OfficeReservationFeatureFlagService } from "@/features/office/backend/office-reservation-feature-flag.service";
import { ReferralFeatureFlagRequest } from "@/features/referrals/referral-feature-flag.server";
import { SharedAvailabilityInventoryLive } from "@/features/reservation/backend/availability-inventory-cache.server";
import { payStatePreparationServices } from "@/features/reservation/backend/pay-state-preparation-services";
import { SharedReservationRecordsLive } from "@/features/reservation/backend/reservation-records-cache.server";
import { WorkspaceAvailabilityService } from "@/features/reservation/backend/workspace-availability.service";
import { WorkspaceReservationRepository } from "@/features/reservation/backend/workspace-reservation.repository";
import { ReviewSandbox } from "@/features/review-accounts";
import {
  type AgentTool,
  type AgentToolExposure,
  type CallableAgentTools,
  selectAgentTools,
} from "./agent-tool";
import type { CurrentAgentToolClient } from "./agent-tool-client";
import { checkAvailabilityTool } from "./check-availability.tool";
import type { SignedInAgentToolRequirements } from "./customer-agent-caller";
import { getQuoteTool } from "./get-quote.tool";
import { getReservationStatusTool } from "./get-reservation-status.tool";
import { listMyReservationsTool } from "./list-my-reservations.tool";
import { listOfferingsTool } from "./list-offerings.tool";
import { showBookingTool } from "./show-booking.tool";
import { startReservationTool } from "./start-reservation.tool";

/**
 * The services customer tools read through. Public tools read availability
 * and office capacity only from the shared advisory snapshots, never from
 * Dotypos directly. Signed-in tools book live and read the customer's own
 * reservations from the shared reservation records, which protects the
 * Dotypos quota bookings share; browser pages read those live.
 */
export const CustomerAgentToolsLive = Layer.mergeAll(
  WorkspaceAvailabilityService.Live,
  SharedAvailabilityInventoryLive,
  CheckoutPricingService.Live.pipe(
    Layer.provideMerge(ReferralFeatureFlagRequest)
  ),
  OfficeReservationFeatureFlagService.Live,
  payStatePreparationServices,
  WorkspaceReservationRepository.Live,
  CheckoutStatusService.withRecords(SharedReservationRecordsLive),
  CustomerReservationHistoryService.withRecords(SharedReservationRecordsLive),
  ReviewSandbox.Live
);

/** Every tool customers' agents can call, in the order agents see them. */
const customerAgentTools: ReadonlyArray<
  AgentTool<
    | Layer.Success<typeof CustomerAgentToolsLive>
    | SignedInAgentToolRequirements
    | CallableAgentTools
    | CurrentAgentToolClient
  >
> = [
  listOfferingsTool,
  checkAvailabilityTool,
  getQuoteTool,
  showBookingTool,
  startReservationTool,
  getReservationStatusTool,
  listMyReservationsTool,
];

/**
 * The customer MCP server (`/api/mcp`) serves the public tools to anyone and
 * the signed-in tools, including starting a booking, to agents with an OAuth
 * access token.
 */
const customerToolExposure: AgentToolExposure = {
  access: ["public", "signed-in"],
  transactional: true,
};

/** The tools the customer MCP server publishes, as llms.txt describes them. */
export const publishedCustomerAgentTools = selectAgentTools(
  customerAgentTools,
  customerToolExposure
);
