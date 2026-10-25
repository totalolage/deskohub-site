import type { Layer } from "effect";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";
import type { DescribedAgentTool } from "./agent-interfaces-markdown";
import type { AgentTool, CallableAgentTools } from "./agent-tool";
import type { AgentToolClient } from "./agent-tool-client";
import { checkAvailabilityTool } from "./check-availability.tool";
import type { SignedInAgentToolRequirements } from "./customer-agent-caller";
import type { CustomerAgentToolsLive } from "./customer-agent-tools";
import { getQuoteTool } from "./get-quote.tool";
import { getReservationStatusTool } from "./get-reservation-status.tool";
import { listMyReservationsTool } from "./list-my-reservations.tool";
import { listOfferingsTool } from "./list-offerings.tool";
import { makeShowBookingTool } from "./show-booking.tool";
import { startReservationTool } from "./start-reservation.tool";
import { startReservationOnWebsiteTool } from "./start-reservation-on-website.tool";

type CustomerAgentTool = AgentTool<
  | Layer.Success<typeof CustomerAgentToolsLive>
  | SignedInAgentToolRequirements
  | CallableAgentTools
>;

/**
 * What one client is served: its customer tools in order, and the
 * instructions for them.
 */
interface CustomerAgentListing {
  readonly tools: ReadonlyArray<CustomerAgentTool>;
  readonly instructions: string;
}

/**
 * Whether the client's directory admits links that start a checkout and
 * copy about paying. ChatGPT's admits commerce only for physical goods, so
 * its customers finish on the prefilled reservation page instead.
 */
const admitsCheckout = (client: AgentToolClient) => client !== "chatgpt";

/**
 * The customer tools, in the order agents see them. Every client sees every
 * tool; where the client's directory admits no checkout, `start_reservation`
 * books nothing and links the prefilled reservation page instead, and the
 * booking view never starts a booking.
 */
const listCustomerAgentTools = (
  checkout: boolean
): ReadonlyArray<CustomerAgentTool> => [
  listOfferingsTool,
  checkAvailabilityTool,
  getQuoteTool,
  makeShowBookingTool({ admitsCheckout: checkout }),
  checkout ? startReservationTool : startReservationOnWebsiteTool,
  getReservationStatusTool,
  listMyReservationsTool,
];

const { brand, location, openingHours } = workspaceSiteConstants;
const { address } = location;

/** What the business is, for agents, from the site constants. */
const businessSummary = `${brand.name} is a coworking space at ${address.street}, ${address.postalCode} ${address.city}${openingHours.alwaysOpen ? ", open 24/7" : ""}.`;

/** Whether the listing holds a tool of each of these names. */
const listsEvery = (
  tools: ReadonlyArray<CustomerAgentTool>,
  names: ReadonlyArray<string>
) => names.every((name) => tools.some((tool) => tool.name === name));

/**
 * How booking works and what agents can't do, for the tools a client sees.
 * Where the client's directory admits no checkout, nothing mentions paying.
 * Each sentence about a customer tool appears only when the client sees
 * that tool.
 */
const getBookingGuidance = (
  checkout: boolean,
  tools: ReadonlyArray<CustomerAgentTool>
): ReadonlyArray<string> => {
  const startReservation = tools.find(
    ({ name }) => name === startReservationTool.name
  );
  const readsReservations = listsEvery(tools, [
    getReservationStatusTool.name,
    listMyReservationsTool.name,
  ]);

  return [
    checkout
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
          checkout
            ? "The customer tools can't pay for, cancel, or change a reservation."
            : "The customer tools can't cancel or change a reservation.",
        ]
      : []),
  ];
};

/**
 * The server instructions for the tools a client sees. The products come
 * from list_offerings, so the instructions don't repeat the catalog.
 */
const getServerInstructions = (
  checkout: boolean,
  tools: ReadonlyArray<CustomerAgentTool>
) =>
  [
    businessSummary,
    ...(listsEvery(tools, [
      listOfferingsTool.name,
      checkAvailabilityTool.name,
      getQuoteTool.name,
    ])
      ? [
          "Use list_offerings for the products on offer with their regular price and today's price including any public sale, check_availability to see whether a selection looks free, and get_quote for the exact price of a selection.",
        ]
      : []),
    ...getBookingGuidance(checkout, tools),
  ].join(" ");

const makeListing = (checkout: boolean): CustomerAgentListing => {
  const tools = listCustomerAgentTools(checkout);
  return { tools, instructions: getServerInstructions(checkout, tools) };
};

const checkoutListing = makeListing(true);
const websiteHandoffListing = makeListing(false);

/**
 * What the customer MCP server (`/api/mcp`) serves each client, and what
 * llms.txt describes: the public tools to anyone, the signed-in tools,
 * including starting a booking, to agents with an OAuth access token, and
 * the server instructions for them. Tools served beside the customer tools,
 * such as administration tools, are added after these, untouched.
 */
export const customerAgentCatalog: {
  /** What one client is served. */
  readonly forClient: (client: AgentToolClient) => CustomerAgentListing;
  /**
   * What llms.txt describes: the tools as a client whose directory admits
   * checkout sees them, and the booking guidance that client is given.
   */
  readonly published: {
    readonly tools: ReadonlyArray<DescribedAgentTool>;
    readonly guidance: string;
  };
} = {
  forClient: (client) =>
    admitsCheckout(client) ? checkoutListing : websiteHandoffListing,
  published: {
    tools: checkoutListing.tools,
    guidance: getBookingGuidance(true, checkoutListing.tools).join(" "),
  },
};
