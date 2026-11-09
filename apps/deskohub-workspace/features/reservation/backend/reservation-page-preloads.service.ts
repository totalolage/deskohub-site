import "server-only";

import { Context, Effect, Layer } from "effect";
import type {
  AdvertisedPriceRequest,
  PreloadedAdvertisedPrice,
} from "@/features/checkout/advertised-price";
import type {
  PreloadedWorkspaceAvailability,
  WorkspaceAvailabilityQuery,
} from "@/features/reservation/workspace-availability";
import { preloadPageAdvertisedPrices } from "./advertised-prices.server";
import { preloadPageAvailability } from "./workspace-availability-loader";

/**
 * What a reservation page streams with its content so no price or
 * availability loads in afterward. Each group waits up to its own page preload
 * deadline and never fails: whatever it leaves out, the client loads.
 */
export interface IReservationPagePreloads {
  readonly advertisedPrices: (
    requests: ReadonlyArray<AdvertisedPriceRequest>
  ) => Effect.Effect<ReadonlyArray<PreloadedAdvertisedPrice>>;
  readonly availability: (preload: {
    readonly queries: ReadonlyArray<WorkspaceAvailabilityQuery>;
    /** The Pay state being replaced, whose own hold reads as free. */
    readonly replacementToken?: string;
  }) => Effect.Effect<ReadonlyArray<PreloadedWorkspaceAvailability>>;
}

export class ReservationPagePreloads extends Context.Service<
  ReservationPagePreloads,
  IReservationPagePreloads
>()("@deskohub-workspace/reservation/ReservationPagePreloads") {
  /**
   * Live pricing and availability. Each group builds its services inside its
   * own deadline, so a slow or failing build only leaves that group to the
   * client, and a group with nothing to load builds none.
   */
  static readonly Default = Layer.succeed(this, {
    advertisedPrices: (requests) =>
      requests.length > 0
        ? preloadPageAdvertisedPrices(requests)
        : Effect.succeed([]),
    availability: (preload) =>
      preload.queries.length > 0
        ? preloadPageAvailability(preload)
        : Effect.succeed([]),
  });
}
