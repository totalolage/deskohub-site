import { Effect, Layer, Schema } from "effect";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { cache, Suspense } from "react";
import { WorkspaceDatabase } from "@/db/database.service";
import { CurrentCustomerAccount } from "@/features/account/backend/current-customer-account";
import { CustomerAccountContactService } from "@/features/account/backend/customer-account-contact.service";
import { getAccountSignInPath } from "@/features/account/routes";
import { getDiscountCodeEntryEnabled } from "@/features/discounts/discount-code-entry.server";
import { type Locale, m } from "@/features/i18n";
import { runWithRequestLocale } from "@/features/i18n/server/request-locale";
import { type OrderId, orderIdSchema } from "@/features/order";
import { isCoworkPassesPageOpenAfterConnection } from "@/features/passes/backend/cowork-passes-release-gate.server";
import { readOwnedPassPurchaseOrderLocale } from "@/features/passes/backend/entry-pack-order";
import { readPassPurchaseBuyer } from "@/features/passes/backend/pass-purchase-buyer";
import {
  loadUnlimitedCheckoutContinuation,
  readUnlimitedCheckoutRenewal,
} from "@/features/passes/backend/unlimited-pass-purchase";
import { UnlimitedPassCheckout } from "@/features/passes/components/unlimited-pass-checkout";
import { unlimitedPassDays } from "@/features/passes/pass-offer";
import { getUnlimitedRenewalPath } from "@/features/passes/routes";
import {
  beginUnlimitedCheckout,
  getUnlimitedCheckoutAvailability,
  payUnlimitedCheckout,
  repriceUnlimitedCheckout,
} from "@/features/passes/unlimited-checkout-actions";
import {
  getUnlimitedPassChoosePath,
  getUnlimitedPassDetailsPath,
  getUnlimitedPassPayPath,
  readUnlimitedPassSelection,
  type UnlimitedPassOrderLink,
  unlimitedCheckoutPredecessorLimit,
} from "@/features/passes/unlimited-pass-checkout";
import { createNoindexedPageMetadata } from "@/features/public-pages/page-metadata";
import { getCurrentWorkspaceDate } from "@/features/reservation/reservation-date";
import { reservationStatusPath } from "@/features/reservation/routes";
import { getWorkspaceAvailabilityRange } from "@/features/reservation/workspace-availability";
import { runWorkspaceEffectOrElse } from "@/shared/backend/workspace-effect";
import { QueryProvider } from "@/shared/components/query-provider";
import { formatCount } from "@/shared/utils/number";
import { currentInstant, plainDateStringSchema } from "@/shared/utils/temporal";

export const instant = false;
export const maxDuration = 240;

type Query = Parameters<typeof readUnlimitedPassSelection>[0] & {
  readonly step?: string | string[];
  readonly order?: string | string[];
  readonly submittedOrder?: string | string[];
  readonly supersedeOrder?: string | string[];
  readonly predecessorOrder?: string | string[];
  readonly renew?: string | string[];
};

const customerServices = Layer.mergeAll(
  WorkspaceDatabase.Default,
  CurrentCustomerAccount.Live,
  CustomerAccountContactService.Live
);

const workspaceDate = (instant: Temporal.Instant) =>
  plainDateStringSchema.make(getCurrentWorkspaceDate(instant).toString());

const readContinuation = cache(
  (orderId: OrderId, mode: "draft" | "submitted" | "payment-retry") =>
    loadUnlimitedCheckoutContinuation(orderId, mode).pipe(
      Effect.provide(customerServices),
      runWorkspaceEffectOrElse("passes.unlimited-checkout-continuation", {
        failureCode: "unlimited_checkout_unavailable",
        orElse: () => undefined,
      })
    )
);

const readOwnedLocale = cache((orderId: OrderId) =>
  readOwnedPassPurchaseOrderLocale(orderId, "unlimited").pipe(
    Effect.provide(customerServices),
    runWorkspaceEffectOrElse("passes.unlimited-checkout-order-locale", {
      failureCode: "unlimited_checkout_unavailable",
      orElse: () => undefined,
    })
  )
);

const readRenewal = (passId: OrderId, resumePending: boolean) =>
  readUnlimitedCheckoutRenewal(passId, resumePending).pipe(
    Effect.provide(customerServices),
    runWorkspaceEffectOrElse("passes.unlimited-checkout-renewal", {
      failureCode: "unlimited_checkout_unavailable",
      orElse: () => undefined,
    })
  );

