import { Suspense } from "react";
import { AdministrationRecordLink } from "@/features/administration/admin-link";
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

export async function OrderAdministrationDetail({
  locale,
  params,
}: {
  readonly locale: Locale;
  readonly params: Promise<{ readonly orderId: string }>;
}) {
  const { orderId } = await params;
  const order = await loadAdministrationOrder(orderId);
  const operations = (order.provider?.operations ?? []).map((operation) => ({
    ...operation,
    linkedReservationId: order.link?.reservationId ?? null,
  }));
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
      {order.providerStatus === "not_found" && (
        <AdministrationAlert className="mb-5" status="error">
          {m.administrationOrderDetailNotFound({}, { locale })}
        </AdministrationAlert>
      )}
      {order.providerStatus === "unavailable" && (
        <AdministrationAlert className="mb-5" status="warning">
          {m.administrationOrderDetailUnavailable({}, { locale })}
        </AdministrationAlert>
      )}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-6">
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
                  order.provider?.authorizedAmount,
                  order.provider?.currency,
                  locale
                )}
              />
              <AdministrationFact
                label={m.administrationOrderFactCaptured({}, { locale })}
                value={formatProviderMoney(
                  order.provider?.capturedAmount,
                  order.provider?.currency,
                  locale
                )}
              />
              <AdministrationFact
                label={m.administrationOrderFactLastOperation({}, { locale })}
                value={
                  order.provider?.lastOperationType
                    ? getProviderValueLabel(
                        order.provider.lastOperationType,
                        locale
                      )
                    : m.administrationOrderNotReported({}, { locale })
                }
              />
              <AdministrationFact
                label={m.administrationOrderFactLastActivity({}, { locale })}
                value={formatProviderDateTime(
                  order.provider?.lastOperationTime,
                  locale
                )}
              />
              <AdministrationFact
                label={
                  order.link?.providerOrderCreatedAtEstimated
                    ? m.administrationOrderFactCreatedEstimated({}, { locale })
                    : m.administrationOrderFactCreated({}, { locale })
                }
                value={
                  order.link?.providerOrderCreatedAt
                    ? formatProviderDateTime(
                        order.link.providerOrderCreatedAt,
                        locale
                      )
                    : m.administrationOrderNotRecorded({}, { locale })
                }
              />
            </dl>
          </section>
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
        </div>
        <aside className="space-y-5 xl:sticky xl:top-24 xl:h-fit">
          <section className="rounded-xl border border-navy-blue/10 bg-white p-3">
            <h2 className="px-3 pb-2 pt-1 text-xs font-semibold uppercase tracking-[0.12em] text-navy-blue/65">
              {m.administrationOrderRelatedReservation({}, { locale })}
            </h2>
            {order.link ? (
              <AdministrationRecordLink
                href={`/admin/reservations/${order.link.reservationId}`}
              >
                <span className="block font-semibold">
                  {m.administrationOrderViewReservation({}, { locale })}
                </span>
                <span className="mt-1 block font-mono text-xs text-navy-blue/65">
                  {order.link.reservationId}
                </span>
              </AdministrationRecordLink>
            ) : (
              <p className="px-3 py-3 text-sm text-navy-blue/65">
                {m.administrationOrderNoLinkedAttempt({}, { locale })}
              </p>
            )}
          </section>
          {order.link && (
            <section className="rounded-xl border border-navy-blue/10 bg-white p-5">
              <h2 className="text-sm font-semibold">
                {m.administrationOrderLocalAttempt({}, { locale })}
              </h2>
              <div className="mt-3">
                <PaymentAttemptStatusBadge link={order.link} locale={locale} />
              </div>
              <p className="mt-3 break-all font-mono text-xs text-navy-blue/65">
                {order.link.paymentAttemptId}
              </p>
            </section>
          )}
        </aside>
      </div>
    </>
  );
}
