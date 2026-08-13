import type { DotyposCustomerId } from "@deskohub/dotypos";
import { and, count, eq, inArray, sql } from "drizzle-orm";
import type { WorkspaceDatabaseClient } from "@/db/database.service";
import { discountCodeCustomers, discountCodeRedemptions } from "@/db/schema";
import type { DiscountCodeId } from "./persistence-contracts";

export const buildDiscountCodeAvailabilityQueries = (input: {
  readonly db: WorkspaceDatabaseClient;
  readonly codeId: DiscountCodeId;
  readonly dotyposCustomerId: DotyposCustomerId;
}) => ({
  allowlist: input.db
    .select({
      allowlistSize: count(),
      customerAllowed: sql<boolean>`coalesce(bool_or(${discountCodeCustomers.dotyposCustomerId} = ${input.dotyposCustomerId}), false)`,
    })
    .from(discountCodeCustomers)
    .where(eq(discountCodeCustomers.codeId, input.codeId)),
  activeClaims: input.db
    .select({
      activeUseCount: count(),
    })
    .from(discountCodeRedemptions)
    .where(
      and(
        eq(discountCodeRedemptions.codeId, input.codeId),
        inArray(discountCodeRedemptions.state, ["reserved", "redeemed"])
      )
    ),
  customerActiveClaims: input.db
    .select({ customerActiveUseCount: count() })
    .from(discountCodeRedemptions)
    .where(
      and(
        eq(discountCodeRedemptions.codeId, input.codeId),
        eq(discountCodeRedemptions.dotyposCustomerId, input.dotyposCustomerId),
        inArray(discountCodeRedemptions.state, ["reserved", "redeemed"])
      )
    ),
});
