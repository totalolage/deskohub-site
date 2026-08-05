import "../../shared/polyfills/temporal";

import { afterEach, expect, mock, setSystemTime, test } from "bun:test";
import { Cause, Effect, Exit, Layer } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import isEmail from "validator/lib/isEmail";
import { getMeetingRoomReservationInterval } from "@/features/reservation/meeting-room-reservation-time";
import { makeWorkspaceE2EDateAllocation } from "../allocation";
import type { WorkspaceE2EConfig } from "../config";
import { workspaceE2ETimeouts } from "../timeouts";
import {
  makeCoworkCheckoutData,
  makeMeetingRoomCheckoutData,
  reuseCoworkCheckoutContact,
  reuseMeetingRoomCheckoutContact,
  selectAvailableCoworkDates,
  selectAvailableMeetingRoomSlots,
  selectCoworkDates,
} from "./data";

afterEach(() => setSystemTime());

test("does not reuse checkout phone numbers in later monthly runs", () => {
  const makePhoneSet = (now: string) => {
    setSystemTime(new Date(now));

    return new Set(
      Array.from(
        { length: 100 },
        () =>
          makeCoworkCheckoutData("https://workspace.example.com", "2099-09-01")
            .phone
      )
    );
  };

  const julyPhones = makePhoneSet("2099-07-17T09:48:00.000Z");
  const augustPhones = makePhoneSet("2099-08-17T09:48:00.000Z");

  expect(julyPhones.size).toBe(100);
  expect(augustPhones.size).toBe(100);
  expect(julyPhones.intersection(augustPhones).size).toBe(0);
});

test("keeps generated emails valid for the longest checkout flow identifier", () => {
  const data = makeCoworkCheckoutData(
    "https://workspace.example.com",
    "2099-09-01",
    "cowork-reservation-replacement"
  );

  expect(isEmail(data.email)).toBe(true);
  expect(data.email.split("@")[0]?.length).toBeLessThanOrEqual(64);
});

test("builds checkout data from the selected cowork product", () => {
  const data = makeCoworkCheckoutData(
    "https://workspace.example.com",
    "2099-09-01",
    "cowork-plus",
    { entryTier: "plus" }
  );

  expect(new URL(data.checkoutUrl).searchParams.get("entryTier")).toBe("plus");
  expect(data.expectedReservationDetails).toEqual({
    coffee: true,
    entryTier: "plus",
    kind: "cowork",
  });
});

test("keeps its persistence oracle independent of application normalization", () => {
  const basic = makeCoworkCheckoutData(
    "https://workspace.example.com",
    "2099-09-01",
    "cowork-basic-coffee",
    { coffee: true }
  );
  const profi = makeCoworkCheckoutData(
    "https://workspace.example.com",
    "2099-09-02",
    "cowork-profi",
    { entryTier: "profi", monitorOption: "2x32-4k" }
  );

  expect(basic.expectedReservationDetails).toEqual({
    coffee: true,
    entryTier: "basic",
    kind: "cowork",
  });
  expect(profi.expectedReservationDetails).toEqual({
    coffee: true,
    entryTier: "profi",
    kind: "cowork",
    monitorOption: "2x32-4k",
  });
});

test("reuses customer identity for a later reservation", () => {
  const first = makeCoworkCheckoutData(
    "https://workspace.example.com",
    "2099-09-01",
    "first"
  );
  const second = reuseCoworkCheckoutContact(
    "https://workspace.example.com",
    "2099-09-02",
    first
  );

  expect({
    email: second.email,
    name: second.name,
    phone: second.phone,
  }).toEqual({
    email: first.email,
    name: first.name,
    phone: first.phone,
  });
  expect(second.date).toBe("2099-09-02");
  expect(new URL(second.checkoutUrl).searchParams.get("date")).toBe(
    "2099-09-02"
  );
});

