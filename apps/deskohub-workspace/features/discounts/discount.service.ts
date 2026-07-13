import { Context, type Effect } from "effect";
import type { DiscountCommitment } from "./commitment";
import type { DiscountQuote, DiscountQuoteInput } from "./contracts";
import type { DiscountResolutionError } from "./errors";

export type DiscountRevalidation = {
  readonly quote: DiscountQuote;
  readonly commitment: DiscountCommitment;
};

export interface IDiscountService {
  readonly quote: (
    input: DiscountQuoteInput
  ) => Effect.Effect<DiscountQuote, DiscountResolutionError>;
  readonly revalidate: (
    input: DiscountQuoteInput
  ) => Effect.Effect<DiscountRevalidation, DiscountResolutionError>;
}

export class DiscountService extends Context.Service<
  DiscountService,
  IDiscountService
>()("@deskohub-workspace/discounts/DiscountService") {
  // Live provider composition is added with the unified service implementation.
}
