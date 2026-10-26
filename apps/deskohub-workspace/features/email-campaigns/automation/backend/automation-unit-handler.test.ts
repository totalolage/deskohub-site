import { describe, expect, test } from "bun:test";
import {
  ExternalAPIError,
  NetworkError,
  ValidationError,
} from "@deskohub/dotypos";
import {
  InvalidDotyposReservationInterval,
  ReservationVisitsUnavailable,
  UnexpectedDotyposReservationPage,
} from "@/features/reservation/backend/reservation-visits.service";
import { AutomationUnitFetchFailure } from "./automation-unit-handler";

describe("AutomationUnitFetchFailure.fromReservationVisits", () => {
  test.each([
    {
      cause: new ExternalAPIError({
        service: "Dotypos",
        operation: "listReservationsPage",
        message: "synthetic",
        statusCode: 429,
      }),
      code: "dotypos-429",
    },
    {
      cause: new ExternalAPIError({
        service: "Dotypos",
        operation: "listReservationsPage",
        message: "synthetic",
      }),
      code: "dotypos-error",
    },
    {
      cause: new NetworkError({ message: "synthetic" }),
      code: "dotypos-network",
    },
    {
      cause: new ValidationError({ message: "synthetic" }),
      code: "dotypos-invalid-response",
    },
    {
      cause: new UnexpectedDotyposReservationPage({ message: "synthetic" }),
      code: "dotypos-502",
    },
    {
      cause: new InvalidDotyposReservationInterval({ message: "synthetic" }),
      code: "dotypos-invalid-response",
    },
  ])("stores $code for a $cause._tag cause", ({ cause, code }) => {
    const unavailable = new ReservationVisitsUnavailable({ cause });

    expect(
      AutomationUnitFetchFailure.fromReservationVisits(unavailable)
    ).toMatchObject({ code, cause: unavailable });
  });
});