test("builds minimal meeting-room persistence data with transient timing", () => {
  const duration = { unit: "hour", amount: 4 } as const;
  const interval = getMeetingRoomReservationInterval(
    "2099-09-01T10:00",
    duration
  );
  expect(interval).toBeDefined();
  const data = makeMeetingRoomCheckoutData("https://workspace.example.com", {
    date: "2099-09-01",
    duration,
    startDateTime: "2099-09-01T10:00",
    ...interval!,
  });

  expect(new URL(data.checkoutUrl).pathname).toBe(
    "/en-US/reservation/meeting-room"
  );
  expect(data.expectedReservationDetails).toEqual({
    kind: "meeting-room",
  });
  expect(data.meetingRoom).toEqual({
    duration,
    endsAt: interval!.endsAt,
    startDateTime: "2099-09-01T10:00",
    startsAt: interval!.startsAt,
  });
  expect(data.expectedReservationDetails).not.toHaveProperty("startsAt");
});

test("reuses a meeting-room customer while changing the interval", () => {
  const firstInterval = getMeetingRoomReservationInterval("2099-09-01T10:00", {
    unit: "hour",
    amount: 1,
  });
  const secondInterval = getMeetingRoomReservationInterval("2099-09-02T10:00", {
    unit: "hour",
    amount: 4,
  });
  expect(firstInterval).toBeDefined();
  expect(secondInterval).toBeDefined();
  const first = makeMeetingRoomCheckoutData(
    "https://workspace.example.com",
    {
      date: "2099-09-01",
      duration: { unit: "hour", amount: 1 },
      startDateTime: "2099-09-01T10:00",
      ...firstInterval!,
    },
    "meeting-room-replacement"
  );
  const second = reuseMeetingRoomCheckoutContact(
    "https://workspace.example.com",
    {
      date: "2099-09-02",
      duration: { unit: "hour", amount: 4 },
      startDateTime: "2099-09-02T10:00",
      ...secondInterval!,
    },
    first
  );

  expect({
    email: second.email,
    message: second.message,
    name: second.name,
    phone: second.phone,
  }).toEqual({
    email: first.email,
    message: first.message,
    name: first.name,
    phone: first.phone,
  });
  expect(second.meetingRoom?.duration).toEqual({ unit: "hour", amount: 4 });
  expect(second.meetingRoom?.startsAt).toBe(secondInterval!.startsAt);
});

test("loads availability through the provided HTTP client", async () => {
  setSystemTime(new Date("2099-07-17T09:48:00.000Z"));
  const requests: Request[] = [];
  const fetchMock = mock(
    async (input: URL | RequestInfo, init?: RequestInit) => {
      const request =
        input instanceof Request ? input : new Request(input, init);
      requests.push(request);
      return Response.json({ unavailableDates: [] });
    }
  );
  const httpClientLayer = FetchHttpClient.layer.pipe(
    Layer.provide(
      Layer.succeed(
        FetchHttpClient.Fetch,
        fetchMock as unknown as typeof globalThis.fetch
      )
    )
  );

  const dates = await Effect.runPromise(
    selectAvailableCoworkDates(makeConfig(), 2).pipe(
      Effect.provide(httpClientLayer)
    )
  );

  expect(dates).toEqual(["2099-07-31", "2099-08-03"]);
  expect(requests).toHaveLength(1);
  expect(requests[0]?.url).toBe(
    "https://deskohub-workspace-a1b2c3d4e-deskohub-bar.vercel.app/api/workspace/availability?entryTier=basic&from=2099-07-31&to=2099-10-15"
  );
  expect(requests[0]?.headers.get("x-vercel-protection-bypass")).toBe(
    "test-protection-bypass"
  );
});

