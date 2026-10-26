import { describe, expect, test } from "bun:test";
import {
  type DotyposReadFailure,
  DotyposRejected,
  DotyposUnavailable,
} from "@deskohub/dotypos";
import {
  InvalidDotyposReservationInterval,
  ReservationVisitsUnavailable,
  UnexpectedDotyposReservationPage,
} from "@/features/reservation/backend/reservation-visits.service";
import { AutomationUnitFetchFailure } from "./automation-unit-handler";

/**
 * Each row is an input automation's Dotypos reads (`getCustomersPage`, and
 * `listReservationsPage` through reservation visits) can meet, the outcome the
 * package builds for it (its service tests prove the input → outcome step),
 * and the `last_error_code` stored for that input before the outcome tags.
 */
const legacyCodeRows: ReadonlyArray<{
  readonly input: string;
  readonly cause: DotyposReadFailure;
  readonly code: string;
}> = [
  {
    input: "HTTP 503",
    cause: new DotyposUnavailable({
      operation: "getCustomersPage",
      request: "customers.page",
      reason: "server",
      httpStatus: 503,
    }),
    code: "dotypos-503",
  },
  {
    input: "HTTP 500",
    cause: new DotyposUnavailable({
      operation: "listReservationsPage",
      request: "reservations.page",
      reason: "server",
      httpStatus: 500,
    }),
    code: "dotypos-500",
  },
  {
    input: "HTTP 429",
    cause: new DotyposUnavailable({
      operation: "listReservationsPage",
      request: "reservations.page",
      reason: "rate-limited",
      httpStatus: 429,
    }),
    code: "dotypos-429",
  },
  {
    input: "access-token HTTP 503",
    cause: new DotyposUnavailable({
      operation: "getCustomersPage",
      request: "customers.page",
      reason: "server",
      httpStatus: 503,
    }),
    code: "dotypos-503",
  },
  {
    input: "transport failure",
    cause: new DotyposUnavailable({
      operation: "getCustomersPage",
      request: "customers.page",
      reason: "transport",
    }),
    code: "dotypos-network",
  },
  {
    input: "request timeout",
    cause: new DotyposUnavailable({
      operation: "listReservationsPage",
      request: "reservations.page",
      reason: "timeout",
    }),
    code: "dotypos-network",
  },
  {
    input: "HTTP 401",
    cause: new DotyposRejected({
      operation: "getCustomersPage",
      request: "customers.page",
      reason: "unauthorized",
      httpStatus: 401,
    }),
    code: "dotypos-401",
  },
  {
    input: "access-token HTTP 404",
    cause: new DotyposRejected({
      operation: "getCustomersPage",
      request: "customers.page",
      reason: "unauthorized",
      httpStatus: 404,
    }),
    code: "dotypos-404",
  },
  {
    input: "HTTP 400",
    cause: new DotyposRejected({
      operation: "listReservationsPage",
      request: "reservations.page",
      reason: "invalid-request",
      httpStatus: 400,
    }),
    code: "dotypos-400",
  },
  {
    input: "id-filter validation before any request",
    cause: new DotyposRejected({
      operation: "getCustomersPage",
      reason: "invalid-request",
    }),
    code: "dotypos-invalid-response",
  },
  {
    input: "malformed entity identifiers (synthetic 502)",
    cause: new DotyposRejected({
      operation: "getCustomersPage",
      request: "customers.page",
      reason: "invalid-response",
      httpStatus: 502,
    }),
    code: "dotypos-502",
  },
  {
    input: "id-filtered page reporting another page (synthetic 502)",
    cause: new DotyposRejected({
      operation: "getCustomersPage",
      request: "customers.page",
      reason: "invalid-response",
      httpStatus: 502,
    }),
    code: "dotypos-502",
  },
  {
    input: "invalid next-page metadata (synthetic 502)",
    cause: new DotyposRejected({
      operation: "listReservationsPage",
      request: "reservations.page",
      reason: "invalid-response",
      httpStatus: 502,
    }),
    code: "dotypos-502",
  },
  {
    input: "malformed list page",
    cause: new DotyposRejected({
      operation: "listReservationsPage",
      request: "reservations.page",
      reason: "invalid-response",
    }),
    code: "dotypos-error",
  },
  {
    input: "generated schema decode failure",
    cause: new DotyposRejected({
      operation: "getCustomersPage",
      request: "customers.page",
      reason: "invalid-response",
    }),
    code: "dotypos-error",
  },
  {
    input: "unreadable 2xx body",
    cause: new DotyposRejected({
      operation: "getCustomersPage",
      request: "customers.page",
      reason: "invalid-response",
      httpStatus: 200,
    }),
    code: "dotypos-200",
  },
];

describe("AutomationUnitFetchFailure.fromDotypos", () => {
  test.each(legacyCodeRows)("stores $code for $input", ({ cause, code }) => {
    expect(AutomationUnitFetchFailure.fromDotypos(cause)).toMatchObject({
      code,
      cause,
    });
  });
});

describe("AutomationUnitFetchFailure.fromReservationVisits", () => {
  test.each([
    ...legacyCodeRows,
    {
      input: "an id-filtered reservation page reporting another page",
      cause: new UnexpectedDotyposReservationPage({ message: "synthetic" }),
      code: "dotypos-502",
    },
    {
      input: "an invalid reservation interval",
      cause: new InvalidDotyposReservationInterval({ message: "synthetic" }),
      code: "dotypos-invalid-response",
    },
  ])("stores $code for $input", ({ cause, code }) => {
    const unavailable = new ReservationVisitsUnavailable({ cause });

    expect(
      AutomationUnitFetchFailure.fromReservationVisits(unavailable)
    ).toMatchObject({ code, cause: unavailable });
  });
});
