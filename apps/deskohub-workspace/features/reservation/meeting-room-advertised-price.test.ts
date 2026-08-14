import { describe, expect, test } from "bun:test";
import "@/shared/polyfills/temporal";
import { getMeetingRoomDurationAdvertisedPriceRequests } from "./meeting-room-advertised-price";

describe("meeting-room advertised prices", () => {
  test("quotes every product for the selected calendar date", () => {
    const requests = getMeetingRoomDurationAdvertisedPriceRequests({
      locale: "en-US",
      startDateTime: "2099-07-30T10:00",
    });

    expect(requests.every((request) => !("submittedCode" in request))).toBe(
      true
    );
    expect(requests.map(({ reservation }) => reservation.details)).toEqual([
      {
        kind: "meeting-room",
        duration: { unit: "hour", amount: 1 },
        reservationDate: "2099-07-30",
      },
      {
        kind: "meeting-room",
        duration: { unit: "hour", amount: 4 },
        reservationDate: "2099-07-30",
      },
      {
        kind: "meeting-room",
        duration: { unit: "day", amount: 1 },
        reservationDate: "2099-07-30",
      },
    ]);
  });

  test("does not bind advertised price to an hourly clock value", () => {
    const morning = getMeetingRoomDurationAdvertisedPriceRequests({
      locale: "en-US",
      startDateTime: "2099-07-30T10:00",
    });
    const afternoon = getMeetingRoomDurationAdvertisedPriceRequests({
      locale: "en-US",
      startDateTime: "2099-07-30T16:00",
    });

    expect(afternoon).toEqual(morning);
  });

  test("returns no request for incomplete or invalid form state", () => {
    expect(
      getMeetingRoomDurationAdvertisedPriceRequests({
        locale: "en-US",
        startDateTime: "",
      })
    ).toEqual([]);
  });
});
