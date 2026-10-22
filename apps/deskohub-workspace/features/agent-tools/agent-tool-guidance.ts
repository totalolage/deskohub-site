import { workspaceSiteConstants } from "@/shared/utils/site-constants";

const { brand, location, openingHours } = workspaceSiteConstants;
const { address } = location;

/** What the business is, for agents, from the site constants. */
export const agentToolBusinessSummary = `${brand.name} is a coworking space at ${address.street}, ${address.postalCode} ${address.city}${openingHours.alwaysOpen ? ", open 24/7" : ""}.`;

/**
 * How booking works and what agents can't do. The MCP server instructions
 * and llms.txt both say it.
 */
export const agentToolBookingGuidance = [
  "Bookings are made and paid on the website: give the customer the reservation_url from a result to finish there. Availability and price are confirmed on the website before payment.",
  "With the customer signed in, start_reservation holds a selection for them and returns a pay_url where they accept the terms and pay; get_reservation_status and list_my_reservations show their own reservations. The tools can't pay, cancel, or change a reservation.",
] as const;
