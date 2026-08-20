import type { DotyposCustomerId } from "@deskohub/dotypos";
import { and, count, eq, inArray, sql } from "drizzle-orm";
import type { WorkspaceDatabaseClient } from "@/db/database.service";
import {
  discountApplications,
  discountCodeRedemptions,
  promotionCodeCustomers,
  voucherRedemptions,
} from "@/db/schema";
import type {
  DiscountCodeId,
  PromotionCodeId,
  VoucherId,
} from "./persistence-contracts";

export const buildPromotionAudienceQuery = (input: {
  readonly db: WorkspaceDatabaseClient;
  readonly promotionCodeId: PromotionCodeId;
  readonly dotyposCustomerId: DotyposCustomerId;
}) =>
  input.db
    .select({
      allowlistSize: count(),
      customerAllowed: sql<boolean>`coalesce(bool_or(${promotionCodeCustomers.dotyposCustomerId} = ${input.dotyposCustomerId}), false)`,
    })
    .from(promotionCodeCustomers)
    .where(eq(promotionCodeCustomers.promotionCodeId, input.promotionCodeId));

export const buildDiscountCodeAvailabilityQuery = (input: {
  readonly db: WorkspaceDatabaseClient;
  readonly codeId: DiscountCodeId;
  readonly dotyposCustomerId: DotyposCustomerId;
}) =>
  input.db
    .select({
      activeUseCount: count(),
      customerActiveUseCount: sql<number>`count(*) filter (where ${discountCodeRedemptions.dotyposCustomerId} = ${input.dotyposCustomerId})::integer`,
    })
    .from(discountCodeRedemptions)
    .where(
      and(
        eq(discountCodeRedemptions.codeId, input.codeId),
        inArray(discountCodeRedemptions.state, ["reserved", "redeemed"])
      )
    );

export const buildDiscountCodePreviewAvailabilityQuery = (input: {
  readonly db: WorkspaceDatabaseClient;
  readonly codeId: DiscountCodeId;
}) =>
  input.db
    .select({ activeUseCount: count() })
    .from(discountCodeRedemptions)
    .where(
      and(
        eq(discountCodeRedemptions.codeId, input.codeId),
        inArray(discountCodeRedemptions.state, ["reserved", "redeemed"])
      )
    );

export const buildVoucherAvailabilityQuery = (input: {
  readonly db: WorkspaceDatabaseClient;
  readonly voucherId: VoucherId;
  readonly dotyposCustomerId: DotyposCustomerId;
}) =>
  input.db
    .select({
      customerHasReserved: sql<boolean>`coalesce(bool_or(${voucherRedemptions.dotyposCustomerId} = ${input.dotyposCustomerId} and ${voucherRedemptions.state} = 'reserved'), false)`,
      usedValue: sql<number>`coalesce(sum(${discountApplications.appliedAmountValue}), 0)::integer`,
    })
    .from(voucherRedemptions)
    .innerJoin(
      discountApplications,
      eq(discountApplications.id, voucherRedemptions.applicationId)
    )
    .where(
      and(
        eq(voucherRedemptions.voucherId, input.voucherId),
        inArray(voucherRedemptions.state, ["reserved", "redeemed"])
      )
    );
