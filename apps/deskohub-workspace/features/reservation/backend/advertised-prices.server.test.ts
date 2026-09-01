import "@/shared/testing/workspace-test-env";
import { describe, expect, mock, test } from "bun:test";
import { Deferred, Effect, Fiber, Queue } from "effect";
import {
  type AdvertisedPriceRequest,
  advertisedPriceRequestBatchSize,
} from "@/features/checkout/advertised-price";

mock.module("server-only", () => ({}));

let inFlightBuilds = 0;
let peakInFlightBuilds = 0;
let releaseGates: Queue.Queue<Deferred.Deferred<void>>;

mock.module(
  "@/features/checkout/backend/checkout/advertised-price.server",
  () => ({
    buildAdvertisedPrice: (request: AdvertisedPriceRequest) =>
      Effect.gen(function* () {
        const releaseGate = yield* Deferred.make<void>();
        inFlightBuilds += 1;
        peakInFlightBuilds = Math.max(peakInFlightBuilds, inFlightBuilds);
        yield* Queue.offer(releaseGates, releaseGate);
        yield* Deferred.await(releaseGate);
        inFlightBuilds -= 1;
        return { advertisedPriceToken: JSON.stringify(request) };
      }),
  })
);

const { loadAdvertisedPrices } = await import("./advertised-prices.server");

const requests: ReadonlyArray<AdvertisedPriceRequest> = Array.from(
  { length: advertisedPriceRequestBatchSize },
  (_, index) => ({
    locale: "en-US",
    reservation: {
      kind: "cowork",
      details: {
        kind: "cowork",
        entryTier: "basic",
        coffee: false,
        date: `2099-07-${String(index + 1).padStart(2, "0")}`,
      },
    },
  })
);

describe("loadAdvertisedPrices", () => {
  test("loads a full unique batch with at most two concurrent price builds", async () => {
    const outcome = await Effect.runPromise(
      Effect.gen(function* () {
        releaseGates = yield* Queue.unbounded<Deferred.Deferred<void>>();
        const batch = yield* Effect.forkChild(loadAdvertisedPrices(requests));
        for (let round = 0; round < requests.length / 2; round += 1) {
          const first = yield* Queue.take(releaseGates);
          const second = yield* Queue.take(releaseGates);
          yield* Deferred.succeed(first, undefined);
          yield* Deferred.succeed(second, undefined);
        }
        return { peak: peakInFlightBuilds, results: yield* Fiber.join(batch) };
      })
    );

    expect(outcome.peak).toBe(2);
    expect(outcome.results).toEqual(
      requests.map((request) => ({
        request,
        advertisedPrice: { advertisedPriceToken: JSON.stringify(request) },
      }))
    );
  });
});
