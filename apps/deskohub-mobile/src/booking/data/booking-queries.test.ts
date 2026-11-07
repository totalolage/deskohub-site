import { describe, expect, test } from "bun:test";
import {
  type CustomerBookingSelection,
  CustomerBookingSelectionInvalid,
} from "@deskohub/workspace-customer-api";
import { Effect, Layer } from "effect";
import { TestClock } from "effect/testing";
import { AsyncResult, type AtomRegistry } from "effect/unstable/reactivity";
import { customerDataRuntime } from "../../customer-api/customer-data-runtime";
import {
  automaticRefreshReserve,
  DotyposReadBudget,
  dotyposReadAllowance,
} from "../../customer-api/dotypos-read-budget";
import {
  makeCustomerDataRegistry,
  makeFakeCustomerData,
  settle,
} from "../../customer-api/testing/customer-data-test-registry";
import {
  fakeCustomerDataLayer,
  makeFakeDevice,
} from "../../customer-api/testing/fake-customer-data";
import { FakeWorkspace } from "../../customer-api/testing/fake-workspace";
import { fakeBooking } from "../testing/fake-booking-api";
import {
  bookingAvailabilityAtom,
  bookingOfferingsAtom,
  bookingQuoteAtom,
  bookingSelectionKey,
  legalDocumentsAtom,
  meetingRoomStartTimesAtom,
  quoteRefreshInterval,
} from "./booking-queries";
import { toBookingQueryError } from "./booking-query-error";

const remainingReadsAtom = customerDataRuntime.atom(
  Effect.flatMap(
    Effect.service(DotyposReadBudget),
    (budget) => budget.remaining
  )
);

/** A registry whose runtime runs on a test clock, with a way to move it. */
const withTestClock = () => {
  const workspace = FakeWorkspace.forKind("linked");
  const registry = makeCustomerDataRegistry(
    Layer.merge(
      fakeCustomerDataLayer({ workspace, device: makeFakeDevice() }),
      TestClock.layer()
    )
  );
  const inRuntime = <A>(effect: Effect.Effect<A, never, DotyposReadBudget>) =>
    Effect.runPromise(
      Effect.provideContext(
        effect,
        AsyncResult.getOrThrow(registry.get(customerDataRuntime))
      )
    );
  return {
    registry,
    workspace,
    booking: fakeBooking(workspace),
    adjust: (duration: Parameters<typeof TestClock.adjust>[0]) =>
      inRuntime(TestClock.adjust(duration)),
    spendReads: (count: number) =>
      inRuntime(
        Effect.flatMap(Effect.service(DotyposReadBudget), (budget) =>
          Effect.repeat(budget.spend, { times: count - 1 })
        )
      ),
  };
};

/** Lets the registry run what the clock woke before asserting. */
const flush = () => new Promise((resolve) => setTimeout(resolve, 10));

const coworkSelection = (date: string): CustomerBookingSelection => ({
  family: "cowork",
  tier: "open-space",
  date,
  coffee: true,
});

const quoteCalls = (registry: { booking: ReturnType<typeof fakeBooking> }) =>
  registry.booking.endpoints.filter((endpoint) => endpoint === "getQuote")
    .length;

const remainingReads = async (registry: AtomRegistry.AtomRegistry) => {
  const result = await settle(registry, remainingReadsAtom);
  return result._tag === "Success" ? result.success : Number.NaN;
};

