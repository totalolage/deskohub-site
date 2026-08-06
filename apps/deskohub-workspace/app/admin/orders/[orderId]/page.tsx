import Link from "next/link";
import {
  AdministrationPage,
  AdministrationPageHeader,
} from "@/features/administration/components";
import { loadAdministrationOrder } from "@/features/administration/page-data.server";
import {
  formatOrderMoney,
  formatProviderDateTime,
  formatProviderMoney,
  OperationTable,
  ProviderStatusBadge,
} from "@/features/administration/payment-components";
import { getProviderValueLabel } from "@/features/administration/payment-presentation";

export const dynamic = "force-dynamic";

export default async function OrderAdministrationDetailPage({
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
    <AdministrationPage>
      <AdministrationPageHeader
        actions={
          <a
            className="inline-flex rounded-lg border border-navy-blue/15 px-3 py-2 text-sm font-semibold hover:bg-navy-blue/5"
            href={`https://xpaydashboard.nexigroup.com/nexi/ordermanagement/order/${encodeURIComponent(order.orderId)}`}
            rel="noreferrer"
            target="_blank"
          >
            Open in XPay ↗
          </a>
        }
        description="Provider facts, local reconciliation, and every operation returned for this order."
        eyebrow="Nexi order"
        title={order.orderId}
      />
      {order.providerStatus === "not_found" && (
        <p className="mb-5 rounded-xl border border-burned-orange/30 bg-burned-orange/10 px-4 py-3 text-sm">
          Nexi did not find this locally referenced order. Use the XPay link to
          confirm the merchant account and identifier.
        </p>
      )}
      {order.providerStatus === "unavailable" && (
        <p className="mb-5 rounded-xl border border-sunset-yellow/35 bg-sunset-yellow/10 px-4 py-3 text-sm">
          Nexi details are temporarily unavailable. Local relationship data is
          still shown below.
        </p>
      )}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-6">
          <section className="rounded-xl border border-navy-blue/10 bg-white p-5 sm:p-6">
            <h2 className="text-xl">Order details</h2>
            <dl className="mt-5 grid gap-5 text-sm sm:grid-cols-2 lg:grid-cols-3">
              <OrderFact label="Amount" value={formatOrderMoney(order)} />
              <OrderFact
                label="Authorized"
                value={formatProviderMoney(
                  order.provider?.authorizedAmount,
                  order.provider?.currency
                )}
              />
              <OrderFact
                label="Captured"
                value={formatProviderMoney(
                  order.provider?.capturedAmount,
                  order.provider?.currency
                )}
              />
              <OrderFact
                label="Last operation"
                value={
                  order.provider?.lastOperationType
                    ? getProviderValueLabel(order.provider.lastOperationType)
                    : "Not reported"
                }
              />
              <OrderFact
                label="Last provider activity"
                value={formatProviderDateTime(
                  order.provider?.lastOperationTime
                )}
              />
              <OrderFact
                label="Nexi order created"
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
    </AdministrationPage>
  );
}

function OrderFact({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-[0.1em] text-navy-blue/65">
        {label}
      </dt>
      <dd className="mt-1.5 font-medium">{value}</dd>
    </div>
  );
}
