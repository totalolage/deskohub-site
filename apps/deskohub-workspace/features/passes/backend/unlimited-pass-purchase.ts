import "server-only";

import { type DotyposCustomerId, DotyposService } from "@deskohub/dotypos";
import { and, eq, isNull } from "drizzle-orm";
import { Data, Effect, Layer, Schema } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import {
  customerAccounts,
  type Order,
  passPurchases,
  unlimitedPassSupersessions,
} from "@/db/schema";
import { WorkspaceLockSections } from "@/db/workspace-locks";
import { CurrentCustomerAccount } from "@/features/account/backend/current-customer-account";
import {
  ensurePassHolderAccount,
  findPassHolderAccount,
  findPurchaseLoginEmail,
} from "@/features/account/backend/customer-account-by-email";
import { CustomerAccountContactService } from "@/features/account/backend/customer-account-contact.service";
import { CustomerAccountSections } from "@/features/account/backend/customer-account-sections";
import type { CustomerAccountSession } from "@/features/account/backend/customer-authentication.service";
import type { CustomerProfileSave } from "@/features/account/contracts";
import type { CustomerAccountId } from "@/features/account/customer-account";
import { AccountingDocumentSnapshots } from "@/features/accounting/backend/accounting-document-snapshots";
import { AccountingSnapshotKeyService } from "@/features/accounting/backend/accounting-snapshot-key.service";
import { splitCustomerName } from "@/features/checkout/backend/reservation/dotypos-customer-policy";
import type { CanonicalPromotionCode } from "@/features/discounts/contracts";
import { DiscountService } from "@/features/discounts/discount.service";
import { type Locale, m } from "@/features/i18n";
import { getPaymentSubmitLegalDocuments } from "@/features/legal/payment-submit-evidence";
import {
  isEndedUnpaidPaymentState,
  type OrderId,
  orderIdSchema,
} from "@/features/order";
import { getCurrentWorkspaceDate } from "@/features/reservation/reservation-date";
import { getWorkspaceAvailabilityRange } from "@/features/reservation/workspace-availability";
import {
  currentInstant,
  type PlainDate,
  plainDateStringSchema,
} from "@/shared/utils/temporal";
import { rejectedPassDayHoldCode } from "../pass-day-marker";
import {
  getEntryPackLastUsableDate,
  getUnlimitedPassPrice,
} from "../pass-offer";
import { passPurchaseQuoteCodec } from "../pass-purchase-quote";
import {
  type UnlimitedPassSelection,
  unlimitedPassRequiresEarlyStart,
  unlimitedPassSelectionSchema,
} from "../unlimited-pass";
import { findOwnedPassPurchaseOrder } from "./entry-pack-order";
import {
  displayPassPurchasePrice,
  EntryPackPurchaseError,
  requirePassPurchasesEnabled,
} from "./entry-pack-purchase";
import { hasUnlimitedPassFirstDayEnded } from "./entry-pack-settlement";
import { withUnlimitedPassCapacity } from "./unlimited-pass-capacity";
import {
  attemptUnlimitedPassHolds,
  readUnlimitedPassDays,
  releaseUnlimitedPassDays,
} from "./unlimited-pass-holds";
import {
  findPendingUnlimitedRenewal,
  readUnlimitedPassDesk,
  readUnlimitedPassRenewal,
  readUnlimitedPassSelection,
  recordUnlimitedPassOrder,
  UnlimitedPassAdmissionError,
} from "./unlimited-pass-orders";

type Purchase = typeof passPurchases.$inferSelect;
const sameSelection = Schema.toEquivalence(unlimitedPassSelectionSchema);

export const readUnlimitedCheckoutRenewal = Effect.fn(
  "readUnlimitedCheckoutRenewal"
)(
  function* (passId: OrderId, resumePending: boolean) {
    const account = yield* CurrentCustomerAccount;
    const session = yield* account.requireActive;
    const now = yield* currentInstant;
    const selection = yield* readUnlimitedPassRenewal(
      passId,
      session.accountId,
      now
    );
    if (!selection) return;
    const pendingOrderId = resumePending
      ? yield* findPendingUnlimitedRenewal(passId, session.accountId, now)
      : undefined;
    return { selection, pendingOrderId };
  },
  Effect.catchTag("CustomerAccountAccessError", () => Effect.undefined)
);

