import "@/shared/testing/workspace-test-env";
import { describe, expect, test } from "bun:test";

const { publishedCustomerAgentTools } = await import("./customer-agent-tools");
const { getCustomerAgentToolsForClient } = await import(
  "./customer-agent-tools-for-client"
);
const { startReservationTool } = await import("./start-reservation.tool");
const { startReservationOnWebsiteTool } = await import(
  "./start-reservation-on-website.tool"
);

const toolsFor = (client: "chatgpt" | "claude" | "other") =>
  getCustomerAgentToolsForClient({
    client,
    tools: publishedCustomerAgentTools,
  });

describe("getCustomerAgentToolsForClient", () => {
  test.each(["chatgpt", "claude", "other"] as const)(
    "gives %s every customer tool, in order",
    (client) => {
      expect(toolsFor(client).map(({ name }) => name)).toEqual([
        "list_offerings",
        "check_availability",
        "get_quote",
        "show_booking",
        "start_reservation",
        "get_reservation_status",
        "list_my_reservations",
      ]);
    }
  );

  test.each(["claude", "other"] as const)(
    "gives %s the tools unchanged",
    (client) => {
      expect(toolsFor(client)).toEqual(publishedCustomerAgentTools);
      expect(toolsFor(client)).toContain(startReservationTool);
    }
  );

  test("gives ChatGPT a start_reservation that books nothing and needs no sign-in", () => {
    const tools = toolsFor("chatgpt");
    const startReservation = tools.find(
      ({ name }) => name === "start_reservation"
    );

    expect(startReservation).toBe(startReservationOnWebsiteTool);
    expect(startReservation).toMatchObject({
      access: "public",
      readOnly: true,
    });
    expect(startReservation?.destructive ?? false).toBe(false);
    // Only start_reservation changes; the signed-in reads stay.
    expect(
      tools.filter((tool, index) => tool !== publishedCustomerAgentTools[index])
    ).toEqual([startReservationOnWebsiteTool]);
  });
});
