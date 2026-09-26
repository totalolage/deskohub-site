import { expect, test } from "bun:test";
import {
  DotyposDiscountGroupIdSchema,
  DotyposReservationIdSchema,
} from "@deskohub/dotypos";
import type { DiscountGroup } from "@deskohub/dotypos/generated";
import { Effect } from "effect";
import type { DatasourceConfig } from "../config";
import { workspaceE2ETimeouts } from "../timeouts";
import {
  dotyposTimestampMatches,
  selectE2EDotyposDiscountGroup,
  waitForCancelledDotyposReservations,
  waitForConfirmedDotyposReservation,
  waitForDotyposCancellationConvergence,
  waitForDotyposCustomerDiscountGroup,
} from "./dotypos";

test("selects an active partial Dotypos discount deterministically", () => {
  const selected = selectE2EDotyposDiscountGroup([
    { id: "deleted", deleted: true, discountPercent: "5" },
    { id: "full", discountPercent: "100" },
    { id: "malformed", discountPercent: "10.005" },
    { id: "later", discountPercent: "12.5" },
    { id: "second", discountPercent: "7.5" },
    { id: "first", discountPercent: "7.5" },
    { id: "fractional", discountPercent: "0.07" },
  ] satisfies readonly DiscountGroup[]);

  expect(selected).toEqual({ basisPoints: 7, id: "fractional" });
});

test("requires a usable Dotypos customer-discount group", () => {
  expect(() =>
    selectE2EDotyposDiscountGroup([
      { id: "deleted", deleted: true, discountPercent: "10" },
      { id: "full", discountPercent: "100" },
    ])
  ).toThrow(
    "the E2E Dotypos cloud must contain an active percentage discount group from 0.01% through 90%"
  );
});

test("rejects a near-total group that leaves too little for stacked discounts", () => {
  expect(() =>
    selectE2EDotyposDiscountGroup([
      { id: "near-total", discountPercent: "99.99" },
    ])
  ).toThrow(
    "the E2E Dotypos cloud must contain an active percentage discount group from 0.01% through 90%"
  );
});

test("waits for Dotypos to expose the confirmed reservation state", async () => {
  let reads = 0;
  const result = await Effect.runPromise(
    waitForConfirmedDotyposReservation(
      Effect.sync(() => {
        reads += 1;
        return {
          reservation: {
            status: reads < 3 ? "NEW" : "CONFIRMED",
          },
        };
      }),
      { intervalMs: 1, timeoutMs: 500 }
    )
  );

  expect(result.reservation.status).toBe("CONFIRMED");
  expect(reads).toBe(3);
});

test("waits for cancelled reservations to leave active inventory", async () => {
  let reads = 0;
  const reservationId = DotyposReservationIdSchema.make("target-reservation");
  await Effect.runPromise(
    waitForDotyposCancellationConvergence(
      Effect.sync(() => {
        reads += 1;
        return [
          ...(reads < 3
            ? [{ id: reservationId, status: "CONFIRMED" as const }]
            : []),
        ];
      }),
      [reservationId],
      { intervalMs: 1, timeoutMs: 500 }
    )
  );

  expect(reads).toBe(3);
});

// The two fake-reader tests above only poll the supplied read effect; they
// prove the polling wrapper, not which read model the cleanup adapter wires
// in. The adapter-level test below executes waitForCancelledDotyposReservations
// against a recording Dotypos API server to prove the overlapping-interval
// read model is the one driving cleanup convergence.

