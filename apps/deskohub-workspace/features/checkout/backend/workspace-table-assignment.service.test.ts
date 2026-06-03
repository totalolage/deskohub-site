import { describe, expect, mock, test } from "bun:test";
import { DotyposService } from "@deskohub/dotypos";
import type { Reservation, Table } from "@deskohub/dotypos/generated";
import { Effect, Layer } from "effect";
import "@/shared/polyfills/temporal";
import type { CheckoutDetailsJson } from "@/features/checkout/types/checkout-details";
import {
  WorkspaceTableAssignmentService,
  WorkspaceTableAssignmentServiceLive,
} from "./workspace-table-assignment.service";

type DotyposAssignmentTestService = typeof DotyposService.Service;

const makeReservation = (
  overrides: Partial<CheckoutDetailsJson["reservation"]> = {}
): CheckoutDetailsJson["reservation"] => ({
  tier: "basic",
  date: "2099-06-10",
  coffee: false,
  ...overrides,
});

const makeTable = (input: {
  readonly id?: string;
  readonly name: string;
  readonly tags?: string[];
  readonly display?: boolean;
  readonly enabled?: boolean;
}): Table => ({
  _cloudId: "cloud",
  display: true,
  enabled: true,
  ...input,
});

const makeDotyposReservation = (input: {
  readonly tableId: string;
  readonly status: Reservation["status"];
  readonly startDate?: string;
  readonly endDate?: string;
}): Reservation => ({
  _branchId: "branch",
  _cloudId: "cloud",
  _tableId: input.tableId,
  startDate: input.startDate ?? "2099-06-09T22:00:00Z",
  endDate: input.endDate ?? "2099-06-10T22:00:00Z",
  status: input.status,
});

const assignTableId = (
  reservation: CheckoutDetailsJson["reservation"],
  tables: readonly Table[],
  dotyposReservations: readonly Reservation[] = []
) => {
  const dotyposService: DotyposAssignmentTestService = {
    createReservation: mock(() => Effect.die("createReservation not mocked")),
    getReservation: mock(() => Effect.die("getReservation not mocked")),
    getCustomer: mock(() => Effect.die("getCustomer not mocked")),
    findCustomer: mock(() => Effect.die("findCustomer not mocked")),
    findOrCreateCustomer: mock(() =>
      Effect.die("findOrCreateCustomer not mocked")
    ),
    getCustomerDiscount: mock(() =>
      Effect.die("getCustomerDiscount not mocked")
    ),
    getTables: mock(() => Effect.succeed([...tables])),
    listReservations: mock(() => Effect.succeed([...dotyposReservations])),
    getProducts: mock(() => Effect.die("getProducts not mocked")),
    getCategories: mock(() => Effect.die("getCategories not mocked")),
  };

  return Effect.gen(function* () {
    const service = yield* WorkspaceTableAssignmentService;
    return yield* service.assignTableId(reservation);
  }).pipe(
    Effect.provide(WorkspaceTableAssignmentServiceLive),
    Effect.provide(Layer.succeed(DotyposService, dotyposService)),
    Effect.runPromise
  );
};