async function leaveUnavailableOrder(orderId: OrderId): Promise<never> {
  const locale = await readOwnedLocale(orderId);
  if (locale) redirect(`/${locale}${reservationStatusPath}/${orderId}`);
  notFound();
}

function readOrderLink(query: Query): UnlimitedPassOrderLink | undefined {
  if (
    query.submittedOrder !== undefined ||
    query.predecessorOrder !== undefined
  ) {
    const { submittedOrder, predecessorOrder } = query;
    const ids = Array.isArray(predecessorOrder)
      ? predecessorOrder
      : [predecessorOrder].filter((id) => id !== undefined);
    const isOrderId = Schema.is(orderIdSchema);
    if (
      query.order !== undefined ||
      query.supersedeOrder !== undefined ||
      (query.step !== undefined && query.step !== "details") ||
      ids.length > unlimitedCheckoutPredecessorLimit ||
      !ids.every(isOrderId)
    )
      notFound();
    const predecessorOrderIds = [
      ...new Set(ids.map((id) => orderIdSchema.make(id.toLowerCase()))),
    ];
    if (submittedOrder === undefined)
      return { kind: "edit", predecessorOrderIds };
    if (!isOrderId(submittedOrder)) notFound();
    const orderId = orderIdSchema.make(submittedOrder.toLowerCase());
    if (predecessorOrderIds.includes(orderId)) notFound();
    return { kind: "submitted", orderId, predecessorOrderIds };
  }
  if (query.order !== undefined && query.supersedeOrder !== undefined)
    notFound();
  if (query.supersedeOrder !== undefined && query.step === "pay") notFound();
  const orderId = query.order ?? query.supersedeOrder;
  if (orderId === undefined) return undefined;
  if (!Schema.is(orderIdSchema)(orderId)) notFound();
  return { kind: query.order !== undefined ? "resume" : "replace", orderId };
}

async function requirePageOpen(searchParams: Promise<Query>) {
  if (await isCoworkPassesPageOpenAfterConnection()) return;
  const order = readOrderLink(await searchParams);
  const orderId =
    order?.kind === "edit" ? order.predecessorOrderIds[0] : order?.orderId;
  if (orderId) await leaveUnavailableOrder(orderId);
  notFound();
}

export async function generateMetadata({
  searchParams,
}: {
  readonly searchParams: Promise<Query>;
}): Promise<Metadata> {
  return runWithRequestLocale(async (locale) => {
    await requirePageOpen(searchParams);
    return createNoindexedPageMetadata({
      locale,
      title: { page: m.unlimitedPassCheckoutTitle({}, { locale }) },
      description: m.unlimitedPassCheckoutMetadataDescription(
        { days: formatCount(unlimitedPassDays, locale) },
        { locale }
      ),
    });
  });
}

export default async function UnlimitedPassPage({
  searchParams,
}: {
  readonly searchParams: Promise<Query>;
}) {
  return runWithRequestLocale(async (locale) => {
    await requirePageOpen(searchParams);
    return (
      <Suspense fallback={null}>
        <UnlimitedPassPageContent searchParams={searchParams} locale={locale} />
      </Suspense>
    );
  });
}

