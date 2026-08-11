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
      customerHasRedeemed: sql<boolean>`coalesce(bool_or(${discountCodeRedemptions.dotyposCustomerId} = ${input.dotyposCustomerId} and ${discountCodeRedemptions.state} = 'redeemed'), false)`,
      customerHasReserved: sql<boolean>`coalesce(bool_or(${discountCodeRedemptions.dotyposCustomerId} = ${input.dotyposCustomerId} and ${discountCodeRedemptions.state} = 'reserved'), false)`,
    })
    .from(discountCodeRedemptions)
    .where(
      and(
        eq(discountCodeRedemptions.codeId, input.codeId),
        inArray(discountCodeRedemptions.state, ["reserved", "redeemed"])
      )
    ),
});
