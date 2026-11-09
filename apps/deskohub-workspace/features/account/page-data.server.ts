import "server-only";

import { Effect } from "effect";
import { cache } from "react";
import {
  accountPageCapabilities,
  liveAccountPageLayers,
} from "@/features/account/account-page-capabilities.server";
import {
  type CustomerAccountStateWithHistory,
  loadAccountStateWithHistory,
} from "@/features/account/backend/account-state";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";

// The account page state is the account state with the reservation history
// each state shows. Loading it never fails, and keeps the account state's
// deliberate side effects (auto-link referral recording and the signup
// referral retry).
export {
  type CustomerAccountStateWithHistory as CustomerAccountPageState,
  loadAccountStateWithHistory as loadAccountPageState,
} from "@/features/account/backend/account-state";

/**
 * Loads the account page state behind the page's single runtime edge. The
 * account page is the signed-in customer's site locale, so it reads no
 * separate language preference.
 */
export const loadCustomerAccountPage = cache(
  (): Promise<CustomerAccountStateWithHistory> =>
    loadAccountStateWithHistory.pipe(
      Effect.provide(accountPageCapabilities(liveAccountPageLayers)),
      runWorkspaceEffect("account.page", { boundary: "page" })
    )
);
