/// <reference path="./page-data.server.rsc-fixture.d.ts" />

import "@/shared/testing/workspace-test-env";

import { afterAll, afterEach, describe, expect, mock, test } from "bun:test";
import { Effect, Layer } from "effect";
import { renderToReadableStream } from "next/dist/compiled/react-server-dom-webpack/server.edge";
import React, { Suspense } from "react";
import type {
  AdministrationOverview,
  AdministrationOverviewSource,
  AdministrationService as AdministrationServiceType,
} from "./administration.service";

mock.module("server-only", () => ({}));
mock.module("next/navigation", () => ({
  notFound: () => {},
  unstable_rethrow: () => {},
}));

let authorized = true;
let authorizationCalls = 0;
let sourceCalls = 0;
let overviewCalls = 0;
let blockedOverview: Promise<AdministrationOverview> | null = null;

const source = {
  currentDate: Temporal.PlainDate.from("2026-08-11"),
  ranges: {
    today: { from: "2026-08-11", to: "2026-08-11" },
    upcoming: { from: "2026-08-12", to: "2026-09-10" },
    lastSevenDays: { from: "2026-08-05", to: "2026-08-11" },
  },
  reservations: { kind: "unavailable" as const },
  rows: [],
} satisfies AdministrationOverviewSource;

const unavailableMetric = {
  completed: 0,
  unavailable: true,
  value: 0,
} satisfies AdministrationOverview["today"];
const customerOverview = {
  ...{
    ranges: source.ranges,
    today: unavailableMetric,
    upcoming: unavailableMetric,
    lastSevenDays: unavailableMetric,
  },
  uniqueCustomers: { customers: [], unavailable: true, value: 0 },
  newCustomers: { customers: [], unavailable: true, value: 0 },
} satisfies AdministrationOverview;

const { AdministrationService } = await import("./administration.service");
const originalLive = AdministrationService.Live;
const unused = (..._args: readonly unknown[]) => Effect.die("not expected");
AdministrationService.Live = Layer.succeed(AdministrationService, {
  loadOverviewSource: () =>
    Effect.sync(() => {
      sourceCalls += 1;
      return source;
    }),
  loadOverview: () =>
    Effect.promise(() => {
      overviewCalls += 1;
      return blockedOverview ?? Promise.resolve(customerOverview);
    }),
  listReservations: unused,
  loadReservation: unused,
  loadReservationBreadcrumbLabel: unused,
  findReservationId: unused,
  listBookings: unused,
  loadBooking: unused,
  loadBookingBreadcrumb: unused,
  listCustomers: unused,
  loadCustomerReservations: unused,
  loadCustomerActivity: unused,
  loadCustomerReservationActivity: unused,
  listOrders: unused,
  loadOrder: unused,
  listOperations: unused,
  loadOperation: unused,
} satisfies AdministrationServiceType["Service"]);

mock.module(
  "@/shared/administrator/administrator-authorization.server",
  () => ({
    authorizeAdministratorPage: async () => {
      authorizationCalls += 1;
      if (!authorized) throw new Error("unauthorized");
    },
  })
);
const renderRequest = async () => {
  const { loadAdministrationOverview, loadAdministrationReservationOverview } =
    await import("./page-data.server");

  let reservationSettled!: () => void;
  const reservationReady = new Promise<void>((resolve) => {
    reservationSettled = resolve;
  });

  const Reservation = async () => {
    const value = await loadAdministrationReservationOverview();
    reservationSettled();
    return React.createElement("span", null, JSON.stringify(value));
  };
  const Customer = async () =>
    React.createElement(
      "span",
      null,
      JSON.stringify(await loadAdministrationOverview())
    );
  const Page = () =>
    React.createElement(
      React.Fragment,
      null,
      React.createElement(
        Suspense,
        { fallback: "reservation-loading" },
        React.createElement(Reservation)
      ),
      React.createElement(
        Suspense,
        { fallback: "customer-loading" },
        React.createElement(Customer)
      )
    );

  const stream = renderToReadableStream(React.createElement(Page), {});
  return { reservationReady, stream };
};

describe("administration overview page data RSC fixture", () => {
  afterEach(() => {
    authorized = true;
    authorizationCalls = 0;
    sourceCalls = 0;
    overviewCalls = 0;
    blockedOverview = null;
  });
  afterAll(() => {
    AdministrationService.Live = originalLive;
  });

  test("shares one source in a request while keeping reservation rendering independent", async () => {
    let releaseCustomer!: (value: AdministrationOverview) => void;
    blockedOverview = new Promise((resolve) => {
      releaseCustomer = resolve;
    });

    const { reservationReady, stream } = await renderRequest();
    await new Promise((resolve) => setImmediate(resolve));
    expect(sourceCalls).toBe(1);
    expect(overviewCalls).toBe(1);
    await reservationReady;
    expect(sourceCalls).toBe(1);

    releaseCustomer(customerOverview);
    const html = await new Response(stream).text();
    expect(html).toContain("2026-08-11");
    expect(html).toContain('\\"unavailable\\":true');
    expect(html).toContain('\\"uniqueCustomers\\":');
  });

  test("loads a fresh source for another request", async () => {
    const first = await renderRequest();
    await new Response(first.stream).text();
    const second = await renderRequest();
    await new Response(second.stream).text();

    expect(sourceCalls).toBe(2);
    expect(authorizationCalls).toBe(2);
  });

  test("does not access the service when authorization fails", async () => {
    authorized = false;
    const { stream } = await renderRequest();

    await new Response(stream).text();
    expect(sourceCalls).toBe(0);
    expect(overviewCalls).toBe(0);
  });
});

process.stdout.write("RSC_PAGE_DATA_REQUEST_SHARING_PROOF\n");
