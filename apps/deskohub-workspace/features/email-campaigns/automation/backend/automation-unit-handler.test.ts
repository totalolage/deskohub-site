import { describe, expect, test } from "bun:test";
import {
  type DotyposReadFailure,
  DotyposRejected,
  DotyposUnavailable,
} from "@deskohub/dotypos";
import {
  InvalidDotyposReservationInterval,
  ReservationVisitsUnavailable,
} from "@/features/reservation/backend/reservation-visits.service";
import { AutomationUnitFetchFailure } from "./automation-unit-handler";

/**
 * Each row is an input automation's Dotypos reads (`getCustomersByIds`, and
 * `listReservationsPage` through reservation visits) can meet, the outcome the
 * package builds for it (its service tests prove the input → outcome step),
 * and the `last_error_code` stored for it: the outcome's Dotypos failure code.
 */
const codeRows: ReadonlyArray<{
  readonly input: string;
  readonly cause: DotyposReadFailure;
  readonly code: string;
}> = [
  {
    input: "HTTP 503",
    cause: new DotyposUnavailable({
      operation: "getCustomersByIds",
      request: "customers.page",
      reason: "server",
      httpStatus: 503,
    }),
    code: "dotypos-unavailable",
  },
  {
    input: "HTTP 500",
    cause: new DotyposUnavailable({
      operation: "listReservationsPage",
      request: "reservations.page",
      reason: "server",
      httpStatus: 500,
    }),
    code: "dotypos-unavailable",
  },
  {
    input: "HTTP 429",
    cause: new DotyposUnavailable({
      operation: "listReservationsPage",
      request: "reservations.page",
      reason: "rate-limited",
      httpStatus: 429,
    }),
    code: "dotypos-unavailable",
  },
  {
    input: "access-token HTTP 503",
    cause: new DotyposUnavailable({
      operation: "getCustomersByIds",
      request: "customers.page",
      reason: "server",
      httpStatus: 503,
    }),
    code: "dotypos-unavailable",
  },
  {
    input: "transport failure",
    cause: new DotyposUnavailable({
      operation: "getCustomersByIds",
      request: "customers.page",
      reason: "transport",
    }),
    code: "dotypos-unavailable",
  },
  {
    input: "request timeout",
    cause: new DotyposUnavailable({
      operation: "listReservationsPage",
      request: "reservations.page",
      reason: "timeout",
    }),
    code: "dotypos-unavailable",
  },
  {
    input: "HTTP 401",
    cause: new DotyposRejected({
      operation: "getCustomersByIds",
      request: "customers.page",
      reason: "unauthorized",
      httpStatus: 401,
    }),
    code: "dotypos-rejected",
  },
  {
    input: "access-token HTTP 404",
    cause: new DotyposRejected({
      operation: "getCustomersByIds",
      request: "customers.page",
      reason: "unauthorized",
      httpStatus: 404,
    }),
    code: "dotypos-rejected",
  },
  {
    input: "HTTP 400",
    cause: new DotyposRejected({
      operation: "listReservationsPage",
      request: "reservations.page",
      reason: "invalid-request",
      httpStatus: 400,
    }),
    code: "dotypos-rejected",
  },
  {
    input: "id-filter validation before any request",
    cause: new DotyposRejected({
      operation: "getCustomersByIds",
      reason: "invalid-request",
    }),
    code: "dotypos-rejected",
  },
  {
    input: "malformed entity identifiers",
    cause: new DotyposRejected({
      operation: "getCustomersByIds",
      request: "customers.page",
      reason: "invalid-response",
    }),
    code: "dotypos-rejected",
  },
  {
    input: "id-filtered page reporting another page",
    cause: new DotyposRejected({
      operation: "getCustomersByIds",
      request: "customers.page",
      reason: "invalid-response",
    }),
    code: "dotypos-rejected",
  },
  {
    input: "invalid next-page metadata",
    cause: new DotyposRejected({
      operation: "listReservationsPage",
      request: "reservations.page",
      reason: "invalid-response",
    }),
    code: "dotypos-rejected",
  },
  {
    input: "malformed list page",
    cause: new DotyposRejected({
      operation: "listReservationsPage",
      request: "reservations.page",
      reason: "invalid-response",
    }),
    code: "dotypos-rejected",
  },
  {
    input: "generated schema decode failure",
    cause: new DotyposRejected({
      operation: "getCustomersByIds",
      request: "customers.page",
      reason: "invalid-response",
    }),
    code: "dotypos-rejected",
  },
  {
    input: "unreadable 2xx body",
    cause: new DotyposRejected({
      operation: "getCustomersByIds",
      request: "customers.page",
      reason: "invalid-response",
      httpStatus: 200,
    }),
    code: "dotypos-rejected",
  },
];

describe("AutomationUnitFetchFailure.fromDotypos", () => {
  test.each(codeRows)("stores $code for $input", ({ cause, code }) => {
    expect(AutomationUnitFetchFailure.fromDotypos(cause)).toMatchObject({
      code,
      cause,
    });
  });
});

describe("AutomationUnitFetchFailure.fromReservationVisits", () => {
  test.each([
    ...codeRows,
    {
      input: "an id-filtered reservation page reporting another page",
      cause: new DotyposRejected({
        operation: "getReservationsByIds",
        reason: "invalid-response",
      }),
      code: "dotypos-rejected",
    },
    {
      input: "an invalid reservation interval",
      cause: new InvalidDotyposReservationInterval({ message: "synthetic" }),
      code: "dotypos-rejected",
    },
  ])("stores $code for $input", ({ cause, code }) => {
    const unavailable = new ReservationVisitsUnavailable({ cause });

    expect(
      AutomationUnitFetchFailure.fromReservationVisits(unavailable)
    ).toMatchObject({ code, cause: unavailable });
  });
});
