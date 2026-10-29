import "server-only";

import { Layer } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { CustomerAccountResolver } from "@/features/account";
import { MarketingConsentLedger } from "./backend/marketing-consent-ledger";
import { MarketingManagementService } from "./backend/marketing-management.service";

/**
 * Shared server-side composition for the legal marketing-preference
 * boundaries. `WorkspaceDatabase.Default` is provided once to the merged
 * layer so all three capabilities share one database dependency.
 */
export const marketingPreferencesLive = Layer.mergeAll(
  CustomerAccountResolver.Live,
  MarketingManagementService.Default,
  MarketingConsentLedger.Default
).pipe(Layer.provide(WorkspaceDatabase.Default));

export const marketingManagementLive = MarketingManagementService.Default.pipe(
  Layer.provide(WorkspaceDatabase.Default)
);
