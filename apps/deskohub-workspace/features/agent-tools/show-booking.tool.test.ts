import "@/shared/testing/workspace-test-env";
import { describe, expect, test } from "bun:test";
import { Effect, type Schema } from "effect";
import type { ShowBookingResult } from "./show-booking.schema";

const { makeAgentToolTestServices } = await import("./agent-tools.test-utils");
const { CallableAgentTools } = await import("./agent-tool");
const { listOfferingsTool } = await import("./list-offerings.tool");
const { makeShowBookingTool } = await import("./show-booking.tool");

const showBooking = (
  args: Schema.Json,
  callable: ReadonlyArray<string> = ["show_booking"],
  admitsCheckout = true
) =>
  makeShowBookingTool({ admitsCheckout })
    .call(args)
    .pipe(
      Effect.provideService(CallableAgentTools, new Set(callable)),
      Effect.provide(makeAgentToolTestServices().layer),
      Effect.runPromise
    ) as Promise<ShowBookingResult>;

describe("show_booking", () => {
  test("lets the view start a booking when the caller may call start_reservation", async () => {
    const result = await showBooking({}, ["show_booking", "start_reservation"]);

    expect(result.booking_mode).toBe("reserve");
  });

  test("hands off to the reservation page when start_reservation isn't callable", async () => {
    const result = await showBooking({}, ["show_booking", "get_quote"]);

    expect(result.booking_mode).toBe("reservation_page");
  });

  test("hands off to the reservation page where the client's directory admits no checkout, even when start_reservation is callable", async () => {
    const result = await showBooking(
      {},
      ["show_booking", "start_reservation"],
      false
    );

    expect(result.booking_mode).toBe("reservation_page");
  });

  test("lists the offerings list_offerings lists, in the requested locale", async () => {
    const [booking, listing] = await Promise.all([
      showBooking({ locale: "cs-CZ" }),
      listOfferingsTool
        .call({ locale: "cs-CZ" })
        .pipe(
          Effect.provide(makeAgentToolTestServices().layer),
          Effect.runPromise
        ),
    ]);

    expect(booking.locale).toBe("cs-CZ");
    expect({
      advertised_on: booking.advertised_on,
      offerings: booking.offerings,
    }).toEqual({
      advertised_on: listing.advertised_on,
      offerings: listing.offerings,
    });
  });

  test("echoes the prefilled choices without the locale", async () => {
    const result = await showBooking({
      family: "meeting-room",
      date: "2099-07-30",
      duration: "hour:4",
      start_time: "09:00",
      locale: "en-US",
    });

    expect(result.selection).toEqual({
      family: "meeting-room",
      date: "2099-07-30",
      duration: "hour:4",
      start_time: "09:00",
    });
  });

  test("rejects a malformed prefill as invalid input", async () => {
    await expect(showBooking({ date: "30.7.2099" })).rejects.toMatchObject({
      details: { code: "invalid_input", field: "date" },
    });
  });
});
