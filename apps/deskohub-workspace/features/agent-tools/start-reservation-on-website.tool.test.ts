import "@/shared/testing/workspace-test-env";
import { describe, expect, mock, test } from "bun:test";
import { Effect, type Schema } from "effect";
import type { PreparePayStateInput } from "@/features/reservation/actions/prepare-pay-state.schema";
import type { GetQuoteResult } from "./get-quote.schema";

/** Every call of the booking operation, which must never run here. */
const bookingCalls: PreparePayStateInput[] = [];
const preparePayStateModule = await import(
  "@/features/reservation/actions/prepare-pay-state"
);
mock.module("@/features/reservation/actions/prepare-pay-state", () => ({
  ...preparePayStateModule,
  prepareWorkspacePayState: (input: PreparePayStateInput) =>
    Effect.sync(() => bookingCalls.push(input)).pipe(
      Effect.andThen(Effect.die(new Error("Booked a reservation")))
    ),
}));

const { makeAgentToolTestServices, workspaceDateFromToday } = await import(
  "./agent-tools.test-utils"
);
const { getQuoteTool } = await import("./get-quote.tool");
const { startReservationOnWebsiteTool } = await import(
  "./start-reservation-on-website.tool"
);

const run = <A>(
  effect: Effect.Effect<A, unknown, never>,
  services: ReturnType<typeof makeAgentToolTestServices>
) => effect.pipe(Effect.provide(services.layer), Effect.runPromise);

describe("start_reservation on the website", () => {
  test.each([
    {
      family: "cowork",
      date: workspaceDateFromToday(2),
      tier: "open-space",
      coffee: true,
    },
    {
      family: "office",
      date: workspaceDateFromToday(3),
      end_date: workspaceDateFromToday(4),
      seats: 2,
    },
  ])(
    "links the reservation page get_quote links for $family, booking nothing",
    async (args: Schema.JsonObject) => {
      const services = makeAgentToolTestServices();

      const [result, quote] = await Promise.all([
        run(startReservationOnWebsiteTool.call(args), services),
        run(getQuoteTool.call(args), services) as Promise<GetQuoteResult>,
      ]);

      expect(result).toMatchObject({
        family: args["family"],
        reservation_url: quote.reservation_url,
      });
      expect(bookingCalls).toEqual([]);
      expect(services.dotyposRequests).toEqual([]);
    }
  );

  test("refuses a selection get_quote refuses", async () => {
    const args = {
      family: "cowork",
      date: workspaceDateFromToday(2),
    } satisfies Schema.JsonObject;
    const services = makeAgentToolTestServices();
    const failure = (tool: typeof getQuoteTool) =>
      run(tool.call(args).pipe(Effect.flip), services);

    const [refusal, quoteRefusal] = await Promise.all([
      failure(startReservationOnWebsiteTool),
      failure(getQuoteTool),
    ]);

    expect(refusal.details).toEqual(quoteRefusal.details);
    expect(bookingCalls).toEqual([]);
  });
});
