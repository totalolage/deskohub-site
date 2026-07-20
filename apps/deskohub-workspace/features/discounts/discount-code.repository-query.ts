import { and, count, eq, gt, or, sql } from "drizzle-orm";
import type { WorkspaceDatabaseClient } from "@/db/database.service";
import { discountCodeCustomers, discountCodeRedemptions } from "@/db/schema";
import type { DiscountCodeId } from "./persistence-contracts";

type DiscountCodeAvailabilityTimestamp =
  (typeof discountCodeRedemptions.$inferSelect)["reservationExpiresAt"];

export const buildDiscountCodeAvailabilityQueries = (input: {
  readonly db: WorkspaceDatabaseClient;
  readonly codeId: DiscountCodeId;
  readonly dotyposCustomerId: string;
  readonly at: DiscountCodeAvailabilityTimestamp;
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
    })
    .from(discountCodeRedemptions)
    .where(
      and(
        eq(discountCodeRedemptions.codeId, input.codeId),
        or(
          eq(discountCodeRedemptions.state, "redeemed"),
          and(
            eq(discountCodeRedemptions.state, "reserved"),
            gt(discountCodeRedemptions.reservationExpiresAt, input.at)
          )
        )
      )
    ),
});
