import { Effect, Layer } from "effect";
import type { AdvertisedPriceRequest } from "@/features/checkout/advertised-price";
import type {
  PreloadedWorkspaceAvailability,
  WorkspaceAvailabilityQuery,
} from "@/features/reservation/workspace-availability";
import {
  type IReservationPagePreloads,
  ReservationPagePreloads,
} from "./reservation-page-preloads.service";

type AvailabilityPreload = Parameters<
  IReservationPagePreloads["availability"]
>[0];

/** A preloaded query whose every option is free. */
const freeAvailabilityPreload = (
  query: WorkspaceAvailabilityQuery
): PreloadedWorkspaceAvailability => ({
  query,
  availability: {
    from: query.from,
    to: query.to,
    unavailableDates: [],
    reservedDeskWorkstationRequiredDates: [],
    unavailableCoworkTiers: [],
    meetingRoomUnavailable: false,
    officeUnavailable: false,
    unavailableMonitorOptions: [],
    notices: [],
  },
  loadedAt: 1,
});

/**
 * Page preloads that record what a page asks for. Unless `preloads` answers
 * a group, no price preloads and every availability query reads as free.
 */
export const recordReservationPagePreloads = (
  preloads: Partial<IReservationPagePreloads> = {}
) => {
  const advertisedPriceRequests: Array<ReadonlyArray<AdvertisedPriceRequest>> =
    [];
  const availabilityPreloads: Array<AvailabilityPreload> = [];

  return {
    advertisedPriceRequests,
    availabilityPreloads,
    layer: Layer.succeed(ReservationPagePreloads, {
      advertisedPrices: (requests) =>
        Effect.suspend(() => {
          advertisedPriceRequests.push(requests);
          return preloads.advertisedPrices?.(requests) ?? Effect.succeed([]);
        }),
      availability: (preload) =>
        Effect.suspend(() => {
          availabilityPreloads.push(preload);
          return (
            preloads.availability?.(preload) ??
            Effect.succeed(preload.queries.map(freeAvailabilityPreload))
          );
        }),
    }),
  };
};
