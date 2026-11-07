import { describe, expect, test } from "bun:test";
import { Option } from "effect";
import { makeFakeCustomerData } from "../../customer-api/testing/customer-data-test-registry";
import {
  bookingAvailabilityAtom,
  bookingOfferingsAtom,
  meetingRoomStartTimesAtom,
} from "../data/booking-queries";
import {
  defaultMeetingRoomDraft,
  type MeetingRoomDraft,
} from "../selection/meeting-room-selection";
import { fakeBooking } from "../testing/fake-booking-api";
import {
  meetingRoomBookingModel,
  meetingRoomQueryOf,
} from "./meeting-room-booking-model";
import { settledValue } from "./testing/settled-value";

const now = new Date();

const setup = async () => {
  const data = makeFakeCustomerData("linked");
  const booking = fakeBooking(data.workspace);
  const catalog = await settledValue(
    data.registry,
    bookingOfferingsAtom("en-US")
  );
  const draft: MeetingRoomDraft = {
    ...defaultMeetingRoomDraft(booking.today(), catalog.offerings),
    date: booking.dateIn(2),
  };
  const startTimes = await settledValue(
    data.registry,
    meetingRoomStartTimesAtom({ date: draft.date, duration: draft.duration })
  );
  return { ...data, booking, draft, startTimes };
};

describe("meetingRoomBookingModel", () => {
  test("an hourly draft takes the earliest free start and continues once its interval is read", async () => {
    const { registry, draft, startTimes } = await setup();
    const query = Option.getOrThrow(
      meetingRoomQueryOf(draft, Option.some(startTimes), now)
    );
    const availability = await settledValue(
      registry,
      bookingAvailabilityAtom({ query })
    );

    const model = meetingRoomBookingModel({
      draft,
      settled: draft,
      now,
      startTimes: Option.some(startTimes),
      availability: Option.some({ query, value: availability }),
    });

    expect(model.draft.startTime).toEqual(
      Option.some(model.enablement.startTimes[0]?.startTime ?? "")
    );
    expect(model.enablement.blockers).toEqual([]);
    expect(Option.isSome(model.selection)).toBe(true);
    expect(model.quotable).toEqual(model.selection);
  });

  test("availability read for an earlier draft doesn't answer a changed one", async () => {
    const { registry, draft, startTimes } = await setup();
    const query = Option.getOrThrow(
      meetingRoomQueryOf(draft, Option.some(startTimes), now)
    );
    const availability = await settledValue(
      registry,
      bookingAvailabilityAtom({ query })
    );
    const later = startTimes.startTimes[1]?.startDateTime.slice(11, 16) ?? "";

    const model = meetingRoomBookingModel({
      draft: { ...draft, startTime: Option.some(later) },
      settled: draft,
      now,
      startTimes: Option.some(startTimes),
      availability: Option.some({ query, value: availability }),
    });

    expect(model.enablement.blockers.map(({ _tag }) => _tag)).toEqual([
      "AvailabilityPending",
    ]);
    // Not quoted until the new start has settled for the debounce.
    expect(model.quotable).toEqual(Option.none());
  });

  test("quotes a changed start once it has settled", async () => {
    const { draft, startTimes } = await setup();
    const later = {
      ...draft,
      startTime: Option.some(
        startTimes.startTimes[1]?.startDateTime.slice(11, 16) ?? ""
      ),
    };

    const model = meetingRoomBookingModel({
      draft: later,
      settled: later,
      now,
      startTimes: Option.some(startTimes),
      availability: Option.none(),
    });

    expect(Option.isSome(model.quotable)).toBe(true);
    expect(model.quotable).toEqual(model.selection);
  });

  test("starts read for another date leave the draft waiting", async () => {
    const { booking, draft, startTimes } = await setup();

    const model = meetingRoomBookingModel({
      draft: { ...draft, date: booking.dateIn(4) },
      settled: draft,
      now,
      startTimes: Option.some(startTimes),
      availability: Option.none(),
    });

    expect(model.draft.startTime).toEqual(Option.none());
    expect(model.enablement.blockers.map(({ _tag }) => _tag)).toEqual([
      "AvailabilityPending",
    ]);
    expect(model.selection).toEqual(Option.none());
    expect(model.quotable).toEqual(Option.none());
  });
});
