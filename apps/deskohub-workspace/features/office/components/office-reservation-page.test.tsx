import { beforeEach, expect, mock, test } from "bun:test";
import { Effect } from "effect";
import { Children, type ReactElement, type ReactNode } from "react";
import { getOfficeSeatAdvertisedPriceRequests } from "@/features/reservation/office-advertised-price";
import {
  getOfficeAvailabilityQuery,
  type WorkspaceAvailabilityQuery,
} from "@/features/reservation/workspace-availability";
import type { OfficeReservationForm } from "./office-reservation-form";

mock.module("next/root-params", () => ({
  locale: () => Promise.resolve("en-US"),
}));

// Each request preloads, without a price the structured data could use.
const loadAdvertisedPrices = mock((requests: ReadonlyArray<unknown>) =>
  Effect.succeed(requests.map((request) => ({ request })))
);
const loadOfficeReservationSeatCapacity = mock(() => Promise.resolve(5));

mock.module("@/features/reservation/backend/advertised-prices.server", () => ({
  loadAdvertisedPrices,
  preloadPageAdvertisedPrices: loadAdvertisedPrices,
}));
mock.module(
  "@/features/office/backend/office-reservation-capacity.server",
  () => ({ loadOfficeReservationSeatCapacity })
);

const preloadAvailability = mock(
  ({
    queries,
  }: {
    readonly queries: ReadonlyArray<WorkspaceAvailabilityQuery>;
    readonly replacementToken?: string;
  }) =>
    Effect.succeed(
      queries.map((query) => ({
        query,
        availability: {
          from: query.from,
          to: query.to,
          unavailableDates: [],
          reservedDeskWorkstationRequiredDates: [],
          unavailableCoworkTiers: [],
          meetingRoomUnavailable: false,
          officeUnavailable: false,
          unavailableMonitorOptions: [],
          notices: [],
        },
        loadedAt: 1,
      }))
    )
);
mock.module(
  "@/features/reservation/backend/workspace-availability-loader",
  () => ({
    preloadPageAvailability: preloadAvailability,
  })
);

const { renderOfficeReservationContent } = await import(
  "./office-reservation-page"
);

/** The form the page renders beside its structured data. */
const renderOfficeReservationForm = async (
  input: Parameters<typeof renderOfficeReservationContent>[0]
) => {
  const page = (await renderOfficeReservationContent(input)) as ReactElement<{
    readonly children: ReactNode;
  }>;
  return Children.toArray(page.props.children)[1];
};

beforeEach(() => mock.clearAllMocks());

test("prefills safe office shape on a fresh date and quote", async () => {
  const originalNow = Temporal.Now.instant;
  Temporal.Now.instant = () => Temporal.Instant.from("2099-07-30T13:01:00Z");

  try {
    const form = (await renderOfficeReservationForm({
      locale: "en-US",
      pageData: 5,
      searchParams: { dayCount: "3", seats: "4" },
    })) as ReactElement<Parameters<typeof OfficeReservationForm>[0]>;

    expect(form.props.initialValues).toMatchObject({
      startsOn: "2099-07-30",
      dayCount: 3,
      seats: 4,
      name: "",
      email: "",
      phone: "",
    });
    // The page shell loads the capacity alongside the existing customer.
    expect(loadOfficeReservationSeatCapacity).not.toHaveBeenCalled();
    expect(loadAdvertisedPrices.mock.calls[0]?.[0]).toEqual(
      getOfficeSeatAdvertisedPriceRequests({
        locale: "en-US",
        seatCapacity: 5,
        startsOn: "2099-07-30",
        endsOn: "2099-08-01",
      })
    );
    expect(loadAdvertisedPrices.mock.calls[0]?.[0]).toHaveLength(5);
    expect(loadAdvertisedPrices.mock.calls[0]?.[0]).toContainEqual({
      locale: "en-US",
      reservation: {
        kind: "office",
        details: {
          kind: "office",
          startsOn: "2099-07-30",
          endsOn: "2099-08-01",
          seats: 4,
        },
      },
    });
    expect(form.props.initialAdvertisedPrices).toHaveLength(5);
    expect(preloadAvailability.mock.calls[0]?.[0]).toEqual({
      queries: [getOfficeAvailabilityQuery("2099-07-30")],
      replacementToken: undefined,
    });
    expect(form.props.initialAvailability?.map(({ query }) => query)).toEqual([
      getOfficeAvailabilityQuery("2099-07-30"),
    ]);
  } finally {
    Temporal.Now.instant = originalNow;
  }
});

test("keys the preloaded availability to the Prague date near midnight", async () => {
  const originalNow = Temporal.Now.instant;
  Temporal.Now.instant = () => Temporal.Instant.from("2099-07-30T22:30:00Z");

  try {
    const form = (await renderOfficeReservationForm({
      locale: "en-US",
      pageData: 5,
      replacementToken: "signed-replacement-token",
      searchParams: {},
    })) as ReactElement<Parameters<typeof OfficeReservationForm>[0]>;

    expect(form.props.today).toBe("2099-07-31");
    expect(preloadAvailability.mock.calls[0]?.[0]).toEqual({
      queries: [getOfficeAvailabilityQuery("2099-07-31")],
      replacementToken: "signed-replacement-token",
    });
    expect(preloadAvailability.mock.calls[0]?.[0].queries[0]?.from).toBe(
      "2099-07-31"
    );
  } finally {
    Temporal.Now.instant = originalNow;
  }
});
