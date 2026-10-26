import "@/shared/testing/workspace-test-env";
import { describe, expect, mock, test } from "bun:test";
import { DotyposUnavailable } from "@deskohub/dotypos";
import { testEmailAddress } from "@deskohub/test-email";
import { Effect, Layer, Schema } from "effect";
import {
  buildSignedPayState,
  sealPayState,
} from "@/features/checkout/backend/checkout/pay-state";
import { ReservationSupersessionService } from "@/features/checkout/backend/checkout/reservation-supersession.service";
import { buildCoworkReservationQuote } from "@/features/checkout/reservation-quote-cowork";
import type { SupersedableReservation } from "@/features/reservation/backend/reservation-supersession";
import { normalizedCoworkReservationOrderSchema } from "@/features/reservation/cowork-reservation";
import type {
  WorkspaceAvailability,
  WorkspaceAvailabilityQuery,
} from "@/features/reservation/workspace-availability";
import { instantStringSchema } from "@/shared/utils/temporal";
import {
  type IWorkspaceAvailabilityService,
  WorkspaceAvailabilityService,
} from "./workspace-availability.service";
import {
  loadAvailability,
  preloadAvailability,
} from "./workspace-availability-loader";

const coworkQuery = {
  kind: "cowork",
  from: "2099-06-20",
  to: "2099-06-20",
  entryTier: "open-space",
  date: "2099-06-20",
} satisfies WorkspaceAvailabilityQuery;
const officeQuery = {
  kind: "office",
  from: "2099-06-20",
  to: "2099-07-20",
} satisfies WorkspaceAvailabilityQuery;
const failingQuery = {
  ...coworkQuery,
  entryTier: "reserved-desk",
} satisfies WorkspaceAvailabilityQuery;
const defectQuery = {
  ...coworkQuery,
  from: "2099-06-19",
} satisfies WorkspaceAvailabilityQuery;

const availabilityFor = (
  query: WorkspaceAvailabilityQuery
): WorkspaceAvailability => ({
  from: query.from,
  to: query.to,
  unavailableDates: [],
  reservedDeskWorkstationRequiredDates: [],
  unavailableCoworkTiers: [],
  meetingRoomUnavailable: false,
  officeUnavailable: false,
  unavailableMonitorOptions: [],
  notices: [],
});

const getAvailability = mock<IWorkspaceAvailabilityService["getAvailability"]>(
  (input) => {
    if (input.query === failingQuery) {
      return Effect.fail(
        new DotyposUnavailable({
          operation: "listActiveReservationsOverlapping",
          reason: "transport",
        })
      );
    }
    if (input.query === defectQuery) return Effect.die(new Error("defect"));
    return Effect.succeed(availabilityFor(input.query));
  }
);
const findCurrent = mock(
  (_input: { readonly orderId: string; readonly checkoutSessionId?: string }) =>
    Effect.succeed({
      dotyposReservationId: "dotypos-reservation-1",
    } as SupersedableReservation)
);

const testLayer = Layer.mergeAll(
  Layer.succeed(WorkspaceAvailabilityService, {
    getAvailability,
    ensureAvailable: () => Effect.void,
  }),
  Layer.succeed(ReservationSupersessionService, { findCurrent })
);

const run = <A, E>(
  effect: Effect.Effect<
    A,
    E,
    WorkspaceAvailabilityService | ReservationSupersessionService
  >
) => {
  getAvailability.mockClear();
  findCurrent.mockClear();
  return Effect.runPromise(effect.pipe(Effect.provide(testLayer)));
};

