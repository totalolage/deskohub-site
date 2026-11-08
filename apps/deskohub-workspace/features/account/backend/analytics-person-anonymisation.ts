import "server-only";

import { Context, Effect, Layer } from "effect";
import type { CustomerAccountId } from "@/features/account/customer-account";

// Integration stub of the stream contract; the anonymisation stream's file
// replaces it whole.
export class AnalyticsPersonAnonymisation extends Context.Service<
  AnalyticsPersonAnonymisation,
  {
    /** Schedules, after the response, deletion of a deleted account's PostHog person; events stay. Never fails. */
    readonly anonymiseDeletedAccount: (
      accountId: CustomerAccountId
    ) => Effect.Effect<void>;
    /** Schedules, after the response, deletion of the account's PostHog person, skipped at dispatch once the account's current analytics decision is no longer a withdrawal; events stay. Never fails. */
    readonly anonymiseWithdrawnAccount: (
      accountId: CustomerAccountId
    ) => Effect.Effect<void>;
  }
>()("@deskohub-workspace/account/AnalyticsPersonAnonymisation") {
  static Live = Layer.succeed(this, {
    anonymiseDeletedAccount: () => Effect.void,
    anonymiseWithdrawnAccount: () => Effect.void,
  });
}
