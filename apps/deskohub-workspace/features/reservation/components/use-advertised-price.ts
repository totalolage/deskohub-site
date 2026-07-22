"use client";

import { skipToken, useQuery } from "@tanstack/react-query";
import {
  type AdvertisedPriceRequest,
  advertisedPriceKeys,
} from "@/features/checkout/advertised-price";
import { getAdvertisedPrice } from "@/features/reservation/actions/get-advertised-price";

export const useAdvertisedPrice = (
  request: AdvertisedPriceRequest | undefined
) =>
  useQuery({
    queryKey: request
      ? advertisedPriceKeys.price(request)
      : advertisedPriceKeys.all,
    queryFn: request ? () => getAdvertisedPrice(request) : skipToken,
    retry: (failureCount) => failureCount < 3,
    staleTime: 4 * 60 * 1000,
    refetchInterval: 4 * 60 * 1000,
  });
