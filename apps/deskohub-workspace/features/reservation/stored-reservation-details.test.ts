import { describe, expect, test } from "bun:test";
import { storedWorkspaceReservationDetailsSchema } from "./stored-reservation-details";

describe("stored workspace reservation details", () => {
  test("parses tagged cowork and meeting-room variants", () => {
    expect(
      storedWorkspaceReservationDetailsSchema.parse({
        _tag: "cowork",
        tier: "basic",
        coffee: false,
      })
    ).toEqual({
      _tag: "cowork",
      tier: "basic",
      coffee: false,
    });
    expect(
      storedWorkspaceReservationDetailsSchema.parse({
        _tag: "meeting-room",
      })
    ).toEqual({
      _tag: "meeting-room",
    });
  });

  test("allows Basic coffee but rejects monitor options", () => {
    expect(
      storedWorkspaceReservationDetailsSchema.safeParse({
        _tag: "cowork",
        tier: "basic",
        coffee: true,
      }).success
    ).toBe(true);
    expect(
      storedWorkspaceReservationDetailsSchema.safeParse({
        _tag: "cowork",
        tier: "basic",
        coffee: true,
        monitorOption: "2x27-qhd",
      }).success
    ).toBe(false);
  });

  test("requires Plus coffee and rejects monitor options", () => {
    expect(
      storedWorkspaceReservationDetailsSchema.safeParse({
        _tag: "cowork",
        tier: "plus",
        coffee: true,
      }).success
    ).toBe(true);
    expect(
      storedWorkspaceReservationDetailsSchema.safeParse({
        _tag: "cowork",
        tier: "plus",
        coffee: false,
      }).success
    ).toBe(false);
    expect(
      storedWorkspaceReservationDetailsSchema.safeParse({
        _tag: "cowork",
        tier: "plus",
        coffee: true,
        monitorOption: "2x27-qhd",
      }).success
    ).toBe(false);
  });

  test("requires Profi coffee and monitor option", () => {
    expect(
      storedWorkspaceReservationDetailsSchema.safeParse({
        _tag: "cowork",
        tier: "profi",
        coffee: true,
        monitorOption: "2x27-qhd",
      }).success
    ).toBe(true);
    expect(
      storedWorkspaceReservationDetailsSchema.safeParse({
        _tag: "cowork",
        tier: "profi",
        coffee: true,
      }).success
    ).toBe(false);
    expect(
      storedWorkspaceReservationDetailsSchema.safeParse({
        _tag: "cowork",
        tier: "profi",
        coffee: false,
        monitorOption: "2x27-qhd",
      }).success
    ).toBe(false);
  });

  test("stores meeting-room details as an exact tag only", () => {
    expect(
      storedWorkspaceReservationDetailsSchema.safeParse({
        _tag: "meeting-room",
      }).success
    ).toBe(true);
    expect(
      storedWorkspaceReservationDetailsSchema.safeParse({
        _tag: "meeting-room",
        startsAt: "2099-06-10T07:00:00Z",
      }).success
    ).toBe(false);
  });
});
