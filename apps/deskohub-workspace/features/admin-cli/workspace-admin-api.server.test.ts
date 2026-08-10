import { describe, expect, test } from "bun:test";
import {
  CliAuthenticationChallenge,
  CliAuthenticationCode,
  CliBearerAuthentication,
  CurrentCliSession,
  WorkspaceAdminApi,
} from "@deskohub/workspace-admin-api";
import { NodeHttpServer } from "@effect/platform-node";
import { Effect, Layer, Result, Schema } from "effect";
import { HttpApiTest } from "effect/unstable/httpapi";
import { AdministrationService } from "@/features/administration/administration.service";
import { CliAuthentication } from "./cli-authentication.service";
import { CliAuthenticationAdmission } from "./cli-authentication-admission.service";
import {
  AdminCliApiHandlers,
  AdminCliReadApiHandlers,
} from "./workspace-admin-api.server";

const UnusedCliAuthentication = Layer.succeed(
  CliAuthentication,
  {} as CliAuthentication["Service"]
);
const AllowCliAuthenticationStarts = Layer.succeed(CliAuthenticationAdmission, {
  isStartAllowed: Effect.succeed(true),
});
const session = {
  id: "01980000-0000-7000-8000-000000000000",
  clientName: "test client",
  cliVersion: "1.0.0",
  buildTarget: "development",
  createdAt: "2026-08-10T10:00:00.000Z",
  lastUsedAt: "2026-08-10T10:00:00.000Z",
} as const;
const AuthorizedCliRequest = Layer.succeed(CliBearerAuthentication, {
  bearer: (httpEffect) =>
    Effect.provideService(httpEffect, CurrentCliSession, session),
});

describe("Workspace Admin API", () => {
  test("serves the shared CLI info contract", async () => {
    const info = await Effect.gen(function* () {
      const client = yield* HttpApiTest.groups(WorkspaceAdminApi, ["cli"]);
      return yield* client.cli.getInfo({});
    }).pipe(
      Effect.provide(AdminCliApiHandlers),
      Effect.provide(AuthorizedCliRequest),
      Effect.provide(AllowCliAuthenticationStarts),
      Effect.provide(UnusedCliAuthentication),
      Effect.provide(NodeHttpServer.layerHttpServices),
      Effect.scoped,
      Effect.runPromise
    );

    expect(info).toEqual({
      apiVersion: "v1",
      service: "deskohub-workspace",
    });
  });

  test("bounds unauthenticated authentication starts before database writes", async () => {
    const challenge = Schema.decodeUnknownSync(CliAuthenticationChallenge)(
      "h".repeat(43)
    );
    const code = Schema.decodeUnknownSync(CliAuthenticationCode)(
      "c".repeat(43)
    );
    let starts = 0;
    let admissionChecks = 0;
    const authentication = Layer.succeed(CliAuthentication, {
      ...({} as CliAuthentication["Service"]),
      start: () =>
        Effect.sync(() => {
          starts += 1;
          return {
            code,
            approvalPath: `/admin/cli/authenticate?code=${code}`,
            expiresAt: "2026-08-10T10:00:00.000Z",
          };
        }),
    });
    const admission = Layer.succeed(CliAuthenticationAdmission, {
      isStartAllowed: Effect.sync(() => {
        admissionChecks += 1;
        return admissionChecks <= 10;
      }),
    });

    const results = await Effect.gen(function* () {
      const client = yield* HttpApiTest.groups(WorkspaceAdminApi, ["cli"]);
      return yield* Effect.forEach(
        Array.from({ length: 11 }),
        () =>
          client.cli
            .startAuthentication({
              payload: {
                challenge,
                clientName: "rate limit test",
                cliVersion: "1.0.0",
                buildTarget: "development",
              },
            })
            .pipe(Effect.result),
        { concurrency: 1 }
      );
    }).pipe(
      Effect.provide(AdminCliApiHandlers),
      Effect.provide(AuthorizedCliRequest),
      Effect.provide(admission),
      Effect.provide(authentication),
      Effect.provide(NodeHttpServer.layerHttpServices),
      Effect.scoped,
      Effect.runPromise
    );

    expect(results.filter(Result.isFailure)).toHaveLength(1);
    expect(starts).toBe(10);
  });

  test("invokes the same administration service used by the UI", async () => {
    const reservationInputs: unknown[] = [];
    const administration = Layer.succeed(AdministrationService, {
      loadOverview: () =>
        Effect.succeed({
          today: { unavailable: false, value: 3 },
          upcoming: { unavailable: false, value: 8 },
          lastSevenDays: { unavailable: false, value: 5 },
        }),
      listReservations: (input) =>
        Effect.sync(() => {
          reservationInputs.push(input);
          return {
            items: [],
            page: input.page ?? 1,
            pageCount: 1,
            total: 0,
            dateFilterUnavailable: false,
            dateSortUnavailable: false,
          };
        }),
      loadReservation: () => Effect.die("not used"),
      findReservationId: () => Effect.die("not used"),
      listBookings: () => Effect.die("not used"),
      loadBooking: () => Effect.die("not used"),
      listCustomers: () => Effect.die("not used"),
      loadCustomerReservations: () => Effect.die("not used"),
      loadCustomerActivity: () => Effect.die("not used"),
      listOrders: () => Effect.die("not used"),
      loadOrder: () => Effect.die("not used"),
      listOperations: () => Effect.die("not used"),
      loadOperation: () => Effect.die("not used"),
    } satisfies AdministrationService["Service"]);

    const result = await Effect.gen(function* () {
      const client = yield* HttpApiTest.groups(WorkspaceAdminApi, [
        "administration",
      ]);
      const overview = yield* client.administration.getOverview({});
      const reservations = yield* client.administration.listReservations({
        query: { page: 2, status: "complete" },
      });
      return { overview, reservations };
    }).pipe(
      Effect.provide(AdminCliReadApiHandlers),
      Effect.provide(AuthorizedCliRequest),
      Effect.provide(administration),
      Effect.provide(NodeHttpServer.layerHttpServices),
      Effect.scoped,
      Effect.runPromise
    );

    expect(result.overview.today.value).toBe(3);
    expect(result.reservations.page).toBe(2);
    expect(reservationInputs).toEqual([{ page: 2, status: "complete" }]);
  });
});
