import "@/shared/testing/workspace-test-env";

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  mock,
  test,
} from "bun:test";
import { Effect } from "effect";

const cacheLife = mock((_profile: { readonly expire: number }) => undefined);

mock.module("next/cache", () => ({ cacheLife }));

const {
  generateWorkspaceLocationMapImage,
  workspaceLocationMapTileConcurrency,
} = await import("./workspace-location-map");

const originalFetch = globalThis.fetch;

const mockFetch = (
  handler: (init: RequestInit | undefined) => Promise<Response>
) => {
  globalThis.fetch = Object.assign(
    (_input: RequestInfo | URL, init?: RequestInit) => handler(init),
    { preconnect: originalFetch.preconnect }
  );
};

beforeEach(() => {
  cacheLife.mockClear();
});

afterEach(() => {
  jest.useRealTimers();
  globalThis.fetch = originalFetch;
});

describe("generateWorkspaceLocationMapImage", () => {
  test("limits concurrent OpenStreetMap tile requests and fails on a failed tile", async () => {
    let inFlight = 0;
    let maximumInFlight = 0;
    mockFetch(async () => {
      inFlight += 1;
      maximumInFlight = Math.max(maximumInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 20));
      inFlight -= 1;
      return new Response(null, { status: 503 });
    });

    const error = await Effect.runPromise(
      Effect.flip(generateWorkspaceLocationMapImage())
    );

    expect(error).toMatchObject({
      _tag: "OsmTileRequestError",
      statusCode: 503,
    });
    expect(maximumInFlight).toBeGreaterThan(0);
    expect(maximumInFlight).toBeLessThanOrEqual(
      workspaceLocationMapTileConcurrency
    );
    // A failed download is not kept for later renders.
    expect(cacheLife).toHaveBeenCalled();
    expect(new Set(cacheLife.mock.calls.map(([life]) => life.expire))).toEqual(
      new Set([0])
    );
  });

  test("aborts tile downloads that outlast the tile timeout", async () => {
    jest.useFakeTimers();
    const signals: (AbortSignal | null | undefined)[] = [];
    mockFetch(
      (init) =>
        new Promise((_resolve, reject) => {
          signals.push(init?.signal);
          init?.signal?.addEventListener("abort", () =>
            reject(init.signal?.reason)
          );
        })
    );

    const render = Effect.runPromiseExit(generateWorkspaceLocationMapImage());
    for (let step = 0; step < 100 && signals.length === 0; step += 1) {
      jest.advanceTimersByTime(0);
      await Promise.resolve();
    }
    jest.advanceTimersByTime(10_000);
    await render;

    expect(signals.length).toBeGreaterThan(0);
    expect(signals.every((signal) => signal?.aborted)).toBe(true);
  });
});