describe("booking catalog queries", () => {
  test("reads the offerings through the real client as a Dotypos read", async () => {
    const { registry, workspace } = makeFakeCustomerData("linked");

    const result = await settle(registry, bookingOfferingsAtom("en-US"));

    expect(result._tag === "Success" && result.success.offerings.length).toBe(
      6
    );
    expect(fakeBooking(workspace).endpoints).toEqual(["listOfferings"]);
    expect(await remainingReads(registry)).toBe(dotyposReadAllowance.reads - 1);
  });

  test("reads the legal documents without spending the read budget", async () => {
    const { registry } = makeFakeCustomerData("linked");

    const result = await settle(registry, legalDocumentsAtom("cs-CZ"));

    expect(result).toMatchObject({
      _tag: "Success",
      success: {
        documents: [
          { key: "terms-and-conditions" },
          { key: "operating-rules" },
        ],
      },
    });
    expect(await remainingReads(registry)).toBe(dotyposReadAllowance.reads);
  });

  test("reads availability once per distinct query", async () => {
    const { registry, workspace } = makeFakeCustomerData("linked");
    const booking = fakeBooking(workspace);
    const query = { kind: "cowork" as const, date: booking.dateIn(7) };

    const first = await settle(registry, bookingAvailabilityAtom({ query }));
    const unmount = registry.mount(bookingAvailabilityAtom({ query }));
    await settle(registry, bookingAvailabilityAtom({ query: { ...query } }));
    await settle(
      registry,
      bookingAvailabilityAtom({ query: { ...query, date: booking.dateIn(8) } })
    );
    unmount();

    expect(first).toMatchObject({
      success: { unavailableCoworkTiers: ["reserved-desk"] },
    });
    expect(bookingAvailabilityAtom({ query })).toBe(
      bookingAvailabilityAtom({ query: { ...query } })
    );
    expect(
      booking.endpoints.filter((endpoint) => endpoint === "getAvailability")
    ).toHaveLength(2);
  });

  test("sends the replaced pay state with availability", async () => {
    const { registry, workspace } = makeFakeCustomerData("linked");
    const booking = fakeBooking(workspace);

    await settle(
      registry,
      meetingRoomStartTimesAtom({
        date: booking.dateIn(1),
        duration: "hour:4",
        replacingPayStateToken: "ps1.held",
      })
    );

    expect(booking.calls).toMatchObject([
      {
        endpoint: "getMeetingRoomStartTimes",
        input: { date: booking.dateIn(1), duration: "hour:4" },
      },
    ]);
  });

  test("keys meeting-room start times by date and duration", async () => {
    const { registry, workspace } = makeFakeCustomerData("linked");
    const booking = fakeBooking(workspace);
    const date = booking.dateIn(1);

    const hour = await settle(
      registry,
      meetingRoomStartTimesAtom({ date, duration: "hour:1" })
    );
    const day = await settle(
      registry,
      meetingRoomStartTimesAtom({ date, duration: "day:1" })
    );

    expect(hour).toMatchObject({ success: { duration: "hour:1" } });
    expect(hour._tag === "Success" && hour.success.startTimes.length).toBe(10);
    expect(day._tag === "Success" && day.success.startTimes.length).toBe(1);
  });

  test("shares one quote between equal selections", () => {
    const selection = coworkSelection("2026-12-01");
    const reordered: CustomerBookingSelection = {
      coffee: true,
      date: "2026-12-01",
      tier: "open-space",
      family: "cowork",
      monitorOption: undefined,
    };

    expect(bookingSelectionKey(reordered)).toBe(bookingSelectionKey(selection));
    expect(bookingQuoteAtom(reordered, "en-US")).toBe(
      bookingQuoteAtom(selection, "en-US")
    );
    expect(bookingQuoteAtom(selection, "cs-CZ")).not.toBe(
      bookingQuoteAtom(selection, "en-US")
    );
  });
});