class UnlimitedPassDraftVoided extends Data.TaggedError(
  "UnlimitedPassDraftVoided"
)<{ readonly blockingDates: readonly PlainDate[] }> {}

const rejectedHoldDates = (
  days: Effect.Success<ReturnType<typeof readUnlimitedPassDays>>
) =>
  days.flatMap((day) =>
    day.failureCode === rejectedPassDayHoldCode ? [day.serviceDate] : []
  );

// Only void drafts store this checkout outcome alongside the original quote.
const voidedDraftDetails = Schema.Struct({
  voidBlockingDates: Schema.optionalKey(Schema.Array(plainDateStringSchema)),
});

const readVoidedDraftDates = (purchase: Purchase) =>
  Schema.decodeUnknownEffect(voidedDraftDetails)(purchase.quote).pipe(
    Effect.flatMap(({ voidBlockingDates }) =>
      voidBlockingDates === undefined
        ? readUnlimitedPassDays(purchase.id).pipe(Effect.map(rejectedHoldDates))
        : Effect.succeed(voidBlockingDates)
    )
  );

const isVoidedUnlimitedDraft = ({
  order,
  purchase,
}: {
  readonly order: Pick<Order, "paymentState" | "activePaymentAttemptId">;
  readonly purchase: Pick<Purchase, "status">;
}) =>
  purchase.status === "void" &&
  order.activePaymentAttemptId === null &&
  (order.paymentState === "not_started" || order.paymentState === "expired");

const resolveGiftCustomer = Effect.fn("resolveUnlimitedGiftCustomer")(
  function* (input: {
    readonly accountId: CustomerAccountId;
    readonly email: string;
    readonly recipientName?: string;
  }) {
    const { db } = yield* WorkspaceDatabase;
    const [holder] = yield* db
      .select({ customerId: customerAccounts.dotyposCustomerId })
      .from(customerAccounts)
      .where(
        and(
          eq(customerAccounts.id, input.accountId),
          isNull(customerAccounts.deletedAt)
        )
      );
    const unavailable = () =>
      new UnlimitedPassAdmissionError({ reason: "holder-unavailable" });
    if (!holder) return yield* unavailable();
    if (holder.customerId) return holder.customerId;
    const dotypos = yield* DotyposService;
    const lookup = () =>
      dotypos.findCustomer(
        { firstName: "", email: input.email },
        { lookupFields: ["email"] }
      );
    const existing = yield* lookup();
    if (existing._tag === "Matched") return existing.customer.id;
    if (existing._tag !== "NotFound" || !input.recipientName)
      return yield* unavailable();
    const { firstName, lastName = "" } = splitCustomerName(input.recipientName);
    const created = yield* dotypos.createCustomer({
      email: input.email,
      firstName,
      lastName,
      addressLine1: "",
      addressLine2: "",
      city: "",
      zip: "",
      country: "",
      companyName: "",
      companyId: "",
      vatId: "",
    });
    if (created.id) return created.id;
    const reread = yield* lookup();
    if (reread._tag === "Matched") return reread.customer.id;
    return yield* unavailable();
  }
);

const retireUnrecordedUnlimitedDraft = Effect.fn(
  "retireUnrecordedUnlimitedDraft"
)(function* (buyerAccountId: CustomerAccountId, orderId: OrderId) {
  const { db } = yield* WorkspaceDatabase;
  yield* db
    .insert(unlimitedPassSupersessions)
    .values({ buyerAccountId, orderId })
    .onConflictDoNothing();
});

type UnlimitedPassPurchaseInput = {
  readonly orderId: OrderId;
  readonly locale: Locale;
  readonly selection: UnlimitedPassSelection;
  readonly renewsPassId?: OrderId;
  readonly holderEmail?: string;
  readonly recipientName?: string;
  readonly buyerProfile?: CustomerProfileSave;
  readonly referralCode?: CanonicalPromotionCode;
  readonly supersedeOrderId?: OrderId;
  readonly supersedeOrderIds?: readonly OrderId[];
};

