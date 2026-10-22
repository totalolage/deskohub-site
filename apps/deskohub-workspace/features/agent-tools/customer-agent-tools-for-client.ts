import type { AgentTool } from "./agent-tool";
import { type AgentToolClient, admitsCheckout } from "./agent-tool-client";
import { startReservationTool } from "./start-reservation.tool";
import { startReservationOnWebsiteTool } from "./start-reservation-on-website.tool";

type WebsiteHandoffServices =
  typeof startReservationOnWebsiteTool extends AgentTool<infer R> ? R : never;

/**
 * The customer tools as the client gets them. Every client sees every tool;
 * where the client's directory admits no checkout, `start_reservation`
 * books nothing and links the prefilled reservation page instead. Tools
 * other than the customer tools are added after this, untouched.
 */
export const getCustomerAgentToolsForClient = <R>({
  client,
  tools,
}: {
  readonly client: AgentToolClient;
  readonly tools: ReadonlyArray<AgentTool<R>>;
}): ReadonlyArray<AgentTool<R | WebsiteHandoffServices>> =>
  admitsCheckout(client)
    ? tools
    : tools.map((tool) =>
        tool.name === startReservationTool.name
          ? startReservationOnWebsiteTool
          : tool
      );