async function UnlimitedPassPageContent({
  searchParams,
  locale,
}: {
  readonly searchParams: Promise<Query>;
  readonly locale: Locale;
}) {
  const query = await searchParams;
  const order = readOrderLink(query);
  if (query.renew !== undefined && !Schema.is(orderIdSchema)(query.renew))
    notFound();
  const requestedRenewal = query.renew;
  const orderId = order?.kind === "edit" ? undefined : order?.orderId;
  const isRetry = order?.kind === "resume" && query.step === "pay";
  const continuationMode = order?.kind === "submitted" ? "submitted" : "draft";
  const { options, startDate } = readUnlimitedPassSelection(query);
  const requestedSelection = startDate && { ...options, startDate };
  if (order?.kind === "submitted" && !requestedSelection && !requestedRenewal)
    notFound();
  const checkoutPath = (
    targetLocale: Locale,
    selection: typeof requestedSelection = requestedSelection,
    renewsPassId = requestedRenewal
  ) => {
    if (isRetry && orderId)
      return getUnlimitedPassPayPath(targetLocale, orderId);
    if (query.step === "details" && selection) {
      return getUnlimitedPassDetailsPath(
        targetLocale,
        selection,
        order,
        renewsPassId
      );
    }
    if (renewsPassId && !order && query.tier === undefined)
      return getUnlimitedRenewalPath(targetLocale, renewsPassId);
    return getUnlimitedPassChoosePath(
      targetLocale,
      selection ?? options,
      selection?.startDate,
      order,
      renewsPassId
    );
  };
  const [checkout, continuation] = await Promise.all([
    Effect.all({
      buyer: readPassPurchaseBuyer(),
      today: currentInstant.pipe(Effect.map(workspaceDate)),
      discountCodeEntryEnabled: getDiscountCodeEntryEnabled.pipe(
        Effect.orElseSucceed(() => false)
      ),
    }).pipe(
      Effect.provide(customerServices),
      runWorkspaceEffectOrElse("passes.unlimited-checkout-page", {
        failureCode: "unlimited_checkout_unavailable",
        orElse: () => ({
          buyer: { kind: "unavailable" as const },
          today: workspaceDate(Temporal.Now.instant()),
          discountCodeEntryEnabled: false,
        }),
      })
    ),
    orderId &&
      readContinuation(orderId, isRetry ? "payment-retry" : continuationMode),
  ]);
  if ((order || requestedRenewal) && checkout.buyer.kind === "signed-out") {
    redirect(getAccountSignInPath(locale, checkoutPath(locale)));
  }
  if (orderId) {
    if (continuation?.kind === "status") {
      redirect(`/${continuation.locale}${reservationStatusPath}/${orderId}`);
    }
    if (!continuation && order?.kind !== "submitted") notFound();
  }

  const draft = continuation?.kind !== "status" ? continuation : undefined;
  const resumesDraft = order?.kind === "resume" || order?.kind === "submitted";
  if (
    draft &&
    resumesDraft &&
    requestedRenewal &&
    requestedRenewal !== draft.renewsPassId
  )
    notFound();
  const renewsPassId =
    (resumesDraft && draft ? draft.renewsPassId : requestedRenewal) ??
    undefined;
  const renewal =
    renewsPassId && (!resumesDraft || !draft)
      ? await readRenewal(renewsPassId, !order && query.tier === undefined)
      : undefined;
  if (renewsPassId && (!resumesDraft || !draft) && !renewal) notFound();
  if (renewal?.pendingOrderId) {
    redirect(
      getUnlimitedPassDetailsPath(
        locale,
        renewal.selection,
        {
          kind: "resume",
          orderId: renewal.pendingOrderId,
        },
        renewsPassId
      )
    );
  }

  const renewalSelection = renewal && {
    ...(query.tier === undefined ? renewal.selection : options),
    startDate: renewal.selection.startDate,
  };
  const selection =
    resumesDraft && draft
      ? draft.selection
      : (renewalSelection ?? requestedSelection);
  const retryPayment = draft?.kind === "pay" ? draft.retryPayment : undefined;
  if (draft && draft.locale !== locale) {
    redirect(checkoutPath(draft.locale, selection, renewsPassId));
  }

  const { today } = checkout;

  return (
    <QueryProvider>
      <UnlimitedPassCheckout
        locale={locale}
        buyer={checkout.buyer}
        discountCodeEntryEnabled={checkout.discountCodeEntryEnabled}
        initialOptions={selection ?? options}
        initialStartDate={selection?.startDate}
        initialDetails={query.step === "details" ? selection : undefined}
        renewsPassId={renewsPassId}
        initialBounds={{
          today,
          lastStartDate: plainDateStringSchema.make(
            getWorkspaceAvailabilityRange(today).to
          ),
        }}
        draft={
          order && draft
            ? { ...order, holderEmail: draft.holderEmail ?? null }
            : order
        }
        retryPayment={
          orderId && draft && retryPayment
            ? {
                orderId,
                selection: draft.selection,
                state: {
                  ...retryPayment,
                  holderEmail: draft.holderEmail,
                },
              }
            : undefined
        }
        getAvailability={getUnlimitedCheckoutAvailability}
        beginCheckout={beginUnlimitedCheckout}
        repriceCheckout={repriceUnlimitedCheckout}
        payCheckout={payUnlimitedCheckout}
      />
    </QueryProvider>
  );
}
