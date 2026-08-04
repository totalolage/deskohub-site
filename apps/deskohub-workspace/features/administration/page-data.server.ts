import "server-only";

import { Effect } from "effect";
import { notFound } from "next/navigation";
import { cache } from "react";
import { requireDiscountAdminAuthorization } from "@/features/discounts/admin/basic-auth.server";
import { getCurrentPragueDate } from "@/features/reservation/reservation-date";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";
import { AdministrationLive } from "./administration.runtime";
import {
  type AdministrationReservationListInput,
  AdministrationService,
} from "./administration.service";
import {
  administrationFixturesEnabled,
  loadFixtureBooking,
  loadFixtureBookings,
  loadFixtureCustomerReservations,
  loadFixtureCustomers,
  loadFixtureOverview,
  loadFixtureReservation,
  loadFixtureReservations,
} from "./fixtures";

export type AdministrationSearchParams = Promise<
  Record<string, string | readonly string[] | undefined>
>;

const firstParam = (value: string | readonly string[] | undefined) =>
  typeof value === "string" ? value : value?.[0];

const parsePage = (value: string | undefined) => {
  const page = Number(value);
  return Number.isSafeInteger(page) && page > 0 ? page : 1;
};

const parseDate = (value: string | undefined) => {
  if (!value) return getCurrentPragueDate();
  try {
    return Temporal.PlainDate.from(value).toString();
  } catch {
    return getCurrentPragueDate();
  }
};

const parseStatus = (
  value: string | undefined
): AdministrationReservationListInput["status"] =>
  value === "in_progress" || value === "complete" || value === "cancelled"
    ? value
    : undefined;

const runAdministration =
  (operation: string) =>
  <A, E>(effect: Effect.Effect<A, E, AdministrationService>) =>
    effect.pipe(
      Effect.provide(AdministrationLive),
      runWorkspaceEffect(operation, { boundary: "route" })
    );

export const authorizeAdministrationPage = async () => {
  if (administrationFixturesEnabled()) return;
  const authorized = await requireDiscountAdminAuthorization().pipe(
    Effect.as(true),
    Effect.catchTag("DiscountAdminUnauthorizedError", () =>
      Effect.succeed(false)
    ),
    runWorkspaceEffect("administration.authorize", { boundary: "route" })
  );
  if (!authorized) notFound();
};

export const loadAdministrationOverview = async () => {
  await authorizeAdministrationPage();
  if (administrationFixturesEnabled()) return loadFixtureOverview();
  return Effect.gen(function* () {
    const administration = yield* AdministrationService;
    return yield* administration.loadOverview();
  }).pipe(runAdministration("administration.overview"));
};

export const loadAdministrationReservations = async (
  searchParams: AdministrationSearchParams
) => {
  await authorizeAdministrationPage();
  const params = await searchParams;
  const typeValue = firstParam(params.type);
  const input: AdministrationReservationListInput = {
    customerId: firstParam(params.customerId),
    date: firstParam(params.date),
    page: parsePage(firstParam(params.page)),
    status: parseStatus(firstParam(params.status)),
    type:
      typeValue === "cowork" || typeValue === "meeting-room"
        ? typeValue
        : undefined,
  };
  if (administrationFixturesEnabled()) {
    return { input, result: loadFixtureReservations(input) };
  }
  const result = await Effect.gen(function* () {
    const administration = yield* AdministrationService;
    return yield* administration.listReservations(input);
  }).pipe(runAdministration("administration.reservations"));
  return { input, result };
};

export const loadAdministrationReservation = cache(async (id: string) => {
  await authorizeAdministrationPage();
  if (administrationFixturesEnabled()) {
    const fixture = loadFixtureReservation(id);
    if (!fixture) notFound();
    return fixture;
  }
  const detail = await Effect.gen(function* () {
    const administration = yield* AdministrationService;
    return yield* administration.loadReservation(id);
  }).pipe(runAdministration("administration.reservation"));
  if (!detail) notFound();
  return detail;
});

export const loadAdministrationBookings = async (
  searchParams: AdministrationSearchParams
) => {
  await authorizeAdministrationPage();
  const params = await searchParams;
  const input = {
    date: parseDate(firstParam(params.date)),
    page: parsePage(firstParam(params.page)),
  };
  if (administrationFixturesEnabled()) {
    return { input, result: loadFixtureBookings(input) };
  }
  const result = await Effect.gen(function* () {
    const administration = yield* AdministrationService;
    return yield* administration.listBookings(input);
  }).pipe(runAdministration("administration.bookings"));
  return { input, result };
};

export const loadAdministrationBooking = cache(async (id: string) => {
  await authorizeAdministrationPage();
  if (administrationFixturesEnabled()) {
    const fixture = loadFixtureBooking(id);
    if (!fixture) notFound();
    return fixture;
  }
  return Effect.gen(function* () {
    const administration = yield* AdministrationService;
    return yield* administration.loadBooking(id);
  }).pipe(runAdministration("administration.booking"));
});

export const loadAdministrationCustomers = async (
  searchParams: AdministrationSearchParams
) => {
  await authorizeAdministrationPage();
  const params = await searchParams;
  if (administrationFixturesEnabled()) return loadFixtureCustomers();
  return Effect.gen(function* () {
    const administration = yield* AdministrationService;
    return yield* administration.listCustomers({
      page: parsePage(firstParam(params.page)),
    });
  }).pipe(runAdministration("administration.customers"));
};

export const loadAdministrationCustomerReservations = async (
  customerId: string,
  searchParams: AdministrationSearchParams
) => {
  await authorizeAdministrationPage();
  const params = await searchParams;
  const page = parsePage(firstParam(params.reservationsPage));
  if (administrationFixturesEnabled()) {
    return loadFixtureCustomerReservations(customerId, page);
  }
  return Effect.gen(function* () {
    const administration = yield* AdministrationService;
    return yield* administration.loadCustomerReservations({ customerId, page });
  }).pipe(runAdministration("administration.customer-reservations"));
};