const replacementToken = await Effect.runPromise(
  Effect.gen(function* () {
    const reservation = Schema.decodeUnknownSync(
      normalizedCoworkReservationOrderSchema
    )({
      kind: "cowork",
      entryTier: "open-space",
      date: "2099-06-20",
      coffee: false,
      name: "Ada Lovelace",
      email: testEmailAddress("ada"),
      phone: "+420777000111",
    });
    const state = yield* buildSignedPayState({
      locale: "en-US",
      reservation,
      quote: yield* buildCoworkReservationQuote({
        kind: "cowork",
        entryTier: reservation.entryTier,
        date: reservation.date,
        coffee: reservation.coffee,
      }),
      orderId: "reservation-id",
      bookedAt: Schema.decodeUnknownSync(instantStringSchema)(
        "2099-06-01T10:00:00Z"
      ),
      checkoutSessionId: "session-id",
    });
    return yield* sealPayState(state);
  })
);

const exclusion = { dotyposReservationId: "dotypos-reservation-1" };

describe("loadAvailability", () => {
  test("excludes the verified current hold of a same-kind replacement", async () => {
    await run(loadAvailability({ query: coworkQuery, replacementToken }));

    expect(findCurrent.mock.calls).toEqual([
      [{ orderId: "reservation-id", checkoutSessionId: "session-id" }],
    ]);
    expect(getAvailability.mock.calls).toEqual([
      [{ query: coworkQuery, occupancyExclusion: exclusion }],
    ]);
  });

  test("ignores a replacement for another reservation kind", async () => {
    await run(loadAvailability({ query: officeQuery, replacementToken }));

    expect(findCurrent).not.toHaveBeenCalled();
    expect(getAvailability.mock.calls).toEqual([
      [{ query: officeQuery, occupancyExclusion: undefined }],
    ]);
  });

  test("loads ordinary availability while the replacement lookup is unavailable", async () => {
    findCurrent.mockImplementationOnce(() =>
      Effect.fail(
        new DotyposUnavailable({
          operation: "getReservation",
          reason: "transport",
        })
      )
    );

    await run(loadAvailability({ query: coworkQuery, replacementToken }));

    expect(getAvailability.mock.calls).toEqual([
      [{ query: coworkQuery, occupancyExclusion: undefined }],
    ]);
  });

  test("ignores an unverifiable replacement token", async () => {
    await run(
      loadAvailability({ query: coworkQuery, replacementToken: "forged" })
    );

    expect(findCurrent).not.toHaveBeenCalled();
    expect(getAvailability.mock.calls).toEqual([
      [{ query: coworkQuery, occupancyExclusion: undefined }],
    ]);
  });
});

describe("preloadAvailability", () => {
  test("verifies the replacement once and omits queries that fail", async () => {
    const before = Date.now();
    const preloaded = await run(
      preloadAvailability({
        queries: [coworkQuery, failingQuery, defectQuery],
        replacementToken,
      })
    );

    expect(findCurrent).toHaveBeenCalledTimes(1);
    expect(getAvailability.mock.calls.map(([input]) => input)).toEqual([
      { query: coworkQuery, occupancyExclusion: exclusion },
      { query: failingQuery, occupancyExclusion: exclusion },
      { query: defectQuery, occupancyExclusion: exclusion },
    ]);
    expect(preloaded).toEqual([
      {
        query: coworkQuery,
        availability: availabilityFor(coworkQuery),
        loadedAt: expect.any(Number),
      },
    ]);
    expect(preloaded[0]?.loadedAt).toBeGreaterThanOrEqual(before);
  });

  test("leaves every query to the client while the replacement lookup is unavailable", async () => {
    findCurrent.mockImplementationOnce(() =>
      Effect.fail(
        new DotyposUnavailable({
          operation: "getReservation",
          reason: "transport",
        })
      )
    );

    const preloaded = await run(
      preloadAvailability({ queries: [coworkQuery], replacementToken })
    );

    expect(findCurrent).toHaveBeenCalledTimes(1);
    expect(preloaded).toEqual([]);
    expect(getAvailability).not.toHaveBeenCalled();
  });

  test("loads ordinary availability without a replacement", async () => {
    const preloaded = await run(
      preloadAvailability({ queries: [officeQuery] })
    );

    expect(findCurrent).not.toHaveBeenCalled();
    expect(preloaded.map(({ query }) => query)).toEqual([officeQuery]);
  });
});
