import { Effect } from "effect";
import {
  classifyVerifiedBot,
  type VerifiedBot,
} from "@/shared/agent-traffic/agent-traffic";
import { scheduleAgentTrafficEvent } from "@/shared/backend/agent-traffic/agent-traffic-events";
import { CurrentAgentTraffic } from "@/shared/backend/workspace-request-context";
import { currentInstant } from "@/shared/utils/temporal";

/** Every place that screens a request with BotID. */
export type BotProtectionCallSite =
  | "account.sign-in"
  | "accounting.manage-post-order-invoice"
  | "checkout.apply-discount-code"
  | "contact.submit"
  | "reservation.prepare-pay-state"
  | "reservation.submit";

interface BotRejectionVerdict extends VerifiedBot {
  readonly isVerifiedBot: boolean;
}

/**
 * Counts a BotID rejection per call site after the response is sent. A
 * verified bot is classified by its BotID name and category; any other bot by
 * the request's own agent category.
 */
export const recordBotProtectionRejection = Effect.fn(
  "BotProtectionService.recordRejection"
)(function* (callSite: BotProtectionCallSite, verdict: BotRejectionVerdict) {
  const traffic = verdict.isVerifiedBot
    ? classifyVerifiedBot(verdict)
    : yield* CurrentAgentTraffic;
  yield* scheduleAgentTrafficEvent({
    event: "bot protection rejection",
    traffic,
    properties: {
      call_site: callSite,
      verified_bot: verdict.isVerifiedBot,
    },
    timestamp: yield* currentInstant,
  });
});
