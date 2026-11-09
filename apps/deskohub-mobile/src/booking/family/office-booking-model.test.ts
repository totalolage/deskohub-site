import { describe, expect, test } from "bun:test";
import { Option } from "effect";
import { makeFakeCustomerData } from "../../customer-api/testing/customer-data-test-registry";
import {
  bookingAvailabilityAtom,
  bookingOfferingsAtom,
} from "../data/booking-queries";
import {
  defaultOfficeDraft,
  officeAvailabilityQuery,
} from "../selection/office-selection";
import { fakeBooking } from "../testing/fake-booking-api";
import { officeBookingModel, officeOfferingOf } from "./office-booking-model";
import { settledValue } from "./testing/settled-value";

const now = new Date();

const setup = async () => {
  const data = makeFakeCustomerData("linked");
  const booking = fakeBooking(data.workspace);
  const catalog = await settledValue(
    data.registry,
    bookingOfferingsAtom("en-US")
  );
  const offering = Option.getOrThrow(officeOfferingOf(catalog.offerings));
  const availability = await settledValue(
    data.registry,
    bookingAvailabilityAtom({
      query: officeAvailabilityQuery(booking.today()),
    })
  );
  const model = (draft: ReturnType<typeof defaultOfficeDraft>) =>
    officeBookingModel({
      draft,
      now,
      offering,
      availability: Option.some(availability),
    });
  return { booking, offering, model };
};

describe("officeBookingModel", () => {
  test("a free day with one seat continues", async () => {
    const { booking, model } = await setup();

    const office = model({
      ...defaultOfficeDraft(booking.today()),
      date: booking.dateIn(1),
    });

    expect(office.enablement.blockers).toEqual([]);
    expect(office.quotable).toEqual(Option.some(office.selection));
  });

  test("days and seats are kept within what the first day and the office allow", async () => {
    const { booking, offering, model } = await setup();
    // The fake's first unavailable date is three days ahead.
    const office = model({
      date: booking.dateIn(1),
      dayCount: 30,
      seats: 1_000,
    });

    expect(office.draft.dayCount).toBe(office.enablement.maximumDayCount);
    expect(office.enablement.maximumDayCount).toBe(2);
    expect(office.draft.seats).toBe(offering.maximumSeats ?? 1_000);
    expect(office.enablement.blockers).toEqual([]);
  });

  test("a taken first day can't continue and isn't quoted", async () => {
    const { booking, model } = await setup();

    const office = model({
      ...defaultOfficeDraft(booking.today()),
      date: booking.unavailableDates[0] ?? "",
    });

    expect(office.enablement.blockers.map(({ _tag }) => _tag)).toContain(
      "DateUnavailable"
    );
    expect(office.quotable).toEqual(Option.none());
  });
});
