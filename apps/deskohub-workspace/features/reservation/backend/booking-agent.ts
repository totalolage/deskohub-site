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
 * The most live holds customer agents may keep open for one account at a
 * time. Each agent client keeps at most one hold per checkout session, which
 * the next selection supersedes, so the limit only bites when several
 * connected assistants, or one whose session rotated past a paid order, hold
 * tables at once. Three leaves room for comparing a few options while one
 * account can't block the single meeting room, the office, and the desks
 * together.
 */
export const agentHoldLimit = 3;

/** An agent booking would exceed the account's {@link agentHoldLimit}. */
export class AgentHoldLimitError extends Data.TaggedError(
  "AgentHoldLimitError"
)<{ readonly liveHolds: number }> {}

/**
 * An agent booked for an account without a bookable profile. The customer
 * completes the profile on the site; an agent never writes it.
 */
export class AgentBookingProfileRequiredError extends Data.TaggedError(
  "AgentBookingProfileRequiredError"
)<Record<string, never>> {}
