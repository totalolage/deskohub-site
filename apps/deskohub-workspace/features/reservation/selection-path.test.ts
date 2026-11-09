import "@/shared/polyfills/temporal";

import { describe, expect, test } from "bun:test";
import { testEmailAddress } from "@deskohub/test-email";
import {
  getSelectionPath,
  getShareableSelectionPath,
  type ReservationSelection,
} from "./selection-path";

describe("getSelectionPath", () => {
  test.each<[ReservationSelection, string]>([
    [
      { kind: "cowork", entryTier: "reserved-desk" },
      "/en-US/reservation/cowork?entryTier=reserved-desk",
    ],
    [
      {
        kind: "cowork",
        entryTier: "reserved-desk",
        date: "2099-06-12",
        coffee: true,
        monitorOption: undefined,
      },
      "/en-US/reservation/cowork?entryTier=reserved-desk&date=2099-06-12&coffee=true&monitorOption=none",
    ],
    [
      { kind: "meeting-room", duration: "hour:4" },
      "/en-US/reservation/meeting-room?duration=hour%3A4",
    ],
    [
      {
        kind: "meeting-room",
        startDateTime: "2099-08-12T09:00",
        duration: "hour:1",
      },
      "/en-US/reservation/meeting-room?startDateTime=2099-08-12T09%3A00&duration=hour%3A1",
    ],
    [{ kind: "office" }, "/en-US/reservation/office"],
    [
      { kind: "office", startsOn: "2099-06-12", dayCount: 2, seats: 3 },
      "/en-US/reservation/office?startsOn=2099-06-12&dayCount=2&seats=3",
    ],
  ])("links %o to its family page", (selection, path) => {
    expect(getSelectionPath("en-US", selection)).toBe(path);
  });

  test("shares the same selection without a locale prefix", () => {
    expect(
      getShareableSelectionPath({ kind: "meeting-room", duration: "day:1" })
    ).toBe("/reservation/meeting-room?duration=day%3A1");
  });

  test("never carries contact details or the customer mode", () => {
    const contact = {
      name: "Ada Lovelace",
      email: testEmailAddress("ada"),
      phone: "+420777777777",
      customer: "contact",
    };
    // Callers may hold the whole form values, contact included.
    const selections: ReadonlyArray<ReservationSelection> = [
      {
        kind: "cowork",
        entryTier: "reserved-desk",
        date: "2099-06-10",
        coffee: true,
        monitorOption: "2x27-qhd",
        ...contact,
      },
      {
        kind: "meeting-room",
        startDateTime: "2099-08-12T09:00",
        duration: "hour:1",
        ...contact,
      },
      {
        kind: "office",
        startsOn: "2099-06-12",
        dayCount: 2,
        seats: 3,
        ...contact,
      },
    ];

    for (const selection of selections) {
      const { searchParams } = new URL(
        getSelectionPath("en-US", selection),
        "https://workspace.test"
      );
      for (const param of Object.keys(contact)) {
        expect(searchParams.has(param)).toBe(false);
      }
    }
  });
});
