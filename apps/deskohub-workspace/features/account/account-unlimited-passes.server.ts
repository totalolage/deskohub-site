import "server-only";

import { and, asc, eq, isNotNull, ne, notInArray, or } from "drizzle-orm";
import { Effect, Layer } from "effect";
import { cache } from "react";
import { WorkspaceDatabase } from "@/db/database.service";
import { orders, passPurchases, workspaceReservations } from "@/db/schema";
import { CurrentCustomerAccount } from "@/features/account/backend/current-customer-account";
import type { CustomerAccountId } from "@/features/account/customer-account";
import type { Locale } from "@/features/i18n";
import type { OrderId } from "@/features/order";
import { recoverEntryPackGiftClaims } from "@/features/passes/backend/entry-pack-gift";
import { hasUnlimitedRenewalOverlap } from "@/features/passes/backend/unlimited-pass-window";
import { getPassTierName } from "@/features/passes/pass-offer.i18n";
import {
  getUnlimitedAccessPath,
  getUnlimitedRenewalPath,
} from "@/features/passes/routes";
import { isUnlimitedPassRenewalEligible } from "@/features/passes/unlimited-pass";
import { getUnlimitedPassAccessDay } from "@/features/passes/unlimited-pass-period";
import { AdvisoryAvailabilityInventory } from "@/features/reservation/backend/availability-inventory";
import { SharedAvailabilityInventoryLive } from "@/features/reservation/backend/availability-inventory-cache.server";
import { getCurrentWorkspaceDate } from "@/features/reservation/reservation-date";
import {
  catchRecoverableCause,
  runWorkspaceEffectOrElse,
} from "@/shared/backend/workspace-effect";
import {
  formatInstantDate,
  formatPlainDate,
  formatPlainDateRange,
} from "@/shared/utils/date-time-format";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";
import { currentInstant } from "@/shared/utils/temporal";

export type AccountUnlimitedPass = {
  readonly orderId: OrderId;
  readonly tier: string;
  readonly boughtOn: string;
  readonly boughtForYou: boolean;
  readonly period: string;
  readonly renewalPath?: string;
  readonly seating:
    | { readonly kind: "shared" }
    | { readonly kind: "assigned"; readonly name?: string };
} & (
  | { readonly status: "upcoming"; readonly startsOn: string }
  | {
      readonly status: "active";
      readonly day: number;
      readonly daysLeft: number;
      readonly accessPath: string;
    }
  | { readonly status: "expired" | "ended" }
);

export type AccountUnlimitedPasses =
  | readonly AccountUnlimitedPass[]
  | "unavailable";

const readHolderPasses = Effect.fn("account.readHolderUnlimitedPasses")(
  function* (accountId: CustomerAccountId) {
    const { db } = yield* WorkspaceDatabase;
    return yield* db
      .select({
        orderId: passPurchases.id,
        tier: passPurchases.tier,
        buyerAccountId: passPurchases.buyerAccountId,
        validFrom: passPurchases.validFrom,
        validUntil: passPurchases.validUntil,
        accessEndsOn: passPurchases.accessEndsOn,
        status: passPurchases.status,
        paidAt: orders.paidAt,
        paymentState: orders.paymentState,
        renewalOverlaps: hasUnlimitedRenewalOverlap,
        deskId: workspaceReservations.passDayTableId,
      })
      .from(passPurchases)
      .innerJoin(orders, eq(orders.id, passPurchases.id))
      .leftJoin(
        workspaceReservations,
        and(
          ne(passPurchases.tier, "open-space"),
          eq(workspaceReservations.passId, passPurchases.id),
          eq(workspaceReservations.serviceDate, passPurchases.validFrom)
        )
      )
      .where(
        and(
          eq(passPurchases.product, "unlimited"),
          eq(passPurchases.holderAccountId, accountId),
          or(
            eq(passPurchases.buyerAccountId, accountId),
            isNotNull(passPurchases.giftClaimedAt)
          ),
          eq(orders.kind, "pass-purchase"),
          isNotNull(orders.paidAt),
          notInArray(passPurchases.status, ["pending_payment", "void"])
        )
      )
      .orderBy(asc(passPurchases.validFrom), asc(passPurchases.id));
  }
);

