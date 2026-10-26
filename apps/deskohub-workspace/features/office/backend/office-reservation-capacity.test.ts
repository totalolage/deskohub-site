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
  test("rejects multiple assignable office tables", () => {
    expect(
      Effect.runSync(
        Effect.flip(
          getOfficeReservationSeatCapacity([
            makeTable({ id: "office-small", seats: "4" }),
            makeTable({ id: "office-large", seats: "8" }),
            makeTable({ id: "cowork", seats: "20", tags: ["tier:basic"] }),
          ])
        )
      )
    ).toMatchObject({ _tag: "OfficeTableUnconfigured" });
  });

  test("ignores unavailable office tables when one assignable table remains", () => {
    expect(
      getSeatCapacity([
        makeTable({ id: "disabled", enabled: false, seats: "12" }),
        makeTable({ id: "hidden", display: false, seats: "10" }),
        makeTable({ id: undefined, seats: "9" }),
        makeTable({ id: "office", seats: "3" }),
      ])
    ).toBe(3);
  });
});
