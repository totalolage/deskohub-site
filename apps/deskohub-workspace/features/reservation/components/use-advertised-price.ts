"use client";

import { useQueries } from "@tanstack/react-query";
import { Array as EffectArray } from "effect";
import {
  type AdvertisedPriceRequest,
  advertisedPriceKeys,
  advertisedPriceRequestBatchSize,
  advertisedPriceRequestEquals,
  type PreloadedAdvertisedPrice,
} from "@/features/checkout/advertised-price";
import { getAdvertisedPrices } from "@/features/reservation/actions/get-advertised-price";

type PendingAdvertisedPrice = {
  readonly reject: (error: Error) => void;
  readonly request: AdvertisedPriceRequest;
  readonly resolve: (
    price: PreloadedAdvertisedPrice["advertisedPrice"]
  ) => void;
};

let pendingAdvertisedPrices: PendingAdvertisedPrice[] = [];

const loadAdvertisedPrice = (request: AdvertisedPriceRequest) =>
  new Promise<PreloadedAdvertisedPrice["advertisedPrice"]>(
    (resolve, reject) => {
      const shouldScheduleBatch = pendingAdvertisedPrices.length === 0;
      pendingAdvertisedPrices.push({ reject, request, resolve });
      if (shouldScheduleBatch) {
        setTimeout(flushAdvertisedPriceBatch, 0);
      }
    }
  );

const flushAdvertisedPriceBatch = async () => {
  const pending = pendingAdvertisedPrices;
  pendingAdvertisedPrices = [];
  const requests = EffectArray.dedupeWith(
    pending.map(({ request }) => request),
    advertisedPriceRequestEquals
  );
  const batches = EffectArray.chunksOf(
    requests,
    advertisedPriceRequestBatchSize
  );

  await Promise.all(
    batches.map((batch) => loadAdvertisedPriceBatch(pending, batch))
  );
};

const loadAdvertisedPriceBatch = async (
  pending: readonly PendingAdvertisedPrice[],
  requests: readonly AdvertisedPriceRequest[]
) => {
  const batchItems = pending.filter(({ request }) =>
    requests.some((candidate) =>
      advertisedPriceRequestEquals(candidate, request)
    )
  );

  try {
    const result = await getAdvertisedPrices(requests);
    if (!result.data) {
      throw new Error(
        result.serverError ?? "Advertised price could not be loaded"
      );
    }

    for (const item of batchItems) {
      const price = result.data.find(({ request: candidate }) =>
        advertisedPriceRequestEquals(candidate, item.request)
      )?.advertisedPrice;
      if (price) {
        item.resolve(price);
      } else {
        item.reject(new Error("Advertised price could not be loaded"));
      }
    }
  } catch (cause) {
    const error =
      cause instanceof Error
        ? cause
        : new Error("Advertised price could not be loaded");
    for (const { reject } of batchItems) {
      reject(error);
    }
  }
};

const advertisedPriceQuery = (
  request: AdvertisedPriceRequest,
  preloadedPrices: ReadonlyArray<PreloadedAdvertisedPrice>
) => {
  const preloadedPrice = preloadedPrices.find(({ request: candidate }) =>
    advertisedPriceRequestEquals(candidate, request)
  )?.advertisedPrice;

  return {
    queryKey: advertisedPriceKeys.price(request),
    queryFn: () => loadAdvertisedPrice(request),
    retry: (failureCount: number) => failureCount < 3,
    staleTime: 4 * 60 * 1000,
    refetchInterval: 4 * 60 * 1000,
    ...(preloadedPrice && { initialData: preloadedPrice }),
  };
};

export const useAdvertisedPrices = (
  requests: ReadonlyArray<AdvertisedPriceRequest>,
  preloadedPrices: ReadonlyArray<PreloadedAdvertisedPrice> = []
) =>
  useQueries({
    queries: requests.map((request) =>
      advertisedPriceQuery(request, preloadedPrices)
    ),
  });
