import { type SQLWrapper, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { passPurchases } from "@/db/schema";
import type { PlainDate } from "@/shared/utils/temporal";
import { unlimitedPassDays } from "../pass-offer";

export const overlapsUnlimitedPassWindow = (
  pass: {
    readonly product: SQLWrapper;
    readonly status: SQLWrapper;
    readonly validFrom: SQLWrapper;
    readonly validUntil: SQLWrapper;
    readonly accessEndsOn: SQLWrapper;
  },
  window: {
    readonly validFrom: PlainDate | SQLWrapper;
    readonly validUntil: PlainDate | SQLWrapper;
  },
  includePending: boolean
) => sql<boolean>`(
  ${pass.product} = 'unlimited'
  and ${pass.validFrom} < ${window.validUntil}
  and coalesce(${pass.accessEndsOn}, ${pass.validUntil}) > ${window.validFrom}
  and (${pass.status} = 'active'
    or (${includePending} and ${pass.status} = 'pending_payment')
    or (${pass.status} in ('withdrawn', 'cancelled') and ${pass.accessEndsOn} > ${pass.validFrom}))
)`;

const entitlement = alias(passPurchases, "entitlement");

/** Paid entitlement can block a renewal even if it came from a regular purchase. */
export const hasUnlimitedRenewalOverlap = sql<boolean>`exists (
  select 1 from ${passPurchases} as "entitlement"
  where ${entitlement.id} <> ${passPurchases.id}
    and ${entitlement.holderAccountId} = ${passPurchases.holderAccountId}
    and ${overlapsUnlimitedPassWindow(
      entitlement,
      {
        validFrom: passPurchases.validUntil,
        validUntil: sql`${passPurchases.validUntil} + ${unlimitedPassDays}::integer`,
      },
      false
    )}
)`;