export const loadAccountUnlimitedPasses = Effect.fn(
  "loadAccountUnlimitedPasses"
)(function* (locale: Locale) {
  const account = yield* CurrentCustomerAccount;
  const standing = yield* account.peek;
  if (
    (standing.kind !== "linked" && standing.kind !== "unlinked") ||
    standing.reviewMarker !== "absent"
  ) {
    return [];
  }

  const { accountId, verifiedSignInAt } = standing.session;
  yield* recoverEntryPackGiftClaims(accountId, verifiedSignInAt);
  const timeZone = workspaceSiteConstants.location.timeZone;
  const [passes, now] = yield* Effect.all(
    [readHolderPasses(accountId), currentInstant],
    { concurrency: "unbounded" }
  );
  const today = getCurrentWorkspaceDate(now);
  const tables = passes.some((pass) => pass.deskId !== null)
    ? yield* Effect.flatMap(
        AdvisoryAvailabilityInventory,
        (inventory) => inventory.tables
      ).pipe(catchRecoverableCause(() => Effect.succeed([])))
    : [];
  const deskNames = new Map(
    tables.map((table) => [table.id, table.name?.trim()])
  );

  return passes.flatMap((pass): AccountUnlimitedPass[] => {
    if (pass.paidAt === null) return [];

    const start = Temporal.PlainDate.from(pass.validFrom);
    const validUntil = pass.accessEndsOn ?? pass.validUntil;
    const end = Temporal.PlainDate.from(validUntil);
    const lastDay = end.subtract({ days: 1 });
    const period =
      Temporal.PlainDate.compare(start, lastDay) < 0
        ? formatPlainDateRange({ start, end: lastDay, locale })
        : formatPlainDate({ date: start, locale });
    const seating =
      pass.tier === "open-space"
        ? ({ kind: "shared" } as const)
        : ({
            kind: "assigned",
            name: pass.deskId ? deskNames.get(pass.deskId) : undefined,
          } as const);
    const summary = {
      orderId: pass.orderId,
      tier: getPassTierName(pass.tier, locale),
      boughtOn: formatInstantDate({ instant: pass.paidAt, locale, timeZone }),
      boughtForYou: pass.buyerAccountId !== accountId,
      period,
      seating,
      ...(pass.paymentState === "paid" &&
        !pass.renewalOverlaps &&
        isUnlimitedPassRenewalEligible(pass, now) && {
          renewalPath: getUnlimitedRenewalPath(locale, pass.orderId),
        }),
    };
    const day = getUnlimitedPassAccessDay({ ...pass, date: today });

    if (
      day !== undefined &&
      (pass.status !== "active" || pass.paymentState === "paid")
    ) {
      return [
        {
          ...summary,
          status: "active",
          day,
          daysLeft: today.until(end, { largestUnit: "day" }).days,
          accessPath: getUnlimitedAccessPath(locale, pass.orderId),
        },
      ];
    }

    if (
      pass.status === "active" &&
      pass.paymentState === "paid" &&
      Temporal.PlainDate.compare(today, start) < 0
    ) {
      return [
        {
          ...summary,
          status: "upcoming",
          startsOn: formatPlainDate({ date: start, locale }),
        },
      ];
    }

    return [
      {
        ...summary,
        status:
          pass.status === "expired" ||
          (pass.status === "active" &&
            Temporal.PlainDate.compare(today, end) >= 0)
            ? "expired"
            : "ended",
      },
    ];
  });
});

export const loadCustomerAccountUnlimitedPasses = cache((locale: Locale) =>
  loadAccountUnlimitedPasses(locale).pipe(
    Effect.provide(
      Layer.mergeAll(
        CurrentCustomerAccount.Live,
        WorkspaceDatabase.Default,
        SharedAvailabilityInventoryLive
      )
    ),
    runWorkspaceEffectOrElse("account.unlimited-passes", {
      boundary: "page",
      failureCode: "account.unlimited-passes.unavailable",
      orElse: (): AccountUnlimitedPasses => "unavailable",
    })
  )
);
