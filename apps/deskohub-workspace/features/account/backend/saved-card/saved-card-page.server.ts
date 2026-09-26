import "server-only";

import { Effect, Result } from "effect";
import { SavedCardService } from "@/features/account/backend/saved-card/saved-card.service";
import type { SavedCardView } from "@/features/account/contracts";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";
import type { LinkedCustomerAccount } from "../../customer-account";

/**
 * Page-data loader for the account billing section: the active saved cards
 * for an already-resolved linked account, or "unavailable" when the provider
 * or database cannot be reached right now (fail-closed, never an empty list).
 */
export const loadSavedCards = async (
  account: LinkedCustomerAccount
): Promise<readonly SavedCardView[] | "unavailable"> => {
  const cards = await Effect.flatMap(SavedCardService, (savedCards) =>
    savedCards.listCards(account)
  ).pipe(
    Effect.provide(SavedCardService.Live),
    Effect.tapError((error) =>
      Effect.logWarning("Saved card list could not be loaded", {
        code: error instanceof Error ? error.name : "saved-card.unavailable",
      })
    ),
    Effect.result,
    runWorkspaceEffect("account.saved-cards", { boundary: "page" })
  );

  return Result.isSuccess(cards) ? cards.success : "unavailable";
};
