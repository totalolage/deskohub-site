import "@/shared/testing/workspace-test-env";
import { describe, expect, test } from "bun:test";
import { ExternalAPIError } from "@deskohub/dotypos";
import { DotyposServiceMock } from "@deskohub/dotypos/backend/service.mock";
import { Effect, Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { AdministrationService } from "./administration.service";
import { PaymentAdministrationServiceMock } from "./payment-administration.service.mock";
import { PostHogReservationHistory } from "./posthog-reservation-history";

const makeQuery = <A>(rows: readonly A[]) => {
  const builder = {
    from: () => builder,
    innerJoin: () => builder,
    limit: () => Effect.succeed(rows),
    orderBy: () => builder,
    where: () => builder,
  };
  return builder;
};

describe("AdministrationService", () => {
  test("returns no booking when Dotypos reports it missing", async () => {
    const result = await Effect.gen(function* () {
      const administration = yield* AdministrationService;
      return yield* administration.loadBooking("missing-booking");
    }).pipe(
      Effect.provide(
        AdministrationService.Live.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(
                WorkspaceDatabase,
                WorkspaceDatabase.of({ db: {} as never })
              ),
              DotyposServiceMock({
                getReservation: () =>
                  Effect.fail(
                    new ExternalAPIError({
                      service: "Dotypos",
                      operation: "getReservation",
                      statusCode: 404,
                    })
                  ),
                getTables: () => Effect.succeed([]),
              }),
              Layer.succeed(
                PostHogReservationHistory,
                PostHogReservationHistory.of({
                  load: () => Effect.succeed({ kind: "unavailable" } as const),
                })
              ),
              PaymentAdministrationServiceMock({})
            )
          )
        )
      ),
      Effect.runPromise
    );

    expect(result).toBeNull();
  });

  test("loads customer marketing consent without a reservation", async () => {
    const grantedAt = Temporal.Instant.from("2026-08-09T10:00:00Z");
    const withdrawnAt = Temporal.Instant.from("2026-08-10T11:00:00Z");
    const rows = [
      [],
      [],
      [
        {
          documentHash: "marketing-document-hash",
          grantedAt,
          locale: "en-US" as const,
          withdrawnAt,
        },
      ],
    ] as const;
    let selectCall = 0;
    const database = {
      select: () => makeQuery(rows[selectCall++] ?? []),
    };

    const result = await Effect.gen(function* () {
      const administration = yield* AdministrationService;
      return yield* administration.loadCustomerActivity("dotypos-customer");
    }).pipe(
      Effect.provide(
        AdministrationService.Live.pipe(
          Layer.provide(
            Layer.mergeAll(
              Layer.succeed(
                WorkspaceDatabase,
                WorkspaceDatabase.of({ db: database as never })
              ),
              DotyposServiceMock({}),
              Layer.succeed(
                PostHogReservationHistory,
                PostHogReservationHistory.of({
                  load: () => Effect.succeed({ kind: "unavailable" } as const),
                })
              ),
              PaymentAdministrationServiceMock({})
            )
          )
        )
      ),
      Effect.runPromise
    );

    expect(selectCall).toBe(3);
    expect(result.reservations).toEqual([]);
    expect(result.marketingConsent).toEqual({
      documentHash: "marketing-document-hash",
      grantedAt: grantedAt.toString(),
      locale: "en-US",
      withdrawnAt: withdrawnAt.toString(),
    });
  });
});
