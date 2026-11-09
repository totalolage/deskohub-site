import {
  afterAll,
  beforeAll,
  describe,
  expect,
  setSystemTime,
  test,
} from "bun:test";
import "@/shared/polyfills/temporal";
import { testEmailAddress } from "@deskohub/test-email";
import { Schema } from "effect";
import { workspaceMeetingRoomCatalog } from "@/features/checkout/product-catalog";
import { getMeetingRoomReservationInterval } from "./meeting-room-reservation-time";
import {
  getStoredWorkspaceReservationDetails,
  storedWorkspaceReservationDetailsSchema,
} from "./persistence-contracts";
import { reservationOrderSchema } from "./reservation-order";

const customer = {
  name: "Ada Lovelace",
  email: testEmailAddress("ada"),
  phone: "+420777777777",
} as const;

const decodeOrder = Schema.decodeUnknownSync(reservationOrderSchema);
// The repository decodes stored snapshots with these options.
const decodeStoredDetails = Schema.decodeUnknownSync(
  storedWorkspaceReservationDetailsSchema,
  { errors: "all", onExcessProperty: "error" }
);

/** What checkout persists for an order, as the repository reads it back. */
const storedDetailsFor = (order: typeof reservationOrderSchema.Encoded) => {
  const stored = getStoredWorkspaceReservationDetails(decodeOrder(order));
  expect(decodeStoredDetails(stored)).toEqual(stored);
  return stored;
};

describe("stored reservation snapshot identity", () => {
  beforeAll(() => {
    setSystemTime(new Date("2099-06-01T00:00:00Z"));
  });
  afterAll(() => {
    setSystemTime();
  });

  test("records the cowork tier, coffee, and monitor option", () => {
    expect(
      storedDetailsFor({
        kind: "cowork",
        entryTier: "open-space",
        date: "2099-06-10",
        coffee: true,
        ...customer,
      })
    ).toEqual({ kind: "cowork", entryTier: "open-space", coffee: true });
    expect(
      storedDetailsFor({
        kind: "cowork",
        entryTier: "reserved-desk",
        date: "2099-06-10",
        coffee: true,
        monitorOption: "2x32-4k",
        ...customer,
      })
    ).toEqual({
      kind: "cowork",
      entryTier: "reserved-desk",
      coffee: true,
      monitorOption: "2x32-4k",
    });
  });

  test.each(
    workspaceMeetingRoomCatalog.map(({ duration }) => [
      `${duration.unit}:${duration.amount}`,
      duration,
    ])
  )("records the %s meeting-room offer", (_offer, duration) => {
    const interval = getMeetingRoomReservationInterval(
      "2099-06-10T09:00",
      duration
    );
    if (!interval) throw new Error("catalog interval missing");

    expect(
      storedDetailsFor({
        kind: "meeting-room",
        duration,
        reservationDate: "2099-06-10",
        ...interval,
        ...customer,
      })
    ).toEqual({ kind: "meeting-room", duration });
  });

  test("records office seats and inclusive days", () => {
    expect(
      storedDetailsFor({
        kind: "office",
        startsOn: "2099-06-10",
        endsOn: "2099-06-12",
        seats: 3,
        ...customer,
      })
    ).toEqual({ kind: "office", seats: 3, dayCount: 3 });
  });

  test("still reads snapshots written before they recorded the identity", () => {
    for (const legacy of [{ kind: "meeting-room" }, { kind: "office" }]) {
      expect(decodeStoredDetails(legacy)).toEqual(legacy);
    }
  });
});