describe("WorkspaceTableAssignmentService", () => {
  test("matches Profi 2x27 QHD by tier and monitor tags", async () => {
    await expect(
      assignTableId(
        makeReservation({
          tier: "profi",
          monitorOption: "2x27-qhd",
        }),
        [
          makeTable({
            id: "wrong-resolution",
            name: "3",
            tags: [
              "tier:profi",
              "monitor:count:2",
              "monitor:size:27",
              "monitor:resolution:4k",
            ],
          }),
          makeTable({
            id: "qhd-27",
            name: "1",
            tags: [
              "tier:profi",
              "monitor:count:2",
              "monitor:size:27",
              "monitor:resolution:qhd",
            ],
          }),
        ]
      )
    ).resolves.toBe("qhd-27");
  });

  test("matches Profi 2x32 4K by tier and monitor tags", async () => {
    await expect(
      assignTableId(
        makeReservation({
          tier: "profi",
          monitorOption: "2x32-4k",
        }),
        [
          makeTable({
            id: "qhd-32",
            name: "2",
            tags: [
              "tier:profi",
              "monitor:count:2",
              "monitor:size:32",
              "monitor:resolution:qhd",
            ],
          }),
          makeTable({
            id: "4k-32",
            name: "4",
            tags: [
              "tier:profi",
              "monitor:count:2",
              "monitor:size:32",
              "monitor:resolution:4k",
            ],
          }),
        ]
      )
    ).resolves.toBe("4k-32");
  });

  test("selects Basic and Plus matches deterministically by natural table name then id", async () => {
    await expect(
      assignTableId(makeReservation({ tier: "basic" }), [
        makeTable({ id: "basic-10", name: "10", tags: ["tier:basic"] }),
        makeTable({ id: "basic-b", name: "2", tags: ["tier:basic"] }),
        makeTable({ id: "basic-a", name: "2", tags: ["tier:basic"] }),
      ])
    ).resolves.toBe("basic-a");

    await expect(
      assignTableId(makeReservation({ tier: "plus" }), [
        makeTable({ id: "plus-7", name: "7", tags: ["tier:plus"] }),
        makeTable({ id: "plus-5", name: "5", tags: ["tier:plus"] }),
        makeTable({ id: "basic-1", name: "1", tags: ["tier:basic"] }),
      ])
    ).resolves.toBe("plus-5");
  });

  test("skips an occupied matching table and assigns the next free matching table", async () => {
    await expect(
      assignTableId(
        makeReservation({ tier: "basic", date: "2099-06-10" }),
        [
          makeTable({ id: "basic-1", name: "1", tags: ["tier:basic"] }),
          makeTable({ id: "basic-2", name: "2", tags: ["tier:basic"] }),
        ],
        [makeDotyposReservation({ tableId: "basic-1", status: "NEW" })]
      )
    ).resolves.toBe("basic-2");
  });

  test("ignores hidden, disabled, missing-id, inactive-flag, and unlabeled active visible virtual tables", async () => {
    await expect(
      assignTableId(makeReservation({ tier: "basic" }), [
        makeTable({ id: "online", name: "Online reservation", tags: [] }),
        {
          _cloudId: "cloud",
          id: "missing-display-enabled",
          name: "0",
          tags: ["tier:basic"],
        } satisfies Table,
        makeTable({
          id: "hidden",
          name: "1",
          tags: ["tier:basic"],
          display: false,
        }),
        makeTable({
          id: "disabled",
          name: "2",
          tags: ["tier:basic"],
          enabled: false,
        }),
        makeTable({ id: "", name: "3", tags: ["tier:basic"] }),
        makeTable({ name: "4", tags: ["tier:basic"] }),
        makeTable({ id: "basic-8", name: "8", tags: ["tier:basic"] }),
      ])
    ).resolves.toBe("basic-8");
  });

  test("fails clearly when Profi is missing the required monitor option", async () => {
    await expect(
      assignTableId(makeReservation({ tier: "profi" }), [])
    ).rejects.toThrow("requires a monitor option");
  });

  test("fails clearly when Profi has an unsupported monitor option", async () => {
    const invalidReservation: CheckoutDetailsJson["reservation"] = JSON.parse(
      JSON.stringify({
        ...makeReservation({ tier: "profi" }),
        monitorOption: "2x27",
      })
    );

    await expect(assignTableId(invalidReservation, [])).rejects.toThrow(
      "monitor option is not supported"
    );
  });

  test("fails clearly when no active visible table matches all required tags", async () => {
    await expect(
      assignTableId(
        makeReservation({
          tier: "profi",
          monitorOption: "2x27-qhd",
        }),
        [
          makeTable({ id: "profi-only", name: "1", tags: ["tier:profi"] }),
          makeTable({
            id: "qhd-only",
            name: "2",
            tags: ["monitor:resolution:qhd"],
          }),
        ]
      )
    ).rejects.toThrow("No active visible Dotypos workspace table matches tags");
  });
});
