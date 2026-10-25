import "@/shared/testing/workspace-test-env";
import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import type { ShowBookingResult } from "./show-booking.schema";

const { customerAgentCatalog } = await import("./customer-agent-catalog");
const { CallableAgentTools } = await import("./agent-tool");
const { makeAgentToolTestServices } = await import("./agent-tools.test-utils");
const { startReservationTool } = await import("./start-reservation.tool");
const { startReservationOnWebsiteTool } = await import(
  "./start-reservation-on-website.tool"
);

const clients = ["chatgpt", "claude", "other"] as const;

const toNames = (tools: ReadonlyArray<{ readonly name: string }>) =>
  tools.map(({ name }) => name);

/** Every tool name the catalog lists to any client. */
const customerToolNames = new Set(
  clients.flatMap((client) =>
    toNames(customerAgentCatalog.forClient(client).tools)
  )
);

type ListedTool = ReturnType<
  typeof customerAgentCatalog.forClient
>["tools"][number];

/** What a directory reviews of a tool, without its implementation. */
const toListedCopy = ({
  name,
  title,
  description,
  access,
  readOnly,
  view,
}: ListedTool) => ({ name, title, description, access, readOnly, view });

describe("customerAgentCatalog", () => {
  test.each(clients)("gives %s every customer tool, in order", (client) => {
    expect(toNames(customerAgentCatalog.forClient(client).tools)).toEqual([
      "list_offerings",
      "check_availability",
      "get_quote",
      "show_booking",
      "start_reservation",
      "get_reservation_status",
      "list_my_reservations",
    ]);
  });

  test("lists no administration tool to any client or in llms.txt", () => {
    for (const tool of [
      ...clients.flatMap(
        (client) => customerAgentCatalog.forClient(client).tools
      ),
      ...customerAgentCatalog.published.tools,
    ]) {
      expect(tool.access).not.toBe("administration");
      expect(tool.name.startsWith("admin_")).toBe(false);
    }
  });

  test.each(["claude", "other"] as const)(
    "gives %s the published tools, with the start_reservation that books",
    (client) => {
      const { tools } = customerAgentCatalog.forClient(client);

      expect(tools).toEqual([...customerAgentCatalog.published.tools]);
      expect(tools).toContain(startReservationTool);
    }
  );

  test("gives ChatGPT a start_reservation that books nothing and needs no sign-in", () => {
    const { tools } = customerAgentCatalog.forClient("chatgpt");
    const checkoutTools = customerAgentCatalog.forClient("other").tools;
    const startReservation = tools.find(
      ({ name }) => name === "start_reservation"
    );

    expect(startReservation).toBe(startReservationOnWebsiteTool);
    expect(startReservation).toMatchObject({
      access: "public",
      readOnly: true,
    });
    expect(startReservation?.destructive ?? false).toBe(false);
    // Only start_reservation is listed differently; the signed-in reads stay.
    expect(
      tools
        .filter(
          (tool, index) =>
            !Bun.deepEquals(
              toListedCopy(tool),
              checkoutTools[index] && toListedCopy(checkoutTools[index])
            )
        )
        .map(({ name }) => name)
    ).toEqual(["start_reservation"]);
  });

  test.each(clients)(
    "names a customer tool in %s's instructions only when it lists the tool",
    (client) => {
      const { tools, instructions } = customerAgentCatalog.forClient(client);
      const named = [...customerToolNames].filter((name) =>
        new RegExp(`\\b${name}\\b`).test(instructions)
      );

      expect(named.length).toBeGreaterThan(0);
      expect(toNames(tools)).toEqual(expect.arrayContaining(named));
    }
  );

  test("gives llms.txt the guidance a client admitting checkout is given", () => {
    const { guidance } = customerAgentCatalog.published;

    expect(guidance).not.toBe("");
    for (const client of ["claude", "other"] as const) {
      expect(customerAgentCatalog.forClient(client).instructions).toContain(
        guidance
      );
    }
    expect(
      customerAgentCatalog.forClient("chatgpt").instructions
    ).not.toContain(guidance);
  });

  test.each([
    ["chatgpt", "reservation_page"],
    ["claude", "reserve"],
    ["other", "reserve"],
  ] as const)(
    "lets %s's booking view, for a caller who may start a booking, finish as %s",
    async (client, mode) => {
      const showBooking = customerAgentCatalog
        .forClient(client)
        .tools.find(({ name }) => name === "show_booking");
      if (showBooking === undefined) throw new Error("No show_booking");
      const result = (await showBooking.call({}).pipe(
        Effect.provideService(
          CallableAgentTools,
          new Set(["show_booking", "start_reservation"])
        ),
        Effect.provide(makeAgentToolTestServices().layer),
        // show_booking reads only the public services the test layer has.
        (effect) => Effect.runPromise(effect as Effect.Effect<unknown>)
      )) as ShowBookingResult;

      expect(result.booking_mode).toBe(mode);
    }
  );
});
