import Link from "next/link";
import { Suspense } from "react";
import {
  AdministrationAlert,
  AdministrationDetailSection,
  AdministrationFact,
  AdministrationPage,
  AdministrationPageHeader,
} from "@/features/administration/components";
import { AdministrationDetailLoading } from "@/features/administration/loading";
import { loadAdministrationOperation } from "@/features/administration/page-data.server";
import {
  formatProviderDateTime,
  formatProviderMoney,
  ProviderStatusBadge,
} from "@/features/administration/payment-components";
import { getProviderValueLabel } from "@/features/administration/payment-presentation";

export default function OperationAdministrationDetailPage({
  params,
}: {
  readonly params: Promise<{ readonly operationId: string }>;
}) {
  return (
    <AdministrationPage>
      <Suspense
        fallback={<AdministrationDetailLoading label="operation details" />}
      >
        <OperationAdministrationDetail params={params} />
      </Suspense>
    </AdministrationPage>
  );
}

export async function OperationAdministrationDetail({
  params,
}: {
  readonly params: Promise<{ readonly operationId: string }>;
}) {
  const { operationId } = await params;
  const detail = await loadAdministrationOperation(operationId);
  const operation = detail.operation;
  return (
    <>
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
        <AdministrationAlert className="mb-5" status="error">
          Nexi did not find this operation.
        </AdministrationAlert>
      )}
      {detail.providerStatus === "unavailable" && (
        <AdministrationAlert className="mb-5" status="warning">
          Nexi operation details are temporarily unavailable.
        </AdministrationAlert>
      )}
      {operation && (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
          <section className="rounded-xl border border-navy-blue/10 bg-white p-5 sm:p-6">
            <h2 className="text-xl">Operation details</h2>
            <dl className="mt-5 grid gap-5 text-sm sm:grid-cols-2 lg:grid-cols-3">
              <AdministrationFact
                label="Type"
                value={
                  operation.operationType
                    ? getProviderValueLabel(operation.operationType)
                    : "Not reported"
                }
              />
              <AdministrationFact
                label="Result"
                value={
                  operation.operationResult
                    ? getProviderValueLabel(operation.operationResult)
                    : "Not reported"
                }
              />
              <AdministrationFact
                label="Origin"
                value={
                  operation.channel
                    ? getProviderValueLabel(operation.channel)
                    : "Not reported"
                }
              />
              <AdministrationFact
                label="Occurred"
                value={formatProviderDateTime(operation.operationTime)}
              />
              <AdministrationFact
                label="Amount"
                value={formatProviderMoney(
                  operation.amount,
                  operation.currency
                )}
              />
              <AdministrationFact
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
    </>
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
    <AdministrationDetailSection density="compact" title={title}>
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
    </AdministrationDetailSection>
  );
}
