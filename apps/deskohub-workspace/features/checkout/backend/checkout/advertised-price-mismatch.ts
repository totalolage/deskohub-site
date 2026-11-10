import { Data, Effect } from "effect";
import type { AdvertisedPriceState } from "./advertised-price-state";

/** The submitted reservation can't use the advertisement snapshot it carries. */
export class AdvertisedPriceMismatchError extends Data.TaggedError(
  "AdvertisedPriceMismatchError"
)<{
  readonly reason: "invalid_token" | "input_mismatch";
  readonly message: string;
  readonly cause?: unknown;
}> {
  static inputMismatch = () =>
    new AdvertisedPriceMismatchError({
      reason: "input_mismatch",
      message:
        "Advertised price snapshot does not match the submitted reservation.",
    });
}

/** An opened advertisement snapshot of one reservation family. */
export type FamilyAdvertisedPriceState<
  Kind extends AdvertisedPriceState["kind"],
> = Extract<AdvertisedPriceState, { readonly kind: Kind }>;

/**
 * The snapshot when it advertised the `kind` family. A snapshot of another
 * family doesn't match the submitted reservation.
 */
export const requireAdvertisedPriceStateKind =
  <Kind extends AdvertisedPriceState["kind"]>(kind: Kind) =>
  (state: AdvertisedPriceState) =>
    Effect.succeed(state).pipe(
      Effect.filterOrFail(
        (candidate): candidate is FamilyAdvertisedPriceState<Kind> =>
          candidate.kind === kind,
        AdvertisedPriceMismatchError.inputMismatch
      )
    );
