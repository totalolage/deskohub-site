import { Effect, Layer } from "effect";
import { ReviewAccounts } from "./review-accounts.repository";

export const ReviewAccountsMock = Layer.mock(ReviewAccounts);

/** No account is a review account, as for every ordinary customer. */
export const NoReviewAccounts = ReviewAccountsMock({
  isReviewAccount: () => Effect.succeed(false),
});
