import { afterEach, expect, mock, setSystemTime, test } from "bun:test";
import { Effect, Layer } from "effect";
import { FetchHttpClient } from "effect/unstable/http";
import isEmail from "validator/lib/isEmail";
import type { WorkspaceE2EConfig } from "../config";
import { workspaceE2ETimeouts } from "../timeouts";
import {
  makeCoworkCheckoutData,
  reuseCoworkCheckoutContact,
  selectAvailableCoworkDates,
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

const makeConfig = (): WorkspaceE2EConfig => ({
  baseUrl: "https://deskohub-workspace-a1b2c3d4e-deskohub-bar.vercel.app",
  bypassSecret: "test-protection-bypass",
  expectedHost: "deskohub-workspace-a1b2c3d4e-deskohub-bar.vercel.app",
  timeouts: workspaceE2ETimeouts,
});
