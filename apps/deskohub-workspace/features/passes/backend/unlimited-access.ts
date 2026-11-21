import { DotyposService } from "@deskohub/dotypos";
import { and, eq, isNotNull, or, sql } from "drizzle-orm";
import { Effect, Layer, Option, Result } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { orders, passPurchases, workspaceReservations } from "@/db/schema";
import { CurrentCustomerAccount } from "@/features/account/backend/current-customer-account";
import { hasVerifiedActiveLogin } from "@/features/account/backend/customer-account-by-email";
import type { CustomerAccountId } from "@/features/account/customer-account";
import type { OrderId } from "@/features/order";
import { decodeBookedReservation } from "@/features/reservation/backend/booked-reservation";
import { getCoworkReservationInterval } from "@/features/reservation/cowork-reservation";
import { getCurrentWorkspaceDate } from "@/features/reservation/reservation-date";
import { ReservationAccessService } from "@/features/reservation-access";
import { WorkspaceDotyposLayer } from "@/shared/backend/config/dotypos.config";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";
import { withWorkspaceRequestContext } from "@/shared/backend/workspace-request-context";
import {
  currentInstant,
  type PlainDate,
  plainDateStringSchema,
} from "@/shared/utils/temporal";
import type { UnlimitedAccessView } from "../unlimited-access";
import { isUnlimitedPassRenewalEligible } from "../unlimited-pass";
import { getUnlimitedPassAccessDay } from "../unlimited-pass-period";
import { openUnlimitedAccessCookie } from "./unlimited-access-capability";
import { hasUnlimitedRenewalOverlap } from "./unlimited-pass-window";

const noPass = { state: "not-found" } as const;

const findAccessPassId = (
  orderId: OrderId,
  holderId: CustomerAccountId,
  date: PlainDate
) => sql<OrderId>`(
  with recursive paid_pass as not materialized (
    select pass.id, pass.status, pass.valid_from, pass.valid_until, pass.renews_pass_id,
      case when pass.status in ('active', 'expired')
        then coalesce(pass.access_ends_on, pass.valid_until)
        else pass.access_ends_on
      end as entitled_until
    from ${passPurchases} pass
    join ${orders} purchase_order on purchase_order.id = pass.id
    where pass.holder_account_id = ${holderId} and pass.product = 'unlimited'
      and pass.status in ('active', 'expired', 'cancelled', 'withdrawn')
      and (pass.buyer_account_id = pass.holder_account_id or pass.gift_claimed_at is not null)
      and purchase_order.kind = 'pass-purchase' and purchase_order.payment_state = 'paid'
      and purchase_order.paid_at is not null
  ), renewal_chain as (
    select id, status, valid_from, valid_until, entitled_until from paid_pass where id = ${orderId}
    union all
    select next_pass.id, next_pass.status, next_pass.valid_from, next_pass.valid_until, next_pass.entitled_until
    from renewal_chain current_pass
    join paid_pass next_pass on next_pass.renews_pass_id = current_pass.id
    where next_pass.valid_from = current_pass.valid_until
      and next_pass.valid_from <= ${date}::date
      and not exists (
        select 1 from paid_pass sibling
        where sibling.renews_pass_id = next_pass.renews_pass_id
          and sibling.valid_from = next_pass.valid_from
          and sibling.id <> next_pass.id
          and sibling.entitled_until > sibling.valid_from
      )
  )
  select coalesce(
    (select min(id) from renewal_chain
      where status <> 'expired'
        and ${date}::date >= valid_from and ${date}::date < entitled_until
      having count(*) = 1),
    ${orderId}
  )
)`;

const readPassDay = Effect.fn("passes.unlimitedAccess.readDay")(function* (
  orderId: OrderId,
  signedInHolderId: CustomerAccountId | undefined,
  serviceDate: PlainDate
) {
  const { db } = yield* WorkspaceDatabase;
  const [access] = yield* db
    .select({
      id: passPurchases.id,
      tier: passPurchases.tier,
      status: passPurchases.status,
      validFrom: passPurchases.validFrom,
      validUntil: passPurchases.validUntil,
      accessEndsOn: passPurchases.accessEndsOn,
      holderAccountId: passPurchases.holderAccountId,
      paymentState: orders.paymentState,
      renewalOverlaps: hasUnlimitedRenewalOverlap,
      reservation: {
        id: workspaceReservations.id,
        dotyposId: workspaceReservations.dotyposReservationId,
        tableId: workspaceReservations.passDayTableId,
      },
    })
    .from(passPurchases)
    .innerJoin(orders, eq(orders.id, passPurchases.id))
    .leftJoin(
      workspaceReservations,
      and(
        eq(workspaceReservations.passId, passPurchases.id),
        eq(workspaceReservations.serviceDate, serviceDate),
        eq(workspaceReservations.paymentState, "paid"),
        eq(workspaceReservations.reservationState, "confirmed")
      )
    )
    .where(
      and(
        eq(
          passPurchases.id,
          signedInHolderId
            ? findAccessPassId(orderId, signedInHolderId, serviceDate)
            : orderId
        ),
        eq(passPurchases.product, "unlimited"),
        hasVerifiedActiveLogin(db, passPurchases.holderAccountId),
        or(
          eq(passPurchases.buyerAccountId, passPurchases.holderAccountId),
          isNotNull(passPurchases.giftClaimedAt)
        )
      )
    )
    .limit(1);

  return access;
});

