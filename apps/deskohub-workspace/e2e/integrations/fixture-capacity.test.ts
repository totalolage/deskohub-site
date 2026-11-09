import { expect, test } from "bun:test";
import { Cause, Effect, Exit } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import { withInstantSleeps } from "@/shared/testing/workspace-test-clock.test-utils";
import { getDatasourceConfig } from "../config";
import { makeTestE2EEnvironment } from "../e2e-env.test-fixture";
import { formatWorkspaceE2EFailure } from "../errors";
import { fixtureCapacityLifetime } from "../fixture-capacity";
import { fixtureCapacityTestTable } from "../fixture-capacity.test-fixture";
import {
  FixtureCapacityReader,
  fixtureCapacityReadLimits,
} from "./fixture-capacity";

const config = getDatasourceConfig(
  makeTestE2EEnvironment({
    DOTYPOS_API_URL: "https://api.dotykacka.cz/v2",
    DOTYPOS_CLOUD_ID: "123",
    TARGET_SHA: "a".repeat(40),
  })
);
const startMillis = Date.parse("2026-11-08T12:00:00Z");
const table = { ...fixtureCapacityTestTable, _cloudId: "123" };
const page = (data: unknown[], current = 1, total = data.length) => ({
  data,
  currentPage: String(current),
  perPage: "100",
  totalItemsOnPage: String(data.length),
  totalItemsCount: String(total),
  firstPage: "1",
  lastPage: String(Math.max(1, Math.ceil(total / 100))),
  prevPage: current === 1 ? null : String(current - 1),
  nextPage: current * 100 < total ? String(current + 1) : null,
});
type Reply = (
  url: URL,
  init: RequestInit | undefined
) => Response | Promise<Response>;
const read = (reply: Reply) =>
  Effect.flatMap(FixtureCapacityReader, (reader) =>
    reader.read({
      config,
      startMillis,
      endMillis: startMillis + fixtureCapacityLifetime,
    })
  ).pipe(
    Effect.provide(FixtureCapacityReader.Live),
    Effect.provideService(FetchHttpClient.Fetch, ((input, init) =>
      Promise.resolve(reply(new URL(String(input)), init))) as typeof fetch),
    Effect.exit
  );
const normal: Reply = (url) => {
  if (url.pathname.endsWith("/signin/token"))
    return Response.json({ accessToken: "private-access-token" });
  if (url.pathname.endsWith("/tables")) return Response.json(page([table]));
  return Response.json(page([]));
};
const expectUnknown = (exit: Exit.Exit<unknown, unknown>) => {
  expect(Exit.isFailure(exit)).toBe(true);
  if (Exit.isFailure(exit)) {
    const text = formatWorkspaceE2EFailure(Cause.squash(exit.cause));
    expect(text).toContain("Unknown");
    for (const secret of [
      "private-access-token",
      "refresh-token",
      "private-payload",
      "api.dotykacka.cz",
      "clouds/123",
      "private-record-id",
    ])
      expect(text).not.toContain(secret);
  }
};

test("counts token, tables and both all-owner traversals, with no redirects, proxy, credentials or customer reads", async () => {
  const requests: URL[] = [];
  const exit = await Effect.runPromise(
    read((url, init) => {
      requests.push(url);
      expect(init?.redirect).toBe("error");
      expect(init?.credentials).toBe("omit");
      expect(init && "proxy" in init && init.proxy).toBeNull();
      expect(url.origin).toBe("https://api.dotykacka.cz");
      if (url.pathname.endsWith("/reservations")) {
        const filter = url.searchParams.get("filter")!;
        expect(filter).toContain("status|in|NEW,CONFIRMED;startDate|lt|");
        expect(filter).toContain(";endDate|gt|");
        expect(filter).not.toContain("customer");
      }
      return normal(url, init);
    })
  );
  expect(Exit.isSuccess(exit)).toBe(true);
  if (Exit.isSuccess(exit))
    expect(exit.value.counts).toMatchObject({
      requests: 4,
      tokenRequests: 1,
      tablePages: 1,
      reservationPages: 2,
      traversals: 3,
    });
  expect(requests).toHaveLength(4);
});

test("token404 and table404 are Unknown; only empty first resource404 after independent table success is empty", async () => {
  for (const resource of ["token", "tables"]) {
    let calls = 0;
    const exit = await Effect.runPromise(
      read((url, init) => {
        calls++;
        return url.pathname.endsWith(`/${resource}`)
          ? new Response(null, { status: 404 })
          : normal(url, init);
      })
    );
    expectUnknown(exit);
    expect(calls).toBe(resource === "token" ? 1 : 2);
  }
  const exit = await Effect.runPromise(
    read((url, init) =>
      url.pathname.endsWith("/reservations")
        ? Response.json(null, { status: 404 })
        : normal(url, init)
    )
  );
  expect(Exit.isSuccess(exit)).toBe(true);
  if (Exit.isSuccess(exit)) {
    expect(exit.value.past).toEqual([]);
    expect(exit.value.future).toEqual([]);
  }
  expectUnknown(
    await Effect.runPromise(
      read((url, init) =>
        url.pathname.endsWith("/reservations")
          ? Response.json({ error: "private-payload" }, { status: 404 })
          : normal(url, init)
      )
    )
  );
});

