"use client";

import { useMemo } from "react";
import {
  type AdvertisedPrice,
  isMeetingRoomAdvertisedPrice,
  type MeetingRoomAdvertisedPriceRequest,
  type PreloadedAdvertisedPrice,
} from "@/features/checkout/advertised-price";
import { getWorkspaceMeetingRoomDurationTitle } from "@/features/checkout/product-catalog.i18n";
import type { CanonicalPromotionCode } from "@/features/discounts";
import type { Locale } from "@/features/i18n";
import { getReservationAdvertisedTotal } from "@/features/reservation/components/reservation-selection-summary";
import { useAdvertisedPrices } from "@/features/reservation/components/use-advertised-price";
import { getMeetingRoomDurationAdvertisedPriceRequests } from "@/features/reservation/meeting-room-advertised-price";
import {
  getMeetingRoomReservationDuration,
  getMeetingRoomReservationDurationKey,
  type MeetingRoomReservationDurationKey,
} from "@/features/reservation/meeting-room-reservation-duration";

type MeetingRoomAdvertisedPrice = Extract<
  AdvertisedPrice,
  { readonly kind: "meeting-room" }
>;

type AdvertisedPriceQueryResult = ReturnType<
  typeof useAdvertisedPrices
>[number];

const getRequestDurationKey = ({
  reservation,
}: MeetingRoomAdvertisedPriceRequest) =>
  getMeetingRoomReservationDurationKey(reservation.details.duration);

/** Each duration option's settled meeting-room price, keyed by duration. */
const getAdvertisedPricesByDuration = (
  requests: ReadonlyArray<MeetingRoomAdvertisedPriceRequest>,
  queryResults: ReadonlyArray<AdvertisedPriceQueryResult>
) => {
  const pricesByDuration = new Map<
    MeetingRoomReservationDurationKey,
    MeetingRoomAdvertisedPrice
  >();

  for (const [index, queryResult] of queryResults.entries()) {
    const request = requests[index];
    if (
      request &&
      !queryResult.isError &&
      queryResult.data &&
      isMeetingRoomAdvertisedPrice(queryResult.data)
    ) {
      pricesByDuration.set(getRequestDurationKey(request), queryResult.data);
    }
  }

  return pricesByDuration;
};

/** The selected duration's price state the checkout form submits and shows. */
const getMeetingRoomCheckoutAdvertisedPrice = ({
  advertisedPrice,
  durationKey,
  locale,
  queryResult,
}: {
  readonly advertisedPrice: MeetingRoomAdvertisedPrice | null;
  readonly durationKey: MeetingRoomReservationDurationKey;
  readonly locale: Locale;
  readonly queryResult: AdvertisedPriceQueryResult | undefined;
}) => ({
  token: advertisedPrice?.advertisedPriceToken,
  isFetching: queryResult?.isFetching ?? false,
  isError: queryResult?.isError ?? false,
  retry: () => void queryResult?.refetch(),
  sale: advertisedPrice
    ? {
        discounts: advertisedPrice.quote.payment.discounts,
        productLabel: getWorkspaceMeetingRoomDurationTitle(
          getMeetingRoomReservationDuration(durationKey),
          locale
        ),
      }
    : undefined,
  total: advertisedPrice
    ? getReservationAdvertisedTotal(advertisedPrice.quote.payment)
    : undefined,
});

/**
 * Every duration's price for the selected start, and the selected duration's
 * checkout price.
 */
export const useMeetingRoomAdvertisedPrices = ({
  durationKey,
  initialAdvertisedPrices,
  locale,
  startDateTime,
  submittedCode,
}: {
  readonly durationKey: MeetingRoomReservationDurationKey;
  readonly initialAdvertisedPrices: ReadonlyArray<PreloadedAdvertisedPrice>;
  readonly locale: Locale;
  readonly startDateTime: string;
  readonly submittedCode?: CanonicalPromotionCode;
}) => {
  const requests = useMemo(
    () =>
      getMeetingRoomDurationAdvertisedPriceRequests({
        locale,
        startDateTime,
        submittedCode,
      }),
    [locale, startDateTime, submittedCode]
  );
  const queryResults = useAdvertisedPrices(requests, initialAdvertisedPrices);
  const pricesByDuration = getAdvertisedPricesByDuration(
    requests,
    queryResults
  );

  return {
    checkoutAdvertisedPrice: getMeetingRoomCheckoutAdvertisedPrice({
      advertisedPrice: pricesByDuration.get(durationKey) ?? null,
      durationKey,
      locale,
      queryResult:
        queryResults[
          requests.findIndex(
            (request) => getRequestDurationKey(request) === durationKey
          )
        ],
    }),
    pricesByDuration,
  };
};
