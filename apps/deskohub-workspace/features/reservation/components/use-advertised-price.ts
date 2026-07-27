"use client";

import { skipToken, useQueries, useQuery } from "@tanstack/react-query";
import {
  type AdvertisedPriceRequest,
  advertisedPriceKeys,
  advertisedPriceRequestEquals,
  type PreloadedAdvertisedPrice,
} from "@/features/checkout/advertised-price";
import { getAdvertisedPrice } from "@/features/reservation/actions/get-advertised-price";

const loadAdvertisedPrice = async (request: AdvertisedPriceRequest) => {
  const result = await getAdvertisedPrice(request);

  if (result.data) {
    return result.data;
  }

  throw new Error(result.serverError ?? "Advertised price could not be loaded");
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

export const useAdvertisedPrice = (
  request: AdvertisedPriceRequest | undefined
) =>
  useQuery({
    queryKey: request
      ? advertisedPriceKeys.price(request)
      : advertisedPriceKeys.all,
    queryFn: request ? () => loadAdvertisedPrice(request) : skipToken,
    retry: (failureCount) => failureCount < 3,
    staleTime: 4 * 60 * 1000,
    refetchInterval: 4 * 60 * 1000,
  });

export const useAdvertisedPrices = (
  requests: ReadonlyArray<AdvertisedPriceRequest>,
  preloadedPrices: ReadonlyArray<PreloadedAdvertisedPrice> = []
) =>
  useQueries({
    queries: requests.map((request) =>
      advertisedPriceQuery(request, preloadedPrices)
    ),
  });