const readPassAccess = Effect.fn("passes.unlimitedAccess.read")(function* (
  orderId: OrderId,
  isHolder: (accountId: CustomerAccountId) => boolean,
  sessionAccountId: CustomerAccountId | undefined,
  hasAccessCapability: boolean
) {
  const readDay = (date: Temporal.PlainDate) =>
    readPassDay(
      orderId,
      hasAccessCapability ? undefined : sessionAccountId,
      plainDateStringSchema.make(date.toString())
    );
  let requestedDate = getCurrentWorkspaceDate(yield* currentInstant);
  let access = yield* readDay(requestedDate);
  // Resolve both the paid pass and its day again if the query crossed midnight.
  let now = yield* currentInstant;
  let date = getCurrentWorkspaceDate(now);
  if (!requestedDate.equals(date)) {
    requestedDate = date;
    access = yield* readDay(requestedDate);
    now = yield* currentInstant;
    date = getCurrentWorkspaceDate(now);
  }

  if (
    !access ||
    !isHolder(access.holderAccountId) ||
    access.status === "pending_payment" ||
    access.status === "void"
  )
    return noPass;

  const { tier, validFrom, accessEndsOn, reservation, status } = access;
  const validUntil = accessEndsOn ?? access.validUntil;
  const period = { tier, validFrom, validUntil };
  const day = getUnlimitedPassAccessDay({ ...access, date });

  if (status === "active" && Temporal.PlainDate.compare(date, validFrom) < 0) {
    return { ...period, state: "before-start" } as const;
  }
  if (day === undefined) {
    const canRenew =
      sessionAccountId === access.holderAccountId &&
      access.paymentState === "paid" &&
      !access.renewalOverlaps &&
      isUnlimitedPassRenewalEligible(access, now);
    return {
      ...period,
      state: "ended",
      ...(canRenew && { renewalOrderId: access.id }),
    } as const;
  }

  const interval = getCoworkReservationInterval(
    tier === "open-space" ? "open-space" : "reserved-desk",
    date.toString()
  );
  const bounds = {
    startsAt: Temporal.Instant.from(interval.startsAt),
    endsAt: Temporal.Instant.from(interval.endsAt),
  };
  const view = {
    ...period,
    date,
    day,
    continuesTomorrow:
      Temporal.PlainDate.compare(date.add({ days: 1 }), validUntil) < 0,
  };

  if (Temporal.Instant.compare(now, bounds.endsAt) >= 0) {
    return { ...view, state: "closed" } as const;
  }
  if (!requestedDate.equals(date) || !reservation?.dotyposId) {
    return { ...view, state: "retry" } as const;
  }

  return {
    state: "open",
    view,
    bounds,
    passId: access.id,
    reservationId: reservation.id,
    dotyposId: reservation.dotyposId,
    tableId: reservation.tableId,
    holderAccountId: access.holderAccountId,
  } as const;
});

type OpenAccessDay = Extract<
  Effect.Success<ReturnType<typeof readPassAccess>>,
  { readonly state: "open" }
>;

const isSamePassDay = (expected: OpenAccessDay, actual: OpenAccessDay) =>
  expected.passId === actual.passId &&
  expected.holderAccountId === actual.holderAccountId &&
  expected.view.date.equals(actual.view.date) &&
  expected.reservationId === actual.reservationId &&
  expected.dotyposId === actual.dotyposId &&
  expected.tableId === actual.tableId &&
  expected.bounds.startsAt.equals(actual.bounds.startsAt) &&
  expected.bounds.endsAt.equals(actual.bounds.endsAt);

