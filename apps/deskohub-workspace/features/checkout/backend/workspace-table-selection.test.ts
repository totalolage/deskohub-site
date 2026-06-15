import { describe, expect, test } from "bun:test";
import type { Table } from "@deskohub/dotypos/generated";
import { selectWorkspaceTableFromCandidates } from "./workspace-table-selection";

const makeTable = (input: {
  readonly id: string;
  readonly name: string;
  readonly tags?: readonly string[];
  readonly seats?: string | undefined;
  readonly positionX?: string;
  readonly positionY?: string;
  readonly locationName?: string;
}): Table => ({
  _cloudId: "cloud",
  display: true,
  enabled: true,
  seats: "1",
  ...input,
  tags: [...(input.tags ?? ["tier:basic"])],
});

describe("selectWorkspaceTableFromCandidates", () => {
  test("selects the candidate with the strongest normalized distance score", () => {
    const occupied = makeTable({
      id: "occupied",
      name: "1",
      positionX: "0",
      positionY: "0",
    });
    const halfway = makeTable({
      id: "halfway",
      name: "2",
      positionX: "5",
      positionY: "0",
    });
    const far = makeTable({
      id: "far",
      name: "3",
      positionX: "10",
      positionY: "0",
    });
    const tables = [occupied, halfway, far];
    const occupancyByTableId = new Map([["occupied", 1]]);

    expect(
      selectWorkspaceTableFromCandidates(tables, tables, occupancyByTableId)?.id
    ).toBe("far");
  });

  test("penalizes candidate occupancy", () => {
    const reference = makeTable({
      id: "reference",
      name: "1",
      positionX: "0",
      positionY: "0",
    });
    const lightlyOccupied = makeTable({
      id: "lightly-occupied",
      name: "2",
      seats: "2",
      positionX: "10",
      positionY: "0",
    });
    const heavilyOccupied = makeTable({
      id: "heavily-occupied",
      name: "3",
      seats: "3",
      positionX: "10",
      positionY: "0",
    });
    const tables = [reference, lightlyOccupied, heavilyOccupied];
    const occupancyByTableId = new Map([
      ["reference", 1],
      ["lightly-occupied", 1],
      ["heavily-occupied", 2],
    ]);

    expect(
      selectWorkspaceTableFromCandidates(tables, tables, occupancyByTableId)?.id
    ).toBe("lightly-occupied");
  });

  test("selects an unoccupied table when no table is occupied", () => {
    const unoccupied = makeTable({
      id: "unoccupied",
      name: "1",
      positionX: "0",
      positionY: "0",
    });

    expect(
      selectWorkspaceTableFromCandidates([unoccupied], [unoccupied], new Map())
        ?.id
    ).toBe("unoccupied");
  });

  test("selects an unoccupied table above an occupied table", () => {
    const occupiedReference = makeTable({
      id: "occupied-reference",
      name: "1",
      positionX: "0",
      positionY: "0",
    });
    const nearestUnoccupied = makeTable({
      id: "nearest-unoccupied",
      name: "2",
      positionX: "0",
      positionY: "0",
    });
    const distantOccupied = makeTable({
      id: "distant-occupied",
      name: "3",
      seats: "2",
      positionX: "10",
      positionY: "0",
    });
    const tables = [occupiedReference, nearestUnoccupied, distantOccupied];
    const occupancyByTableId = new Map([
      ["occupied-reference", 1],
      ["distant-occupied", 1],
    ]);

    expect(
      selectWorkspaceTableFromCandidates(tables, tables, occupancyByTableId)?.id
    ).toBe("nearest-unoccupied");
  });

  test("does not select tables with invalid seats", () => {
    const cases = [
      { seats: undefined, label: "missing seats" },
      { seats: "not-a-number", label: "non-numeric seats" },
      { seats: "0", label: "zero seats" },
      { seats: "-1", label: "negative seats" },
    ];

    for (const { seats, label } of cases) {
      const invalid = makeTable({ id: label, name: "1", seats });
      const valid = makeTable({ id: `valid-${label}`, name: "2" });

      expect(
        selectWorkspaceTableFromCandidates([invalid], [invalid], new Map()),
        label
      ).toBeUndefined();
      expect(
        selectWorkspaceTableFromCandidates(
          [invalid, valid],
          [invalid, valid],
          new Map()
        )?.id,
        label
      ).toBe(valid.id);
    }
  });

  test("uses natural table order as the tie-breaker", () => {
    const tables = [
      makeTable({ id: "basic-10", name: "10" }),
      makeTable({ id: "basic-b", name: "2" }),
      makeTable({ id: "basic-a", name: "2" }),
    ];

    expect(
      selectWorkspaceTableFromCandidates(tables, tables, new Map())?.id
    ).toBe("basic-a");
  });

  test("scores against same-room occupied workspace tables that are not candidates", () => {
    const occupiedNonCandidate = makeTable({
      id: "occupied-plus",
      name: "1",
      tags: ["tier:plus"],
      positionX: "0",
      positionY: "0",
      locationName: "main",
    });
    const nearCandidate = makeTable({
      id: "near-basic",
      name: "2",
      positionX: "1",
      positionY: "0",
      locationName: "main",
    });
    const farCandidate = makeTable({
      id: "far-basic",
      name: "3",
      positionX: "10",
      positionY: "0",
      locationName: "main",
    });

    expect(
      selectWorkspaceTableFromCandidates(
        [nearCandidate, farCandidate],
        [occupiedNonCandidate, nearCandidate, farCandidate],
        new Map([["occupied-plus", 1]])
      )?.id
    ).toBe("far-basic");
  });

  test("ignores occupied workspace tables in a different room", () => {
    const occupiedDifferentRoom = makeTable({
      id: "occupied-plus",
      name: "1",
      tags: ["tier:plus"],
      positionX: "0",
      positionY: "0",
      locationName: "side-room",
    });
    const firstCandidate = makeTable({
      id: "first-basic",
      name: "2",
      positionX: "1",
      positionY: "0",
      locationName: "main",
    });
    const farCandidate = makeTable({
      id: "far-basic",
      name: "3",
      positionX: "10",
      positionY: "0",
      locationName: "main",
    });

    expect(
      selectWorkspaceTableFromCandidates(
        [firstCandidate, farCandidate],
        [occupiedDifferentRoom, firstCandidate, farCandidate],
        new Map([["occupied-plus", 1]])
      )?.id
    ).toBe("first-basic");
  });
});
