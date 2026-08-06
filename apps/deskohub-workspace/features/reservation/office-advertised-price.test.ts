import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import { plainDateStringSchema } from "@/shared/utils/temporal";
import { getOfficeAdditionalSeatAdvertisedPriceRequests } from "./office-advertised-price";

const decodePlainDate = Schema.decodeUnknownSync(plainDateStringSchema);

describe("getOfficeAdditionalSeatAdvertisedPriceRequests", () => {
  test("builds one request per valid additional-seat count", () => {
    const requests = getOfficeAdditionalSeatAdvertisedPriceRequests({
      seatCapacity: 4,
      locale: "en-US",
      startsOn: decodePlainDate("2099-06-10"),
      endsOn: decodePlainDate("2099-06-12"),
    });

    expect(requests.map(({ additionalGuests }) => additionalGuests)).toEqual([
      0, 1, 2, 3,
    ]);
    expect(requests[3]?.request.reservation.details).toEqual({
      kind: "office",
      startsOn: "2099-06-10",
      endsOn: "2099-06-12",
      additionalGuests: 3,
    });
  });
});
