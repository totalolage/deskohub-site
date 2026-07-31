import { describe, expect, test } from "bun:test";
import "@/shared/polyfills/temporal";
import { getMeetingRoomDurationAdvertisedPriceRequests } from "./meeting-room-advertised-price";

describe("meeting-room advertised prices", () => {
  test("quotes whole-day pricing for the earliest selectable calendar day", () => {
    const input = {
      locale: "en-US",
      startDateTime: "2099-07-30T10:00",
      minimumStartDateTime: "2099-07-30T15:00",
    } as const;
    const requests = getMeetingRoomDurationAdvertisedPriceRequests(input);
    const wholeDayRequest = requests.find(({ duration }) => duration === 1440);

    expect(wholeDayRequest?.request.reservation.details).toMatchObject({
      startsAt: "2099-07-30T22:00:00Z",
      endsAt: "2099-07-31T22:00:00Z",
    });
  });

  test("quotes hourly cards for the selectable value retained by whole-day mode", () => {
    const requests = getMeetingRoomDurationAdvertisedPriceRequests({
      locale: "en-US",
      startDateTime: "2099-07-31T00:00",
      minimumStartDateTime: "2099-07-30T15:00",
      selectableStartDateTime: "2099-07-30T16:00",
    });
    const hourlyRequest = requests.find(({ duration }) => duration === 60);

    expect(hourlyRequest?.request.reservation.details).toMatchObject({
      startsAt: "2099-07-30T14:00:00Z",
      endsAt: "2099-07-30T15:00:00Z",
    });
  });
});