export const beginUnlimitedPassPurchase = Effect.fn(
  "beginUnlimitedPassPurchase"
)(function* (input: UnlimitedPassPurchaseInput) {
  yield* requirePassPurchasesEnabled();
  const current = yield* CurrentCustomerAccount;
  const session = yield* current.requireActive;
  const accounts = yield* CustomerAccountSections;
  const { db } = yield* WorkspaceDatabase;
  const priorOrderIds = new Set(
    [input.supersedeOrderId, ...(input.supersedeOrderIds ?? [])]
      .filter((id) => id !== undefined)
      .map((id) => orderIdSchema.make(id.toLowerCase()))
  );
  priorOrderIds.delete(orderIdSchema.make(input.orderId.toLowerCase()));
  const retiredPredecessorOrderIds: OrderId[] = [];
  const outcome = yield* Effect.result(
    Effect.gen(function* () {
      for (const priorOrderId of priorOrderIds) {
        yield* accounts.withActiveAccount(
          session.accountId,
          Effect.gen(function* () {
            const prior = yield* findOwnedPassPurchaseOrder(
              priorOrderId,
              session.accountId,
              "unlimited"
            );
            if (!prior) {
              yield* retireUnrecordedUnlimitedDraft(
                session.accountId,
                priorOrderId
              );
              retiredPredecessorOrderIds.push(priorOrderId);
              return;
            }
            if (prior.order.activePaymentAttemptId) return;
            let voided: Purchase | undefined;
            if (isVoidedUnlimitedDraft(prior)) {
              voided = prior.purchase;
            } else if (prior.order.paymentState === "not_started") {
              [voided] = yield* db
                .update(passPurchases)
                .set({ status: "void" })
                .where(
                  and(
                    eq(passPurchases.id, priorOrderId),
                    eq(passPurchases.status, "pending_payment")
                  )
                )
                .returning();
            }
            if (!voided) return;
            retiredPredecessorOrderIds.push(priorOrderId);
            yield* releaseUnlimitedPassDays(voided);
          }),
          { passPurchaseOrderId: priorOrderId }
        );
      }
      return yield* continueUnlimitedPassPurchase(input, session);
    })
  );
  return { outcome, retiredPredecessorOrderIds };
});