test("unknown cloud, missing ids, incomplete/invalid pagination and page budget exhaustion fail closed", async () => {
  for (const body of [
    page([{ ...table, _cloudId: "999" }]),
    page([{ ...table, id: undefined }]),
    { data: [table] },
    { ...page([table]), totalItemsCount: "401" },
    { ...page([table]), nextPage: "2" },
    { ...page([table]), prevPage: undefined },
    { ...page([table]), totalItemsOnPage: "2" },
    { ...page([table]), currentPage: "0" },
    { ...page([table]), perPage: "10" },
    { ...page([table]), lastPage: "2" },
  ]) {
    expectUnknown(
      await Effect.runPromise(
        read((url, init) =>
          url.pathname.endsWith("/tables")
            ? Response.json(body)
            : normal(url, init)
        )
      )
    );
  }
});

const reservation = (id: string) => ({
  id,
  _cloudId: "123",
  _branchId: "branch",
  _tableId: "table",
  seats: "1",
  status: "NEW",
  startDate: "2026-11-06T10:00:00Z",
  endDate: "2026-11-06T11:00:00Z",
});
test("later-page404 and repeated ids or changed totals cannot be mistaken for complete pagination", async () => {
  for (const later of [
    new Response(null, { status: 404 }),
    Response.json(page([reservation("r0")], 2, 101)),
    Response.json(page([reservation("r100")], 2, 102)),
  ]) {
    let calls = 0;
    const exit = await Effect.runPromise(
      read((url, init) => {
        calls++;
        if (!url.pathname.endsWith("/reservations")) return normal(url, init);
        return url.searchParams.get("page") === "1"
          ? Response.json(
              page(
                Array.from({ length: 100 }, (_, id) => reservation(`r${id}`)),
                1,
                101
              )
            )
          : later;
      })
    );
    expectUnknown(exit);
    expect(calls).toBe(4);
  }
});

test("valid three-page traversals complete at the physical ten-request ceiling", async () => {
  let calls = 0;
  const exit = await Effect.runPromise(
    read((url, init) => {
      calls++;
      if (url.pathname.endsWith("/token")) return normal(url, init);
      const current = Number(url.searchParams.get("page"));
      const offset = (current - 1) * 100;
      const records = Array.from(
        { length: current < 3 ? 100 : 1 },
        (_, index) =>
          url.pathname.endsWith("/tables")
            ? { ...table, id: `table-${offset + index}` }
            : reservation(`reservation-${offset + index}`)
      );
      return Response.json(page(records, current, 201));
    })
  );
  expect(Exit.isSuccess(exit)).toBe(true);
  expect(calls).toBe(fixtureCapacityReadLimits.requests);
  if (Exit.isSuccess(exit))
    expect(exit.value.counts).toMatchObject({
      requests: 10,
      tablePages: 3,
      reservationPages: 6,
    });
});

test("reservation ids, cloud and generated schema validation cannot be bypassed by a valid page envelope", async () => {
  for (const record of [
    { ...reservation("private-record-id"), id: undefined },
    { ...reservation("private-record-id"), _cloudId: "999" },
    { ...reservation("private-record-id"), status: "INVALID" },
  ])
    expectUnknown(
      await Effect.runPromise(
        read((url, init) =>
          url.pathname.endsWith("/reservations")
            ? Response.json(page([record]))
            : normal(url, init)
        )
      )
    );
  expectUnknown(
    await Effect.runPromise(
      read(
        () =>
          new Response(null, {
            status: 302,
            headers: { location: "https://other.example.test" },
          })
      )
    )
  );
});

test("caps response bytes and timeout, never retries, and drops provider payloads from errors", async () => {
  let calls = 0;
  expectUnknown(
    await Effect.runPromise(
      read(() => {
        calls++;
        return new Response(
          "x".repeat(fixtureCapacityReadLimits.responseBytes + 1)
        );
      })
    )
  );
  expect(calls).toBe(1);
  calls = 0;
  expectUnknown(
    await Effect.runPromise(
      read(() => {
        calls++;
        throw new Error(
          "private-payload private-access-token api.dotykacka.cz private-record-id"
        );
      })
    )
  );
  expect(calls).toBe(1);
  calls = 0;
  const exit = await Effect.runPromise(
    read((_url, init) => {
      calls++;
      return new Promise<Response>((_resolve, reject) =>
        init?.signal?.addEventListener("abort", () =>
          reject(new Error("private-payload"))
        )
      );
    }).pipe(withInstantSleeps)
  );
  expectUnknown(exit);
  expect(calls).toBe(1);
});

test("rejects unapproved origins before any physical request", async () => {
  let calls = 0;
  const exit = await Effect.runPromise(
    Effect.flatMap(FixtureCapacityReader, (reader) =>
      reader.read({
        config: {
          ...config,
          dotypos: {
            ...config.dotypos,
            apiUrl: "https://other.example.test/v2",
          },
        },
        startMillis,
        endMillis: startMillis + fixtureCapacityLifetime,
      })
    ).pipe(
      Effect.provide(FixtureCapacityReader.Live),
      Effect.provideService(FetchHttpClient.Fetch, (() => {
        calls++;
        throw new Error("unexpected");
      }) as typeof fetch),
      Effect.exit
    )
  );
  expectUnknown(exit);
  expect(calls).toBe(0);
});
