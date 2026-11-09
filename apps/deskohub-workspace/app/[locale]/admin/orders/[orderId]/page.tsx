import { Suspense } from "react";
import { AdministrationRecordLink } from "@/features/administration/admin-link";
import { administrationHref } from "@/features/administration/administration-href";
import {
  AdministrationAlert,
  AdministrationFact,
  AdministrationPage,
  AdministrationPageHeader,
  NexiOrderLink,
} from "@/features/administration/components";
import { m } from "@/features/administration/i18n";
import { AdministrationDetailLoading } from "@/features/administration/loading";
import { loadAdministrationOrder } from "@/features/administration/page-data.server";
import {
  formatOrderMoney,
  formatProviderDateTime,
  formatProviderMoney,
  PaymentAttemptStatusBadge,
} from "@/features/administration/payment-components";
import { getProviderValueLabel } from "@/features/administration/payment-presentation";
import { OperationTable } from "@/features/administration/payment-tables";
import type { Locale } from "@/features/i18n";
import { getRequestLocale } from "@/features/i18n/server/request-locale";

export default function OrderAdministrationDetailPage({
  params,
}: {
  readonly params: Promise<{ readonly orderId: string }>;
}) {
  return <OrderAdministrationDetailScreen params={params} />;
}

async function OrderAdministrationDetailScreen({
  params,
}: {
  readonly params: Promise<{ readonly orderId: string }>;
}) {
  const locale = await getRequestLocale();
  return (
    <AdministrationPage>
      <Suspense
        fallback={
          <AdministrationDetailLoading
            label={m.administrationOrderDetailLoading({}, { locale })}
          />
        }
      >
        <OrderAdministrationDetail locale={locale} params={params} />
      </Suspense>
    </AdministrationPage>
  );
}

type Order = Awaited<ReturnType<typeof loadAdministrationOrder>>;
type OrderLink = NonNullable<Order["link"]>;
type ProviderOrder = NonNullable<Order["provider"]>;

export async function OrderAdministrationDetail({
  locale,
  params,
}: {
  readonly locale: Locale;
  readonly params: Promise<{ readonly orderId: string }>;
}) {
  const { orderId } = await params;
  const order = await loadAdministrationOrder(orderId);
  return (
    <>
      <AdministrationPageHeader
        actions={
          <NexiOrderLink
            className="inline-flex rounded-lg border border-navy-blue/15 px-3 py-2 text-sm font-semibold hover:bg-navy-blue/5"
            locale={locale}
            orderId={order.orderId}
          >
            {m.administrationOrderOpenInXPay({}, { locale })}
          </NexiOrderLink>
        }
        description={m.administrationOrderDetailDescription({}, { locale })}
        eyebrow={m.administrationOrderDetailEyebrow({}, { locale })}
        title={order.orderId}
      />
      <OrderProviderStatusAlert
        locale={locale}
        providerStatus={order.providerStatus}
      />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-6">
          <OrderFacts locale={locale} order={order} />
          <OrderOperations locale={locale} order={order} />
        </div>
        <aside className="space-y-5 xl:sticky xl:top-24 xl:h-fit">
          <OrderRelatedReservation link={order.link} locale={locale} />
          {order.link && (
            <OrderLocalAttempt link={order.link} locale={locale} />
          )}
        </aside>
      </div>
    </>
  );
}

function OrderProviderStatusAlert({
  locale,
  providerStatus,
}: {
  readonly locale: Locale;
  readonly providerStatus: Order["providerStatus"];
}) {
  if (providerStatus === "not_found") {
    return (
      <AdministrationAlert className="mb-5" status="error">
        {m.administrationOrderDetailNotFound({}, { locale })}
      </AdministrationAlert>
    );
  }
  if (providerStatus === "unavailable") {
    return (
      <AdministrationAlert className="mb-5" status="warning">
        {m.administrationOrderDetailUnavailable({}, { locale })}
      </AdministrationAlert>
    );
  }
  return null;
}

