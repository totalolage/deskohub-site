import { Context, Data } from "effect";
import type { CustomerAgentClientId } from "@/features/account";

/**
 * The customer's AI agent a booking is made through. Only the customer MCP
 * server provides it, after verifying the agent's OAuth access token, so the
 * browser Server Action can never claim an agent or its consent channel.
 */
export class BookingAgent extends Context.Service<
  BookingAgent,
  { readonly clientId: CustomerAgentClientId }
>()("@deskohub-workspace/reservation/BookingAgent") {}

/**
 * An agent booked for an account without a bookable profile. The customer
 * completes the profile on the site; an agent never writes it.
 */
export class AgentBookingProfileRequiredError extends Data.TaggedError(
  "AgentBookingProfileRequiredError"
)<Record<string, never>> {}