export const loadUnlimitedAccess = Effect.fn("passes.unlimitedAccess.load")(
  function* (
    orderId: OrderId,
    accessCookie?: string
  ): Effect.fn.Return<
    UnlimitedAccessView | typeof noPass | { readonly state: "sign-in" },
    Effect.Error<ReturnType<typeof readPassAccess>>,
    | WorkspaceDatabase
    | CurrentCustomerAccount
    | ReservationAccessService
    | DotyposService
  > {
    const account = yield* CurrentCustomerAccount;
    const session = yield* Effect.result(account.requireActive);
    const capability = accessCookie
      ? yield* Effect.option(openUnlimitedAccessCookie(orderId, accessCookie))
      : Option.none();
    const allowsHolder = Option.getOrUndefined(capability);
    if (Result.isFailure(session) && !allowsHolder) {
      if (session.failure.reason !== "unauthenticated") return noPass;
      const { db } = yield* WorkspaceDatabase;
      const [candidate] = yield* db
        .select({ id: passPurchases.id })
        .from(passPurchases)
        .where(
          and(
            eq(passPurchases.id, orderId),
            eq(passPurchases.product, "unlimited")
          )
        )
        .limit(1);
      return candidate ? { state: "sign-in" } : noPass;
    }

    const accountId = Result.isSuccess(session)
      ? session.success.accountId
      : undefined;
    // The exchanged capability pins the URL's pass but grants no renewal authority.
    const hasAccessCapability = allowsHolder !== undefined;
    const access = yield* readPassAccess(
      orderId,
      (holderId) => holderId === accountId || allowsHolder?.(holderId) === true,
      accountId,
      hasAccessCapability
    );
    if (access.state !== "open") return access;
    const recheckAccess = Effect.gen(function* () {
      const settledAccount =
        accountId === access.holderAccountId
          ? yield* Effect.option(account.requireActive)
          : Option.none();
      const settledAccountId = Option.getOrUndefined(settledAccount)?.accountId;
      return yield* readPassAccess(
        orderId,
        (holderId) =>
          holderId === access.holderAccountId &&
          (holderId === settledAccountId || allowsHolder?.(holderId) === true),
        settledAccountId,
        hasAccessCapability
      );
    });

    const dotypos = yield* DotyposService;
    const record = yield* dotypos
      .getReservationWithoutCustomer(access.dotyposId)
      .pipe(
        Effect.timeout("8 seconds"),
        Effect.orElseSucceed(() => undefined)
      );
    const booked =
      record && Option.getOrUndefined(decodeBookedReservation(record).interval);
    const matchesBooking =
      record?.status === "CONFIRMED" &&
      record.id === access.dotyposId &&
      record._tableId === access.tableId &&
      booked?.startsAt.equals(access.bounds.startsAt) &&
      booked.endsAt.equals(access.bounds.endsAt);

    const deskLabel =
      !matchesBooking || access.view.tier === "open-space"
        ? undefined
        : yield* dotypos.getTables().pipe(
            Effect.map((tables) =>
              tables.find((table) => table.id === access.tableId)?.name?.trim()
            ),
            Effect.timeout("3 seconds"),
            Effect.orElseSucceed(() => undefined)
          );

    // Time and entitlement can change while the venue reads are in flight.
    const latest = yield* recheckAccess;
    if (latest.state !== "open") return latest;
    if (!matchesBooking || !isSamePassDay(access, latest)) {
      return { ...latest.view, state: "retry" };
    }

    const codes = yield* ReservationAccessService;
    const issued = yield* codes
      .issueForReservation({
        reservationId: access.reservationId,
        reservedFrom: access.bounds.startsAt,
        reservedUntil: access.bounds.endsAt,
      })
      .pipe(
        Effect.tapError(() =>
          Effect.logWarning("Unlimited pass access code could not be issued")
        ),
        Effect.option
      );

    const settled = yield* recheckAccess;
    if (settled.state !== "open") return settled;
    if (!isSamePassDay(access, settled) || Option.isNone(issued)) {
      return { ...settled.view, state: "retry" };
    }

    return {
      ...settled.view,
      state: "available",
      code: issued.value.accessCode,
      endsAt: access.bounds.endsAt,
      ...(deskLabel && { deskLabel }),
    };
  }
);

export const loadUnlimitedAccessPage = (
  orderId: OrderId,
  requestHeaders: Headers,
  accessCookie: string | undefined
) =>
  loadUnlimitedAccess(orderId, accessCookie).pipe(
    Effect.provide(
      Layer.mergeAll(
        WorkspaceDatabase.Default,
        CurrentCustomerAccount.Live,
        ReservationAccessService.Live,
        WorkspaceDotyposLayer
      )
    ),
    withWorkspaceRequestContext(requestHeaders),
    runWorkspaceEffect("passes.unlimitedAccess.load")
  );
