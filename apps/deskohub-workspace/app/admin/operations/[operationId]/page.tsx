import Link from "next/link";
import {
  AdministrationPage,
  AdministrationPageHeader,
} from "@/features/administration/components";
import { loadAdministrationOperation } from "@/features/administration/page-data.server";
import {
  formatProviderDateTime,
  formatProviderMoney,
  ProviderStatusBadge,
} from "@/features/administration/payment-components";
import { getProviderValueLabel } from "@/features/administration/payment-presentation";

export default async function OperationAdministrationDetailPage({
  params,
}: {
  readonly params: Promise<{ readonly operationId: string }>;
}) {
  const { operationId } = await params;
  const detail = await loadAdministrationOperation(operationId);
  const operation = detail.operation;
  return (
    <AdministrationPage>
      <AdministrationPageHeader
        actions={
          operation?.operationResult ? (
            <ProviderStatusBadge value={operation.operationResult} />
          ) : undefined
        }
        description="Sanitized live operation facts from Nexi and their linked Deskohub entities."
        eyebrow="Nexi operation"
        title={operationId}
      />
      {detail.providerStatus === "not_found" && (
        <p className="mb-5 rounded-xl border border-burned-orange/30 bg-burned-orange/10 px-4 py-3 text-sm">
          Nexi did not find this operation.
        </p>
      )}
      {detail.providerStatus === "unavailable" && (
        <p className="mb-5 rounded-xl border border-sunset-yellow/35 bg-sunset-yellow/10 px-4 py-3 text-sm">
          Nexi operation details are temporarily unavailable.
        </p>
      )}
      {operation && (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
          <section className="rounded-xl border border-navy-blue/10 bg-white p-5 sm:p-6">
            <h2 className="text-xl">Operation details</h2>
            <dl className="mt-5 grid gap-5 text-sm sm:grid-cols-2 lg:grid-cols-3">
              <OperationFact
                label="Type"
                value={
                  operation.operationType
                    ? getProviderValueLabel(operation.operationType)
                    : "Not reported"
                }
              />
              <OperationFact
                label="Result"
                value={
                  operation.operationResult
                    ? getProviderValueLabel(operation.operationResult)
                    : "Not reported"
                }
              />
              <OperationFact
                label="Origin"
                value={
                  operation.channel
                    ? getProviderValueLabel(operation.channel)
                    : "Not reported"
                }
              />
              <OperationFact
                label="Occurred"
                value={formatProviderDateTime(operation.operationTime)}
              />
              <OperationFact
                label="Amount"
                value={formatProviderMoney(
                  operation.amount,
                  operation.currency
                )}
              />
              <OperationFact
                label="Reverses operation"
                value={operation.cancelledOperationId ?? "Not applicable"}
              />
            </dl>
          </section>
          <aside className="space-y-5 xl:sticky xl:top-24 xl:h-fit">
            <RelatedEntity
              href={
                operation.orderId
                  ? `/admin/orders/${encodeURIComponent(operation.orderId)}`
                  : undefined
              }
              label={operation.orderId ?? "Not reported"}
              title="Order"
            />
            <RelatedEntity
              href={
                detail.linkedReservationId
                  ? `/admin/reservations/${detail.linkedReservationId}`
                  : undefined
              }
              label={detail.linkedReservationId ?? "Not linked"}
              title="Reservation"
            />
          </aside>
        </div>
      )}
    </AdministrationPage>
  );
}

function OperationFact({
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
      <dd className="mt-1.5 break-words font-medium">{value}</dd>
    </div>
  );
}

function RelatedEntity({
  href,
  label,
  title,
}: {
  readonly href?: string;
  readonly label: string;
  readonly title: string;
}) {
  const content = (
    <span className="block break-all font-mono text-xs text-navy-blue/65">
      {label}
    </span>
  );
  return (
    <section className="rounded-xl border border-navy-blue/10 bg-white p-3">
      <h2 className="px-3 pb-2 pt-1 text-xs font-semibold uppercase tracking-[0.12em] text-navy-blue/65">
        {title}
      </h2>
      {href ? (
        <Link
          className="block rounded-lg px-3 py-3 hover:bg-navy-blue/[0.035]"
          href={href}
        >
          {content}
        </Link>
      ) : (
        <div className="px-3 py-3">{content}</div>
      )}
    </section>
  );
}