const continueUnlimitedPassPurchase = Effect.fn(
  "continueUnlimitedPassPurchase"
)(function* (
  input: UnlimitedPassPurchaseInput,
  session: CustomerAccountSession
) {
  const current = yield* CurrentCustomerAccount;
  const accounts = yield* CustomerAccountSections;
  const { db, transaction } = yield* WorkspaceDatabase;
  const holderEmail = input.holderEmail?.trim().toLowerCase();
  const giftEmail =
    holderEmail && holderEmail !== session.email.toLowerCase()
      ? holderEmail
      : undefined;
  if (input.renewsPassId && giftEmail) {
    return yield* new UnlimitedPassAdmissionError({
      reason: "renewal-unavailable",
    });
  }

  yield* accounts.withActiveAccount(
    session.accountId,
    Effect.gen(function* () {
      const existing = yield* findOwnedPassPurchaseOrder(
        input.orderId,
        session.accountId,
        "unlimited"
      );
      let purchase: Purchase;
      if (existing) {
        if (isVoidedUnlimitedDraft(existing)) {
          return yield* new UnlimitedPassDraftVoided({
            blockingDates: yield* readVoidedDraftDates(existing.purchase),
          });
        }
        const selection = readUnlimitedPassSelection(existing.purchase);
        const holderId = giftEmail
          ? yield* findPassHolderAccount(giftEmail)
          : session.accountId;
        if (
          existing.purchase.holderAccountId !== holderId ||
          existing.purchase.renewsPassId !== (input.renewsPassId ?? null) ||
          !selection ||
          !sameSelection(selection, input.selection)
        ) {
          const replaceable =
            existing.order.paymentState === "not_started" &&
            !existing.order.activePaymentAttemptId &&
            existing.purchase.status === "pending_payment";
          return yield* new UnlimitedPassAdmissionError({
            reason: replaceable ? "draft-changed" : "purchase-conflict",
          });
        }
        if (
          existing.order.paymentState !== "not_started" ||
          existing.order.activePaymentAttemptId
        ) {
          return yield* new EntryPackPurchaseError({
            reason: "payment-in-progress",
          });
        }
        purchase = existing.purchase;
      } else {
        const [superseded] = yield* db
          .select({ orderId: unlimitedPassSupersessions.orderId })
          .from(unlimitedPassSupersessions)
          .where(
            and(
              eq(unlimitedPassSupersessions.buyerAccountId, session.accountId),
              eq(unlimitedPassSupersessions.orderId, input.orderId)
            )
          );
        if (superseded) {
          return yield* new UnlimitedPassDraftVoided({ blockingDates: [] });
        }
        const now = yield* currentInstant;
        const today = getCurrentWorkspaceDate(now);
        const startDate = Temporal.PlainDate.from(input.selection.startDate);
        if (
          Temporal.PlainDate.compare(startDate, today) < 0 ||
          Temporal.PlainDate.compare(
            startDate,
            getWorkspaceAvailabilityRange(today.toString()).to
          ) > 0
        ) {
          return yield* new EntryPackPurchaseError({
            reason: "holds-unavailable",
          });
        }
        const renewsPassId = input.renewsPassId;
        const renewal = renewsPassId
          ? yield* readUnlimitedPassRenewal(
              renewsPassId,
              session.accountId,
              now
            )
          : undefined;
        if (renewsPassId && renewal?.startDate !== input.selection.startDate) {
          return yield* new UnlimitedPassAdmissionError({
            reason: "renewal-unavailable",
          });
        }
        const preferredDeskId =
          renewsPassId && input.selection.tier !== "open-space"
            ? yield* readUnlimitedPassDesk(renewsPassId)
            : undefined;
        const contacts = yield* CustomerAccountContactService;
        const standing = yield* current.peek;
        let buyerCustomerId: DotyposCustomerId | undefined;
        if (standing.kind === "linked")
          buyerCustomerId = standing.account.dotyposCustomerId;
        else if (standing.kind === "unlinked" && input.buyerProfile) {
          buyerCustomerId = (yield* contacts.completeProfile(
            session,
            input.buyerProfile
          ))?.dotyposCustomerId;
        } else if (standing.kind === "unavailable")
          return yield* standing.failure;
        if (!buyerCustomerId) {
          return yield* new EntryPackPurchaseError({
            reason: "buyer-profile-required",
          });
        }
        const buyer = {
          accountId: session.accountId,
          customerId: buyerCustomerId,
        };
        const holderAccountId = giftEmail
          ? yield* transaction(ensurePassHolderAccount(giftEmail))
          : session.accountId;
        if (!holderAccountId)
          return yield* new UnlimitedPassAdmissionError({
            reason: "holder-unavailable",
          });
        const holder = giftEmail
          ? {
              accountId: holderAccountId,
              customerId: yield* resolveGiftCustomer({
                accountId: holderAccountId,
                email: giftEmail,
                ...(input.recipientName && {
                  recipientName: input.recipientName,
                }),
              }).pipe(
                WorkspaceLockSections.unlimitedGiftCustomer(holderAccountId)
              ),
            }
          : buyer;

        const { selection, locale, orderId, referralCode } = input;
        const product = { kind: "unlimited", tier: selection.tier } as const;
        const discounts = yield* DiscountService;
        const quote = yield* discounts.quote({
          product,
          locale,
          bookedAt: now,
          dotyposCustomerId: buyerCustomerId,
          discountableSubtotal: getUnlimitedPassPrice(product),
          firstServiceDate: selection.startDate,
          lastServiceDate: selection.startDate,
          ...(referralCode !== undefined && { referralCode }),
        });
        purchase = yield* withUnlimitedPassCapacity(
          { selection, startDate, ...(preferredDeskId && { preferredDeskId }) },
          ({ days }) =>
            transaction(
              recordUnlimitedPassOrder({
                orderId,
                buyer,
                holder,
                locale,
                createdAt: now,
                selection,
                ...(renewsPassId && { renewsPassId }),
                quote: {
                  ...quote,
                  selection: referralCode ? { referralCode } : {},
                  ...(selection.tier === "open-space" &&
                    selection.coffee && { unlimitedCoffee: true }),
                },
                days: days.map((day) => ({
                  ...day,
                  serviceDate: plainDateStringSchema.make(
                    day.serviceDate.toString()
                  ),
                })),
              })
            )
        ).pipe(
          // A delayed Continue checks this retirement under the same buyer lock.
          Effect.catchTag("UnlimitedPassCapacityUnavailable", (error) =>
            retireUnrecordedUnlimitedDraft(session.accountId, orderId).pipe(
              Effect.andThen(Effect.fail(error))
            )
          )
        );
      }

      return purchase;
    })
  );

  return yield* accounts.withActiveAccount(
    session.accountId,
    Effect.gen(function* () {
      const prepared = yield* findOwnedPassPurchaseOrder(
        input.orderId,
        session.accountId,
        "unlimited"
      );
      if (prepared && isVoidedUnlimitedDraft(prepared)) {
        return yield* new UnlimitedPassDraftVoided({
          blockingDates: yield* readVoidedDraftDates(prepared.purchase),
        });
      }
      if (
        prepared?.order.paymentState !== "not_started" ||
        prepared.order.activePaymentAttemptId ||
        prepared.purchase.status !== "pending_payment"
      ) {
        return yield* new EntryPackPurchaseError({
          reason: "holds-unavailable",
        });
      }
      const { purchase } = prepared;
      const closedBeforeHolds = hasUnlimitedPassFirstDayEnded(
        purchase,
        yield* currentInstant
      );
      const attempt = closedBeforeHolds
        ? undefined
        : yield* attemptUnlimitedPassHolds(purchase);
      const firstDayEnded =
        closedBeforeHolds ||
        hasUnlimitedPassFirstDayEnded(purchase, yield* currentInstant);
      if (!attempt && !firstDayEnded) return purchase;

      const failure = attempt?.failure;
      const days = yield* readUnlimitedPassDays(purchase.id);
      const rejectedDates = rejectedHoldDates(days);
      const blocked =
        failure?._tag === "UnlimitedPassHoldsUnavailable" &&
        failure.reason !== "unfinished";
      if (failure && !firstDayEnded && !blocked && rejectedDates.length === 0)
        return yield* failure;

      const now = yield* currentInstant;
      const expiredDates = days.flatMap((day) =>
        day.reservationHoldExpiresAt &&
        Temporal.Instant.compare(now, day.reservationHoldExpiresAt) >= 0
          ? [day.serviceDate]
          : []
      );
      const blockingDates = [
        ...new Set([
          ...rejectedDates,
          ...expiredDates,
          ...(firstDayEnded ? [purchase.validFrom] : []),
          ...(attempt?.blockingDates ?? []),
          ...(blocked ? (failure.blockingDates ?? []) : []),
        ]),
      ].sort();
      const quote = { ...purchase.quote, voidBlockingDates: blockingDates };
      const [voided] = yield* db
        .update(passPurchases)
        .set({ status: "void", quote })
        .where(
          and(
            eq(passPurchases.id, purchase.id),
            eq(passPurchases.status, "pending_payment")
          )
        )
        .returning();
      if (!voided) {
        return yield* failure ??
          new EntryPackPurchaseError({ reason: "holds-unavailable" });
      }
      yield* releaseUnlimitedPassDays(voided).pipe(
        Effect.catch(() =>
          Effect.logWarning(
            "Unlimited pass hold compensation needs reconciliation"
          )
        )
      );
      return yield* new UnlimitedPassDraftVoided({ blockingDates });
    }),
    { passPurchaseOrderId: input.orderId }
  );
});