function OrderFacts({
  locale,
  order,
}: {
  readonly locale: Locale;
  readonly order: Order;
}) {
  const provider: Partial<ProviderOrder> = order.provider ?? {};
  return (
    <section className="rounded-xl border border-navy-blue/10 bg-white p-5 sm:p-6">
      <h2 className="text-xl">
        {m.administrationOrderDetailTitle({}, { locale })}
      </h2>
      <dl className="mt-5 grid gap-5 text-sm sm:grid-cols-2 lg:grid-cols-3">
        <AdministrationFact
          label={m.administrationOrderFactAmount({}, { locale })}
          value={formatOrderMoney(order, locale)}
        />
        <AdministrationFact
          label={m.administrationOrderFactAuthorized({}, { locale })}
          value={formatProviderMoney(
            provider.authorizedAmount,
            provider.currency,
            locale
          )}
        />
        <AdministrationFact
          label={m.administrationOrderFactCaptured({}, { locale })}
          value={formatProviderMoney(
            provider.capturedAmount,
            provider.currency,
            locale
          )}
        />
        <AdministrationFact
          label={m.administrationOrderFactLastOperation({}, { locale })}
          value={
            provider.lastOperationType
              ? getProviderValueLabel(provider.lastOperationType, locale)
              : m.administrationOrderNotReported({}, { locale })
          }
        />
        <AdministrationFact
          label={m.administrationOrderFactLastActivity({}, { locale })}
          value={formatProviderDateTime(provider.lastOperationTime, locale)}
        />
        <OrderCreatedFact link={order.link} locale={locale} />
      </dl>
    </section>
  );
}

function OrderCreatedFact({
  link,
  locale,
}: {
  readonly link: Order["link"];
  readonly locale: Locale;
}) {
  return (
    <AdministrationFact
      label={
        link?.providerOrderCreatedAtEstimated
          ? m.administrationOrderFactCreatedEstimated({}, { locale })
          : m.administrationOrderFactCreated({}, { locale })
      }
      value={
        link?.providerOrderCreatedAt
          ? formatProviderDateTime(link.providerOrderCreatedAt, locale)
          : m.administrationOrderNotRecorded({}, { locale })
      }
    />
  );
}

function OrderOperations({
  locale,
  order,
}: {
  readonly locale: Locale;
  readonly order: Order;
}) {
  const linkedReservationId = order.link?.reservationId ?? null;
  const operations = (order.provider?.operations ?? []).map((operation) => ({
    ...operation,
    linkedReservationId,
  }));
  return (
    <section>
      <div className="mb-4">
        <h2 className="text-xl">
          {m.administrationOrderOperationsTitle({}, { locale })}
        </h2>
        <p className="mt-1 text-sm text-navy-blue/65">
          {m.administrationOrderOperationsDescription({}, { locale })}
        </p>
      </div>
      <OperationTable operations={operations} />
    </section>
  );
}

function OrderRelatedReservation({
  link,
  locale,
}: {
  readonly link: Order["link"];
  readonly locale: Locale;
}) {
  return (
    <section className="rounded-xl border border-navy-blue/10 bg-white p-3">
      <h2 className="px-3 pb-2 pt-1 text-xs font-semibold uppercase tracking-[0.12em] text-navy-blue/65">
        {m.administrationOrderRelatedReservation({}, { locale })}
      </h2>
      {link ? (
        <AdministrationRecordLink
          href={administrationHref(
            "/[locale]/admin/reservations/[reservationId]",
            { reservationId: link.reservationId }
          )}
        >
          <span className="block font-semibold">
            {m.administrationOrderViewReservation({}, { locale })}
          </span>
          <span className="mt-1 block font-mono text-xs text-navy-blue/65">
            {link.reservationId}
          </span>
        </AdministrationRecordLink>
      ) : (
        <p className="px-3 py-3 text-sm text-navy-blue/65">
          {m.administrationOrderNoLinkedAttempt({}, { locale })}
        </p>
      )}
    </section>
  );
}

function OrderLocalAttempt({
  link,
  locale,
}: {
  readonly link: OrderLink;
  readonly locale: Locale;
}) {
  return (
    <section className="rounded-xl border border-navy-blue/10 bg-white p-5">
      <h2 className="text-sm font-semibold">
        {m.administrationOrderLocalAttempt({}, { locale })}
      </h2>
      <div className="mt-3">
        <PaymentAttemptStatusBadge link={link} locale={locale} />
      </div>
      <p className="mt-3 break-all font-mono text-xs text-navy-blue/65">
        {link.paymentAttemptId}
      </p>
    </section>
  );
}