test("selects tier-specific dates without reusing excluded dates", async () => {
  setSystemTime(new Date("2099-07-17T09:48:00.000Z"));
  const requests: Request[] = [];
  const fetchMock = mock(
    async (input: URL | RequestInfo, init?: RequestInit) => {
      const request =
        input instanceof Request ? input : new Request(input, init);
      requests.push(request);
      return Response.json({ unavailableDates: [] });
    }
  );
  const httpClientLayer = FetchHttpClient.layer.pipe(
    Layer.provide(
      Layer.succeed(
        FetchHttpClient.Fetch,
        fetchMock as unknown as typeof globalThis.fetch
      )
    )
  );

  const dates = await Effect.runPromise(
    selectAvailableCoworkDates(makeConfig(), 1, {
      entryTier: "profi",
      excludedDates: new Set(["2099-07-31"]),
      monitorOption: "2x27-qhd",
    }).pipe(Effect.provide(httpClientLayer))
  );

  expect(dates).toEqual(["2099-08-03"]);
  expect(requests[0]?.url).toContain("entryTier=profi");
  expect(requests[0]?.url).toContain("monitorOption=2x27-qhd");
});

test("loads only the deterministic allocation shard through availability", async () => {
  setSystemTime(new Date("2099-07-17T09:48:00.000Z"));
  const requests: Request[] = [];
  const fetchMock = mock(
    async (input: URL | RequestInfo, init?: RequestInit) => {
      const request =
        input instanceof Request ? input : new Request(input, init);
      requests.push(request);
      return Response.json({ unavailableDates: [] });
    }
  );
  const httpClientLayer = FetchHttpClient.layer.pipe(
    Layer.provide(
      Layer.succeed(
        FetchHttpClient.Fetch,
        fetchMock as unknown as typeof globalThis.fetch
      )
    )
  );

  const dates = await Effect.runPromise(
    selectAvailableCoworkDates(makeConfig(), 1, {
      allocation: {
        fromOffsetDays: 40,
        shardCount: 3,
        shardIndex: 1,
        toOffsetDays: 65,
      },
    }).pipe(Effect.provide(httpClientLayer))
  );

  expect(dates).toEqual(["2099-08-27"]);
  expect(requests[0]?.url).toContain("from=2099-08-26&to=2099-09-20");
});

test("spreads sparse availability across deterministic allocation shards", async () => {
  setSystemTime(new Date("2099-07-17T09:48:00.000Z"));
  const candidateDates = Array.from({ length: 77 }, (_, index) => {
    const date = new Date("2099-07-17T00:00:00.000Z");
    date.setUTCDate(date.getUTCDate() + index + 14);
    return date.toISOString().slice(0, 10);
  });
  const availableDates = new Set(
    candidateDates
      .filter((date) => {
        const day = new Date(`${date}T00:00:00.000Z`).getUTCDay();
        return day !== 0 && day !== 6;
      })
      .slice(0, 18)
  );
  const unavailableDates = candidateDates.filter(
    (date) => !availableDates.has(date)
  );
  const fetchMock = mock(async () => Response.json({ unavailableDates }));
  const httpClientLayer = FetchHttpClient.layer.pipe(
    Layer.provide(
      Layer.succeed(
        FetchHttpClient.Fetch,
        fetchMock as unknown as typeof globalThis.fetch
      )
    )
  );

  const datesByShard = await Promise.all(
    Array.from({ length: 3 }, (_, shardIndex) =>
      Effect.runPromise(
        Effect.gen(function* () {
          const allocation = makeWorkspaceE2EDateAllocation({
            runId: `sparse-availability-${shardIndex}`,
            shardIndex,
          });
          const initialDates = yield* selectAvailableCoworkDates(
            makeConfig(),
            5,
            {
              allocation,
              maximumReservationsPerDate: 4,
            }
          );
          const discountDates = yield* selectAvailableCoworkDates(
            makeConfig(),
            16,
            {
              allocation,
              excludedDates: new Set(initialDates),
              maximumReservationsPerDate: 4,
            }
          );

          return [...initialDates, ...discountDates];
        }).pipe(Effect.provide(httpClientLayer))
      )
    )
  );

  for (const dates of datesByShard) {
    const counts = Map.groupBy(dates, (date) => date);
    expect(new Set(dates).size).toBe(6);
    expect(Math.max(...[...counts.values()].map(({ length }) => length))).toBe(
      4
    );
  }
  expect(new Set(datesByShard.flat()).size).toBe(18);
});

