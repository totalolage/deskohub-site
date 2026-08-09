import { describe, expect, test } from "bun:test";
import type { Table } from "@deskohub/dotypos/generated";
import { Effect } from "effect";
import { getOfficeReservationSeatCapacity } from "./office-reservation-capacity";

const getSeatCapacity = (tables: readonly Table[]) =>
  Effect.runSync(getOfficeReservationSeatCapacity(tables));

const makeTable = (input: Partial<Table> & Pick<Table, "id">): Table => ({
  _cloudId: "cloud",
  display: true,
  enabled: true,
  name: input.id ?? "table",
  seats: "1",
  tags: ["reservation:office"],
  ...input,
});

describe("getOfficeReservationSeatCapacity", () => {
  test("uses the largest assignable office table without summing tables", () => {
    expect(
      getSeatCapacity([
        makeTable({ id: "office-small", seats: "4" }),
        makeTable({ id: "office-large", seats: "8" }),
        makeTable({ id: "cowork", seats: "20", tags: ["tier:basic"] }),
      ])
    ).toBe(8);
  });

  test("ignores unavailable office tables", () => {
    expect(
      getSeatCapacity([
        makeTable({ id: "disabled", enabled: false, seats: "12" }),
        makeTable({ id: "hidden", display: false, seats: "10" }),
        makeTable({ id: undefined, seats: "9" }),
        makeTable({ id: "office", seats: "3" }),
      ])
    ).toBe(3);
    expect(getSeatCapacity([])).toBe(0);
  });

  test("rejects an assignable office table with invalid seats", () => {
    expect(() =>
      getSeatCapacity([
        makeTable({ id: "invalid", seats: "4.5" }),
        makeTable({ id: "valid", seats: "3" }),
      ])
    ).toThrow("invalid seat capacity");
  });
});