describe("bookingQuoteAtom refresh", () => {
  test("reads the quote again every four minutes while mounted", async () => {
    const harness = withTestClock();
    const atom = bookingQuoteAtom(
      coworkSelection(harness.booking.dateIn(20)),
      "en-US"
    );
    const unmount = harness.registry.mount(atom);

    const first = await settle(harness.registry, atom);
    await harness.adjust(quoteRefreshInterval);
    await flush();
    const second = await settle(harness.registry, atom);

    expect(quoteCalls(harness)).toBe(2);
    expect(
      first._tag === "Success" &&
        second._tag === "Success" &&
        first.success.advertisedPriceToken !==
          second.success.advertisedPriceToken
    ).toBe(true);

    unmount();
    await flush();
    await harness.adjust(quoteRefreshInterval);
    await flush();
    expect(quoteCalls(harness)).toBe(2);
  });

  test("restarts the wait when the quote is read again by hand", async () => {
    const harness = withTestClock();
    const atom = bookingQuoteAtom(
      coworkSelection(harness.booking.dateIn(22)),
      "en-US"
    );
    const unmount = harness.registry.mount(atom);
    await settle(harness.registry, atom);

    await harness.adjust("2 minutes");
    harness.registry.refresh(atom);
    await flush();
    await settle(harness.registry, atom);
    await harness.adjust("3 minutes");
    await flush();
    const beforeNewInterval = quoteCalls(harness);
    await harness.adjust("1 minute");
    await flush();
    await settle(harness.registry, atom);
    unmount();

    expect(beforeNewInterval).toBe(2);
    expect(quoteCalls(harness)).toBe(3);
  });

  test("skips the automatic read once the budget is down to its reserve", async () => {
    const harness = withTestClock();
    const atom = bookingQuoteAtom(
      coworkSelection(harness.booking.dateIn(21)),
      "en-US"
    );
    const unmount = harness.registry.mount(atom);
    await settle(harness.registry, atom);

    await harness.spendReads(
      dotyposReadAllowance.reads - 1 - (automaticRefreshReserve - 1)
    );
    await harness.adjust(quoteRefreshInterval);
    await flush();
    unmount();

    expect(quoteCalls(harness)).toBe(1);
  });
});

describe("toBookingQueryError", () => {
  test("maps the catalog tags", async () => {
    const { registry, workspace } = makeFakeCustomerData("linked");
    const booking = fakeBooking(workspace);
    booking.officeClosed = true;

    const outOfRange = await settle(
      registry,
      bookingQuoteAtom(coworkSelection(booking.dateIn(400)), "en-US")
    );
    const closed = await settle(
      registry,
      bookingQuoteAtom(
        { family: "office", date: booking.dateIn(2), seats: 2 },
        "en-US"
      )
    );
    booking.reject(
      "getAvailability",
      new CustomerBookingSelectionInvalid({ field: "seats" })
    );
    const invalid = await settle(
      registry,
      bookingAvailabilityAtom({ query: { kind: "office" } })
    );

    expect(
      outOfRange._tag === "Failure" && toBookingQueryError(outOfRange.failure)
    ).toMatchObject({
      _tag: "DateOutOfRange",
      earliest: booking.today(),
      latest: booking.dateIn(183),
    });
    expect(
      closed._tag === "Failure" && toBookingQueryError(closed.failure)
    ).toMatchObject({ _tag: "OfferingUnavailable", family: "office" });
    expect(
      invalid._tag === "Failure" && toBookingQueryError(invalid.failure)
    ).toMatchObject({ _tag: "SelectionInvalid", field: "seats" });
  });

  test("falls through to the shared view errors", async () => {
    const { registry, workspace } = makeFakeCustomerData("linked");
    const booking = fakeBooking(workspace);
    booking.fail("listOfferings", "rate-limited");
    booking.fail("listLegalDocuments", "service-unavailable");

    const limited = await settle(registry, bookingOfferingsAtom("en-US"));
    const unavailable = await settle(registry, legalDocumentsAtom("en-US"));

    expect(
      limited._tag === "Failure" && toBookingQueryError(limited.failure)
    ).toMatchObject({ _tag: "RateLimited" });
    expect(
      unavailable._tag === "Failure" && toBookingQueryError(unavailable.failure)
    ).toMatchObject({ _tag: "Unavailable" });
  });
});