test("the cleanup adapter polls the overlapping-interval read model to convergence", async () => {
  const reservationId = DotyposReservationIdSchema.make("555000111");
  const interval = {
    startDate: new Date("2099-01-01T10:00:00.000Z"),
    endDate: new Date("2099-01-01T12:00:00.000Z"),
  };
  const fakeReservation = (status: "CONFIRMED" | "CANCELLED") => ({
    id: "555000111",
    _branchId: "11111111",
    _cloudId: "cloud-id",
    startDate: "2099-01-01T11:00:00.000Z",
    endDate: "2099-01-01T13:00:00.000Z",
    seats: "2",
    status,
  });
  const listCalls: URL[] = [];
  const requestPaths: string[] = [];
  let poll = 0;

  const server = Bun.serve({
    port: 0,
    fetch: (request) => {
      const url = new URL(request.url);
      requestPaths.push(`${request.method} ${url.pathname}`);
      if (url.pathname === "/signin/token") {
        return Response.json({ accessToken: "access-token" });
      }
      if (url.pathname === "/clouds/cloud-id/reservations") {
        poll += 1;
        listCalls.push(url);
        return Response.json({
          data: [fakeReservation(poll === 1 ? "CONFIRMED" : "CANCELLED")],
        });
      }
      return new Response("Not found", { status: 404 });
    },
  });

  try {
    const config: DatasourceConfig = {
      databaseUrl: "postgres://localhost/fake",
      databaseUrlUnpooled: "postgres://localhost/fake",
      dotypos: {
        apiTimeout: 1_000,
        apiUrl: `http://127.0.0.1:${server.port}`,
        branchId: "11111111",
        clientId: "e2e-client",
        clientSecret: "e2e-client-secret",
        cloudId: "cloud-id",
        employeeId: "22222222",
        refreshToken: "e2e-refresh-token",
      },
      expectedCurrency: "CZK",
      nexiApiOrigin: "https://xpaysandbox.nexigroup.com",
      timeouts: workspaceE2ETimeouts,
    };

    await Effect.runPromise(
      waitForCancelledDotyposReservations(config, [reservationId], interval)
    );

    // The adapter polled the active-overlap listing until the target left it.
    expect(listCalls.length).toBeGreaterThanOrEqual(2);
    for (const url of listCalls) {
      expect(url.searchParams.get("filter")).toBe(
        [
          "status|in|NEW,CONFIRMED",
          `startDate|lt|${interval.endDate.getTime()}`,
          `endDate|gt|${interval.startDate.getTime()}`,
        ].join(";")
      );
    }

    // The broad reader is never used: no unfiltered reservation listing and
    // no per-reservation reads — only the token endpoint and the overlap list.
    expect(
      requestPaths.every(
        (path) =>
          path === "POST /signin/token" ||
          path === "GET /clouds/cloud-id/reservations"
      )
    ).toBe(true);
  } finally {
    server.stop(true);
  }
}, 20_000);

test("waits for a customer discount-group change to become readable", async () => {
  let reads = 0;
  const discountGroupId = DotyposDiscountGroupIdSchema.make("group-id");
  const customer = await Effect.runPromise(
    waitForDotyposCustomerDiscountGroup(
      Effect.sync(() => {
        reads += 1;
        return {
          _discountGroupId: reads < 3 ? null : discountGroupId,
        };
      }),
      discountGroupId,
      { intervalMs: 1, timeoutMs: 500 }
    )
  );

  expect(customer._discountGroupId).toBe("group-id");
  expect(reads).toBe(3);
});

test("waits for a removed customer discount group to become readable", async () => {
  let reads = 0;
  const discountGroupId = DotyposDiscountGroupIdSchema.make("group-id");
  const customer = await Effect.runPromise(
    waitForDotyposCustomerDiscountGroup(
      Effect.sync(() => {
        reads += 1;
        return {
          _discountGroupId: reads < 2 ? discountGroupId : null,
        };
      }),
      null,
      { intervalMs: 1, timeoutMs: 500 }
    )
  );

  expect(customer._discountGroupId).toBeNull();
  expect(reads).toBe(2);
});

test("matches ISO Dotypos timestamps to the selected meeting-room instant", () => {
  expect(
    dotyposTimestampMatches("2099-09-01T08:00:00.000Z", "2099-09-01T08:00:00Z")
  ).toBe(true);
  expect(
    dotyposTimestampMatches("2099-09-01T09:00:00.000Z", "2099-09-01T08:00:00Z")
  ).toBe(false);
});

test("matches epoch-millisecond Dotypos timestamps", () => {
  const expected = "2099-09-01T08:00:00Z";

  expect(
    dotyposTimestampMatches(String(new Date(expected).getTime()), expected)
  ).toBe(true);
});