test("allocates non-overlapping dates from concurrently loaded availability", async () => {
  const availableDates = ["2099-08-02", "2099-08-03", "2099-08-04"];

  const dates = await Effect.runPromise(
    selectCoworkDates(availableDates, 2, {
      excludedDates: new Set(["2099-08-02"]),
    })
  );

  expect(dates).toEqual(["2099-08-03", "2099-08-04"]);
});

test("packs the bounded number of same-date cowork reservations", async () => {
  const dates = await Effect.runPromise(
    selectCoworkDates(["2099-08-03", "2099-08-04"], 6, {
      maximumReservationsPerDate: 4,
    })
  );

  expect(dates).toEqual([
    "2099-08-03",
    "2099-08-03",
    "2099-08-03",
    "2099-08-03",
    "2099-08-04",
    "2099-08-04",
  ]);
});

test("reports allocation capacity context before case construction", async () => {
  const exit = await Effect.runPromiseExit(
    selectCoworkDates(["2099-08-03"], 2, {
      allocation: {
        fromOffsetDays: 14,
        shardCount: 3,
        shardIndex: 0,
        toOffsetDays: 39,
      },
      selectionLabel: "tier:profi with monitor:2x27-qhd",
    })
  );

  expect(Exit.isFailure(exit)).toBe(true);
  if (Exit.isFailure(exit)) {
    const message = String(Cause.squash(exit.cause));
    expect(message).toContain("tier:profi with monitor:2x27-qhd");
    expect(message).toContain("shard 1 of 3");
    expect(message).toContain("supported concurrency 3");
  }
});

test("selects non-overlapping meeting-room slots for every duration", async () => {
  setSystemTime(new Date("2099-07-17T09:48:00.000Z"));
  const requests: Request[] = [];
  let activeRequestCount = 0;
  let maximumActiveRequestCount = 0;
  const fetchMock = mock(
    async (input: URL | RequestInfo, init?: RequestInit) => {
      const request =
        input instanceof Request ? input : new Request(input, init);
      requests.push(request);
      activeRequestCount += 1;
      maximumActiveRequestCount = Math.max(
        maximumActiveRequestCount,
        activeRequestCount
      );
      await new Promise((resolve) => setTimeout(resolve, 10));
      activeRequestCount -= 1;
      return Response.json({
        meetingRoomUnavailable: false,
        unavailableDates: [],
      });
    }
  );
  const httpClientLayer = FetchHttpClient.layer.pipe(
    Layer.provide(
      Layer.succeed(
        FetchHttpClient.Fetch,
        fetchMock as unknown as typeof globalThis.fetch
      )
    )
  );

  const slots = await Effect.runPromise(
    selectAvailableMeetingRoomSlots(makeConfig(), [
      { unit: "hour", amount: 1 },
      { unit: "hour", amount: 4 },
      { unit: "day", amount: 1 },
    ]).pipe(Effect.provide(httpClientLayer))
  );

  expect(
    slots.map(({ date, duration, startDateTime }) => ({
      date,
      duration,
      startDateTime,
    }))
  ).toEqual([
    {
      date: "2099-07-31",
      duration: { unit: "hour", amount: 1 },
      startDateTime: "2099-07-31T10:00",
    },
    {
      date: "2099-08-03",
      duration: { unit: "hour", amount: 4 },
      startDateTime: "2099-08-03T10:00",
    },
    {
      date: "2099-08-04",
      duration: { unit: "day", amount: 1 },
      startDateTime: "2099-08-04T00:00",
    },
  ]);
  expect(requests).toHaveLength(3);
  expect(maximumActiveRequestCount).toBe(3);
  expect(requests[0]?.url).toContain("kind=meeting-room");
  expect(requests[0]?.url).not.toContain("_tag");
  expect(requests[2]?.url).toContain("from=2099-08-04");
  expect(requests[2]?.url).toContain("to=2099-08-04");
  expect(requests[2]?.headers.get("x-vercel-protection-bypass")).toBe(
    "test-protection-bypass"
  );
});

