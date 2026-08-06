import { describe, expect, test } from "bun:test";
import type { Table } from "@deskohub/dotypos/generated";
import { getOfficeReservationSeatCapacity } from "./office-reservation-capacity";

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
      getOfficeReservationSeatCapacity([
        makeTable({ id: "office-small", seats: "4" }),
        makeTable({ id: "office-large", seats: "8" }),
        makeTable({ id: "cowork", seats: "20", tags: ["tier:basic"] }),
      ])
    ).toBe(8);
  });

  test("ignores unavailable and invalid office tables", () => {
    expect(
      getOfficeReservationSeatCapacity([
        makeTable({ id: "disabled", enabled: false, seats: "12" }),
        makeTable({ id: "hidden", display: false, seats: "10" }),
        makeTable({ id: undefined, seats: "9" }),
        makeTable({ id: "invalid", seats: "4.5" }),
        makeTable({ id: "office", seats: "3" }),
      ])
    ).toBe(3);
    expect(getOfficeReservationSeatCapacity([])).toBe(0);
  });
});
