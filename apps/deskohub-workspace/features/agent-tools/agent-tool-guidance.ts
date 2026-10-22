import { workspaceSiteConstants } from "@/shared/utils/site-constants";
import type { AgentTool } from "./agent-tool";

const { brand, location, openingHours } = workspaceSiteConstants;
const { address } = location;

/** What the business is, for agents, from the site constants. */
export const agentToolBusinessSummary = `${brand.name} is a coworking space at ${address.street}, ${address.postalCode} ${address.city}${openingHours.alwaysOpen ? ", open 24/7" : ""}.`;

/**
 * How booking works and what agents can't do, for a client and the customer
 * tools it sees. Where the client's directory admits no checkout, nothing
 * mentions paying. Each sentence about a customer tool appears only when the
 * client sees that tool.
 */
export const getAgentToolBookingGuidance = ({
  admitsCheckout,
  startReservation,
  readsReservations,
}: {
  readonly admitsCheckout: boolean;
  /** `start_reservation` as the client sees it, if it does. */
  readonly startReservation: Pick<AgentTool<unknown>, "readOnly"> | undefined;
  /** Whether the client sees the signed-in reservation reads. */
  readonly readsReservations: boolean;
}): ReadonlyArray<string> => [
  admitsCheckout
    ? "Bookings are made and paid on the website: give the customer the reservation_url from a result to finish there. Availability and price are confirmed on the website before payment."
    : "Customers book on the website, which confirms availability and the price: give the customer the reservation_url from a result to finish there.",
  ...(startReservation === undefined
    ? []
    : [
        startReservation.readOnly
          ? "start_reservation returns the reservation page for a complete selection, filled in, where the customer finishes the booking; it books nothing itself."
          : "With the customer signed in, start_reservation holds a selection for them and returns a pay_url where they accept the terms and pay.",
      ]),
  ...(readsReservations
    ? [
        "With the customer signed in, get_reservation_status and list_my_reservations show their own reservations.",
        admitsCheckout
          ? "The customer tools can't pay for, cancel, or change a reservation."
          : "The customer tools can't cancel or change a reservation.",
      ]
    : []),
];

/**
 * The booking guidance llms.txt gives: what the MCP server tells a client
 * whose directory admits checkout and that sees every published customer
 * tool.
 */
export const agentToolBookingGuidance = getAgentToolBookingGuidance({
  admitsCheckout: true,
  startReservation: { readOnly: false },
  readsReservations: true,
});
