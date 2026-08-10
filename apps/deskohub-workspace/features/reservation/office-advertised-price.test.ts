import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import { plainDateStringSchema } from "@/shared/utils/temporal";
import { getOfficeSeatAdvertisedPriceRequests } from "./office-advertised-price";

const decodePlainDate = Schema.decodeUnknownSync(plainDateStringSchema);

describe("getOfficeSeatAdvertisedPriceRequests", () => {
  test("builds one request per valid total-seat count", () => {
    const requests = getOfficeSeatAdvertisedPriceRequests({
      seatCapacity: 4,
      locale: "en-US",
      startsOn: decodePlainDate("2099-06-10"),
      endsOn: decodePlainDate("2099-06-12"),
    });

    expect(
      requests.map(({ reservation }) => reservation.details.seats)
    ).toEqual([1, 2, 3, 4]);
    expect(requests[3]?.reservation.details).toEqual({
      kind: "office",
      startsOn: "2099-06-10",
      endsOn: "2099-06-12",
      seats: 4,
    });
  });
});
