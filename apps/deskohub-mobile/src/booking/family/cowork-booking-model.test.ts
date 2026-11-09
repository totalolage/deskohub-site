import { describe, expect, test } from "bun:test";
import { Option } from "effect";
import type { AtomRegistry } from "effect/unstable/reactivity";
import { makeFakeCustomerData } from "../../customer-api/testing/customer-data-test-registry";
import {
  bookingAvailabilityAtom,
  bookingOfferingsAtom,
  bookingQuoteAtom,
} from "../data/booking-queries";
import {
  type CoworkDraft,
  coworkAvailabilityQueries,
  defaultCoworkDraft,
  selectCoworkTier,
} from "../selection/cowork-selection";
import { pragueToday } from "../selection/prague-date";
import { fakeBooking } from "../testing/fake-booking-api";
import { checkoutRequestOf } from "./booking-family-view";
import { coworkBookingModel } from "./cowork-booking-model";
import { settledValue } from "./testing/settled-value";

const now = new Date();

/** The model once every availability read of the draft has settled. */
const settledModel = async (
  registry: AtomRegistry.AtomRegistry,
  draft: CoworkDraft
) => {
  const catalog = await settledValue(registry, bookingOfferingsAtom("en-US"));
  const queries = coworkAvailabilityQueries(draft, pragueToday(now));
  const read = (query: (typeof queries)["range"]) =>
    settledValue(registry, bookingAvailabilityAtom({ query }));
  const availability = {
    range: Option.some(await read(queries.range)),
    selection: Option.some(await read(queries.selection)),
    workstationRequirement: Option.isSome(queries.workstationRequirement)
      ? Option.some(await read(queries.workstationRequirement.value))
      : Option.none(),
  };
  return coworkBookingModel({
    draft,
    now,
    offerings: catalog.offerings,
    availability,
  });
};

const setup = async () => {
  const data = makeFakeCustomerData("linked");
  const booking = fakeBooking(data.workspace);
  const catalog = await settledValue(
    data.registry,
    bookingOfferingsAtom("en-US")
  );
  // Tomorrow, so the same-day Open Space cutoff never applies.
  const draft = {
    ...defaultCoworkDraft(booking.today(), catalog.offerings),
    date: booking.dateIn(1),
  };
  return { ...data, booking, draft };
};

describe("coworkBookingModel", () => {
  test("an available day continues to checkout with its quote", async () => {
    const { registry, draft } = await setup();

    const model = await settledModel(registry, draft);
    const quote = await settledValue(
      registry,
      bookingQuoteAtom(Option.getOrThrow(model.quotable), "en-US")
    );

    expect(model.enablement.blockers).toEqual([]);
    expect(
      checkoutRequestOf({
        locale: "en-US",
        selection: Option.some(model.selection),
        blockers: model.enablement.blockers,
        quote: Option.some(quote),
      })
    ).toEqual(
      Option.some({
        locale: "en-US",
        selection: model.selection,
        advertisedPriceToken: quote.advertisedPriceToken,
      })
    );
  });

  test("a day nothing can be booked on is shown taken and isn't quoted", async () => {
    const { registry, booking, draft } = await setup();
    const taken = booking.unavailableDates[0] ?? "";

    const model = await settledModel(registry, { ...draft, date: taken });

    expect(model.enablement.dates.unavailable.has(taken)).toBe(true);
    expect(model.enablement.blockers.map(({ _tag }) => _tag)).toContain(
      "OfferUnavailable"
    );
    expect(model.quotable).toEqual(Option.none());
  });

  test("a Reserved Desk day without bare desks gets a free workstation, then reads its availability", async () => {
    const { registry, booking, draft } = await setup();
    const reservedDesk = {
      ...selectCoworkTier(draft, "reserved-desk"),
      date: booking.workstationRequiredDates[0] ?? "",
    };

    const fitted = await settledModel(registry, reservedDesk);

    expect(Option.getOrThrow(fitted.draft.workstation).origin).toBe(
      "requirement"
    );
    // The fitted selection's own availability hasn't been read yet.
    expect(fitted.enablement.blockers.map(({ _tag }) => _tag)).toEqual([
      "AvailabilityPending",
    ]);

    const settled = await settledModel(registry, fitted.draft);

    expect(settled.draft).toBe(fitted.draft);
    expect(settled.enablement.blockers).toEqual([]);
    expect(settled.selection.monitorOption).toBe(
      Option.getOrThrow(fitted.draft.workstation).option
    );
  });

  test("waits for availability before continuing", async () => {
    const { registry, draft } = await setup();
    const catalog = await settledValue(registry, bookingOfferingsAtom("en-US"));

    const model = coworkBookingModel({
      draft,
      now,
      offerings: catalog.offerings,
      availability: {
        range: Option.none(),
        selection: Option.none(),
        workstationRequirement: Option.none(),
      },
    });

    expect(model.enablement.blockers.map(({ _tag }) => _tag)).toEqual([
      "AvailabilityPending",
    ]);
    expect(model.quotable).toEqual(Option.some(model.selection));
  });
});
