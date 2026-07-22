"use client";

import { skipToken, useQuery } from "@tanstack/react-query";
import {
  type AdvertisedPriceRequest,
  advertisedPriceKeys,
} from "@/features/checkout/advertised-price";
import { getAdvertisedPrice } from "@/features/reservation/actions/get-advertised-price";

const loadAdvertisedPrice = async (request: AdvertisedPriceRequest) => {
  const result = await getAdvertisedPrice(request);

  if (result.data) {
    return result.data;
  }

  throw new Error(result.serverError ?? "Advertised price could not be loaded");
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
