import "@/shared/testing/workspace-test-env";

import { describe, expect, test } from "bun:test";
import { Effect, Layer } from "effect";
import { customerAccountIdSchema } from "../../customer-account";
import { CustomerAccountDeletionService } from "../customer-account-deletion";
import { SavedCardService } from "../saved-card/saved-card.service";
import { workspaceSavedCardDeletionReconciliation } from "./workspace-deletion-reconciliation";

const accountId = customerAccountIdSchema.make("auth-user-deletion-1");

const makeDeletionLayer = (state: {
  calls: string[];
  markFails?: boolean;
  requestFails?: boolean;
}) =>
  Layer.mock(CustomerAccountDeletionService, {
    markDeletionRequested: () =>
      state.markFails
        ? Effect.die(new Error("marker write failed"))
        : Effect.sync(() => {
            state.calls.push("marker");
          }),
    requestDeletion: () =>
      Effect.sync(() => {
        state.calls.push("dotypos");
      }),
  } satisfies Partial<CustomerAccountDeletionService["Service"]>);

const makeSavedCardsLayer = (state: {
  calls: string[];
  deactivateFails?: boolean;
}) =>
  Layer.mock(SavedCardService, {
    deactivateAllForDeletion: () =>
      state.deactivateFails
        ? Effect.fail(
            new (class extends Error {
              readonly code = "unavailable";
            })("nexi unavailable")
          )
        : Effect.sync(() => {
            state.calls.push("cards");
          }),
  } satisfies Partial<SavedCardService["Service"]>);

describe("workspace saved-card deletion reconciliation ordering", () => {
  test("marks the durable deletion marker before any provider work, then Dotypos last", async () => {
    const state = { calls: [] as string[] };
    await Effect.runPromise(
      workspaceSavedCardDeletionReconciliation(accountId).pipe(
        Effect.provide(
          Layer.mergeAll(
            makeDeletionLayer(state),
            makeSavedCardsLayer(state)
          ) as Layer.Layer<never>
        )
      )
    );

    expect(state.calls).toEqual(["marker", "cards", "dotypos"]);
  });

  test("a retryable card failure blocks the deletion after the marker landed", async () => {
    const state = {
      calls: [] as string[],
      deactivateFails: true,
    };
    await expect(
      Effect.runPromise(
        workspaceSavedCardDeletionReconciliation(accountId).pipe(
          Effect.provide(
            Layer.mergeAll(
              makeDeletionLayer(state),
              makeSavedCardsLayer(state)
            ) as Layer.Layer<never>
          )
        )
      )
    ).rejects.toMatchObject({ code: "unavailable" });

    // The marker is durable and Dotypos expiration never ran: the account is
    // deletion-blocked, and a retry resumes after the marker.
    expect(state.calls).toEqual(["marker"]);
  });
});