test("keeps meeting-room dates disjoint across allocation shards", async () => {
  setSystemTime(new Date("2099-07-17T09:48:00.000Z"));
  const fetchMock = mock(async () =>
    Response.json({
      meetingRoomUnavailable: false,
      unavailableDates: [],
    })
  );
  const httpClientLayer = FetchHttpClient.layer.pipe(
    Layer.provide(
      Layer.succeed(
        FetchHttpClient.Fetch,
        fetchMock as unknown as typeof globalThis.fetch
      )
    )
  );

  const slotsByShard = await Promise.all(
    Array.from({ length: 3 }, (_, shardIndex) =>
      Effect.runPromise(
        selectAvailableMeetingRoomSlots(
          makeConfig(),
          [{ unit: "hour", amount: 1 }],
          makeWorkspaceE2EDateAllocation({
            runId: `meeting-room-${shardIndex}`,
            shardIndex,
          })
        ).pipe(Effect.provide(httpClientLayer))
      )
    )
  );

  expect(new Set(slotsByShard.flat().map(({ date }) => date)).size).toBe(3);
});

test("rejects meeting-room slots that touch an unavailable date", async () => {
  setSystemTime(new Date("2099-07-17T09:48:00.000Z"));
  const requests: Request[] = [];
  const fetchMock = mock(
    async (input: URL | RequestInfo, init?: RequestInit) => {
      const request =
        input instanceof Request ? input : new Request(input, init);
      requests.push(request);
      const requestUrl = new URL(request.url);

      return Response.json({
        meetingRoomUnavailable: false,
        unavailableDates:
          requests.length === 1 ? [requestUrl.searchParams.get("to")] : [],
      });
    }
  );
  const httpClientLayer = FetchHttpClient.layer.pipe(
    Layer.provide(
      Layer.succeed(
        FetchHttpClient.Fetch,
        fetchMock as unknown as typeof globalThis.fetch
      )
    )
  );

  const slots = await Effect.runPromise(
    selectAvailableMeetingRoomSlots(makeConfig(), [
      { unit: "day", amount: 1 },
    ]).pipe(Effect.provide(httpClientLayer))
  );

  expect(requests).toHaveLength(2);
  expect(slots[0]?.startDateTime).toBe("2099-08-03T00:00");
});

test("fails meeting-room shard exhaustion with capacity context", async () => {
  setSystemTime(new Date("2099-07-17T09:48:00.000Z"));
  const httpClientLayer = FetchHttpClient.layer.pipe(
    Layer.provide(
      Layer.succeed(
        FetchHttpClient.Fetch,
        mock(() =>
          Response.json({
            meetingRoomUnavailable: false,
            unavailableDates: [],
          })
        ) as unknown as typeof globalThis.fetch
      )
    )
  );
  const exit = await Effect.runPromiseExit(
    selectAvailableMeetingRoomSlots(
      makeConfig(),
      [{ unit: "hour", amount: 1 }],
      {
        fromOffsetDays: 16,
        shardCount: 3,
        shardIndex: 0,
        toOffsetDays: 16,
      }
    ).pipe(Effect.provide(httpClientLayer))
  );

  expect(Exit.isFailure(exit)).toBe(true);
  if (Exit.isFailure(exit)) {
    const message = String(Cause.squash(exit.cause));
    expect(message).toContain("reservation:meeting-room hour:1 slot");
    expect(message).toContain("shard 1 of 3");
    expect(message).toContain("supported concurrency 3");
  }
});

const makeConfig = (): WorkspaceE2EConfig => ({
  baseUrl: "https://deskohub-workspace-a1b2c3d4e-deskohub-bar.vercel.app",
  bypassSecret: "test-protection-bypass",
  expectedHost: "deskohub-workspace-a1b2c3d4e-deskohub-bar.vercel.app",
  timeouts: workspaceE2ETimeouts,
});