const readUnlimitedPassBuyerDraft = Effect.fn("readUnlimitedPassBuyerDraft")(
  function* (orderId: OrderId) {
    const account = yield* CurrentCustomerAccount;
    const { accountId } = yield* account.requireActive;
    const order = yield* findOwnedPassPurchaseOrder(
      orderId,
      accountId,
      "unlimited"
    );
    if (!order) return undefined;
    const { purchase } = order;
    const selection = readUnlimitedPassSelection(purchase);
    return {
      ...order,
      selection,
      holderEmail:
        purchase.holderAccountId === accountId
          ? undefined
          : yield* findPurchaseLoginEmail(purchase.holderAccountId),
    };
  }
);

export const getUnlimitedPassPaymentDisclosure = (
  locale: Locale,
  earlyStartRequired: boolean
) => ({
  documents: getPaymentSubmitLegalDocuments(locale),
  ...(earlyStartRequired && {
    earlyStartRequest: m.unlimitedPassEarlyStartConsent({}, { locale }),
  }),
});

export const loadUnlimitedCheckoutContinuation = Effect.fn(
  "loadUnlimitedCheckoutContinuation"
)(
  function* (orderId: OrderId, mode: "draft" | "submitted" | "payment-retry") {
    const draft = yield* readUnlimitedPassBuyerDraft(orderId).pipe(
      Effect.catchTag("CustomerAccountAccessError", () => Effect.undefined)
    );
    if (!draft) return undefined;
    const { order, purchase, selection, holderEmail, activeAttempt } = draft;
    const status = { kind: "status" as const, locale: purchase.locale };
    if (!selection) return status;
    const priorPaymentAttemptId = order.activePaymentAttemptId;
    const now = yield* currentInstant;
    const payable =
      purchase.status === "pending_payment" &&
      purchase.holdsExpireAt &&
      Temporal.Instant.compare(now, purchase.holdsExpireAt) < 0;
    const base = {
      locale: purchase.locale,
      selection,
      holderEmail,
      renewsPassId: purchase.renewsPassId,
    };
    if (
      mode === "submitted" &&
      ((priorPaymentAttemptId === null &&
        purchase.status === "pending_payment" &&
        order.paymentState === "not_started") ||
        isVoidedUnlimitedDraft(draft))
    )
      return { ...base, kind: "details" as const };
    if (!payable) return status;
    if (mode !== "payment-retry") {
      return order.paymentState === "not_started"
        ? { ...base, kind: "details" as const }
        : status;
    }
    if (
      !priorPaymentAttemptId ||
      !isEndedUnpaidPaymentState(order.paymentState) ||
      !activeAttempt ||
      activeAttempt.refundState !== "not_required" ||
      !isEndedUnpaidPaymentState(activeAttempt.state)
    )
      return status;
    const documents = yield* AccountingDocumentSnapshots;
    const snapshot = yield* documents.findPassPurchase(priorPaymentAttemptId);
    if (!snapshot) return status;
    const quote = yield* Schema.decodeEffect(passPurchaseQuoteCodec)(
      purchase.quote
    );
    return {
      ...base,
      kind: "pay" as const,
      retryPayment: {
        billing: snapshot.billing,
        price: displayPassPurchasePrice(quote),
        disclosure: getUnlimitedPassPaymentDisclosure(
          purchase.locale,
          unlimitedPassRequiresEarlyStart(
            purchase.validFrom,
            getCurrentWorkspaceDate(now)
          )
        ),
        priorPaymentAttemptId,
        validFrom: purchase.validFrom,
        lastUsableDate: getEntryPackLastUsableDate(
          purchase.validUntil
        ).toString(),
      },
    };
  },
  Effect.provide(
    AccountingDocumentSnapshots.Default.pipe(
      Layer.provide(
        Layer.mergeAll(
          WorkspaceDatabase.Default,
          AccountingSnapshotKeyService.Default
        )
      )
    )
  )
);
