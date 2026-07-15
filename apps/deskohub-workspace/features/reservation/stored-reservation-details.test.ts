import { describe, expect, test } from "bun:test";
import { Result } from "effect";
import { storedWorkspaceReservationDetailsParser } from "./stored-reservation-details";

describe("stored workspace reservation details", () => {
  test("parses tagged cowork and meeting-room variants", () => {
    expect(
      storedWorkspaceReservationDetailsParser.parse({
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
      storedWorkspaceReservationDetailsParser.parse({
        _tag: "meeting-room",
      })
    ).toEqual({
      _tag: "meeting-room",
    });
  });

  test("allows Basic coffee but rejects monitor options", () => {
    expect(
      Result.isSuccess(
        storedWorkspaceReservationDetailsParser.safeParse({
          _tag: "cowork",
          tier: "basic",
          coffee: true,
        })
      )
    ).toBe(true);
    expect(
      Result.isSuccess(
        storedWorkspaceReservationDetailsParser.safeParse({
          _tag: "cowork",
          tier: "basic",
          coffee: true,
          monitorOption: "2x27-qhd",
        })
      )
    ).toBe(false);
  });

  test("requires Plus coffee and rejects monitor options", () => {
    expect(
      Result.isSuccess(
        storedWorkspaceReservationDetailsParser.safeParse({
          _tag: "cowork",
          tier: "plus",
          coffee: true,
        })
      )
    ).toBe(true);
    expect(
      Result.isSuccess(
        storedWorkspaceReservationDetailsParser.safeParse({
          _tag: "cowork",
          tier: "plus",
          coffee: false,
        })
      )
    ).toBe(false);
    expect(
      Result.isSuccess(
        storedWorkspaceReservationDetailsParser.safeParse({
          _tag: "cowork",
          tier: "plus",
          coffee: true,
          monitorOption: "2x27-qhd",
        })
      )
    ).toBe(false);
  });

  test("requires Profi coffee and monitor option", () => {
    expect(
      Result.isSuccess(
        storedWorkspaceReservationDetailsParser.safeParse({
          _tag: "cowork",
          tier: "profi",
          coffee: true,
          monitorOption: "2x27-qhd",
        })
      )
    ).toBe(true);
    expect(
      Result.isSuccess(
        storedWorkspaceReservationDetailsParser.safeParse({
          _tag: "cowork",
          tier: "profi",
          coffee: true,
        })
      )
    ).toBe(false);
    expect(
      Result.isSuccess(
        storedWorkspaceReservationDetailsParser.safeParse({
          _tag: "cowork",
          tier: "profi",
          coffee: false,
          monitorOption: "2x27-qhd",
        })
      )
    ).toBe(false);
  });

  test("stores meeting-room details as an exact tag only", () => {
    expect(
      Result.isSuccess(
        storedWorkspaceReservationDetailsParser.safeParse({
          _tag: "meeting-room",
        })
      )
    ).toBe(true);
    expect(
      Result.isSuccess(
        storedWorkspaceReservationDetailsParser.safeParse({
          _tag: "meeting-room",
          startsAt: "2099-06-10T07:00:00Z",
        })
      )
    ).toBe(false);
  });
});
