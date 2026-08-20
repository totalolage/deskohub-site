import { Suspense } from "react";
import { AdministrationLink as Link } from "@/features/administration/admin-link";
import {
  AdministrationAlert,
  AdministrationFact,
  AdministrationPage,
  AdministrationPageHeader,
  NexiOrderLink,
} from "@/features/administration/components";
import { AdministrationDetailLoading } from "@/features/administration/loading";
import { loadAdministrationOrder } from "@/features/administration/page-data.server";
import {
  formatOrderMoney,
  formatProviderDateTime,
  formatProviderMoney,
  ProviderStatusBadge,
} from "@/features/administration/payment-components";
import { getProviderValueLabel } from "@/features/administration/payment-presentation";
import { OperationTable } from "@/features/administration/payment-tables";

export default function OrderAdministrationDetailPage({
  params,
}: {
  readonly params: Promise<{ readonly orderId: string }>;
}) {
  return (
    <AdministrationPage>
      <Suspense
        fallback={<AdministrationDetailLoading label="order details" />}
      >
        <OrderAdministrationDetail params={params} />
      </Suspense>
    </AdministrationPage>
  );
}

export async function OrderAdministrationDetail({
  params,
}: {
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
            orderId={order.orderId}
          >
            Open in XPay
          </NexiOrderLink>
        }
        description="Provider facts, local reconciliation, and every operation returned for this order."
        eyebrow="Nexi order"
        title={order.orderId}
      />
      {order.providerStatus === "not_found" && (
        <AdministrationAlert className="mb-5" status="error">
          Nexi did not find this locally referenced order. Use the XPay link to
          confirm the merchant account and identifier.
        </AdministrationAlert>
      )}
      {order.providerStatus === "unavailable" && (
        <AdministrationAlert className="mb-5" status="warning">
          Nexi details are temporarily unavailable. Local relationship data is
          still shown below.
        </AdministrationAlert>
      )}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-6">
          <section className="rounded-xl border border-navy-blue/10 bg-white p-5 sm:p-6">
            <h2 className="text-xl">Order details</h2>
            <dl className="mt-5 grid gap-5 text-sm sm:grid-cols-2 lg:grid-cols-3">
              <AdministrationFact
                label="Amount"
                value={formatOrderMoney(order)}
              />
              <AdministrationFact
                label="Authorized"
                value={formatProviderMoney(
                  order.provider?.authorizedAmount,
                  order.provider?.currency
                )}
              />
              <AdministrationFact
                label="Captured"
                value={formatProviderMoney(
                  order.provider?.capturedAmount,
                  order.provider?.currency
                )}
              />
              <AdministrationFact
                label="Last operation"
                value={
                  order.provider?.lastOperationType
                    ? getProviderValueLabel(order.provider.lastOperationType)
                    : "Not reported"
                }
              />
              <AdministrationFact
                label="Last provider activity"
                value={formatProviderDateTime(
                  order.provider?.lastOperationTime
                )}
              />
              <AdministrationFact
                label={
                  order.link?.providerOrderCreatedAtEstimated
                    ? "Nexi order created (estimated)"
                    : "Nexi order created"
                }
                value={
                  order.link?.providerOrderCreatedAt
                    ? formatProviderDateTime(order.link.providerOrderCreatedAt)
                    : "Not recorded"
                }
              />
            </dl>
          </section>
          <section>
            <div className="mb-4">
              <h2 className="text-xl">Operations</h2>
              <p className="mt-1 text-sm text-navy-blue/65">
                Live, sanitized operation facts returned by Nexi.
              </p>
            </div>
            <OperationTable operations={operations} />
          </section>
        </div>
        <aside className="space-y-5 xl:sticky xl:top-24 xl:h-fit">
          <section className="rounded-xl border border-navy-blue/10 bg-white p-3">
            <h2 className="px-3 pb-2 pt-1 text-xs font-semibold uppercase tracking-[0.12em] text-navy-blue/65">
              Reservation
            </h2>
            {order.link ? (
              <Link
                className="block rounded-lg px-3 py-3 hover:bg-navy-blue/[0.035]"
                href={`/admin/reservations/${order.link.reservationId}`}
              >
                <span className="block font-semibold">View reservation</span>
                <span className="mt-1 block font-mono text-xs text-navy-blue/65">
                  {order.link.reservationId}
                </span>
              </Link>
            ) : (
              <p className="px-3 py-3 text-sm text-navy-blue/65">
                No local payment attempt is linked to this order.
              </p>
            )}
          </section>
          {order.link && (
            <section className="rounded-xl border border-navy-blue/10 bg-white p-5">
              <h2 className="text-sm font-semibold">Local attempt</h2>
              <div className="mt-3">
                <ProviderStatusBadge value={order.link.state} />
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
