import { Suspense } from "react";
import { AdministrationRecordLink } from "@/features/administration/admin-link";
import {
  type AdministrationHref,
  administrationHref,
} from "@/features/administration/administration-href";
import {
  AdministrationAlert,
  AdministrationDetailSection,
  AdministrationFact,
  AdministrationPage,
  AdministrationPageHeader,
} from "@/features/administration/components";
import { m } from "@/features/administration/i18n";
import { AdministrationDetailLoading } from "@/features/administration/loading";
import { loadAdministrationOperation } from "@/features/administration/page-data.server";
import {
  formatProviderDateTime,
  formatProviderMoney,
  ProviderStatusBadge,
} from "@/features/administration/payment-components";
import { getProviderValueLabel } from "@/features/administration/payment-presentation";
import type { Locale } from "@/features/i18n";
import { getRequestLocale } from "@/features/i18n/server/request-locale";

export default function OperationAdministrationDetailPage({
  params,
}: {
  readonly params: Promise<{ readonly operationId: string }>;
}) {
  return <OperationAdministrationDetailScreen params={params} />;
}

async function OperationAdministrationDetailScreen({
  params,
}: {
  readonly params: Promise<{ readonly operationId: string }>;
}) {
  const locale = await getRequestLocale();
  return (
    <AdministrationPage>
      <Suspense
        fallback={
          <AdministrationDetailLoading
            label={m.administrationOperationDetailLoading({}, { locale })}
          />
        }
      >
        <OperationAdministrationDetail locale={locale} params={params} />
      </Suspense>
    </AdministrationPage>
  );
}

type OperationDetail = Awaited<ReturnType<typeof loadAdministrationOperation>>;
type ProviderOperation = NonNullable<OperationDetail["operation"]>;

export async function OperationAdministrationDetail({
  locale,
  params,
}: {
  readonly locale: Locale;
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
            <ProviderStatusBadge
              locale={locale}
              value={operation.operationResult}
            />
          ) : undefined
        }
        description={m.administrationOperationDetailDescription({}, { locale })}
        eyebrow={m.administrationOperationDetailEyebrow({}, { locale })}
        title={operationId}
      />
      <OperationProviderStatusAlert
        locale={locale}
        providerStatus={detail.providerStatus}
      />
      {operation && (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
          <OperationFacts locale={locale} operation={operation} />
          <OperationRelatedRecords
            linkedReservationId={detail.linkedReservationId}
            locale={locale}
            operation={operation}
          />
        </div>
      )}
    </>
  );
}

function OperationProviderStatusAlert({
  locale,
  providerStatus,
}: {
  readonly locale: Locale;
  readonly providerStatus: OperationDetail["providerStatus"];
}) {
  if (providerStatus === "not_found") {
    return (
      <AdministrationAlert className="mb-5" status="error">
        {m.administrationOperationDetailNotFound({}, { locale })}
      </AdministrationAlert>
    );
  }
  if (providerStatus === "unavailable") {
    return (
      <AdministrationAlert className="mb-5" status="warning">
        {m.administrationOperationDetailUnavailable({}, { locale })}
      </AdministrationAlert>
    );
  }
  return null;
}

function OperationFacts({
  locale,
  operation,
}: {
  readonly locale: Locale;
  readonly operation: ProviderOperation;
}) {
  return (
    <section className="rounded-xl border border-navy-blue/10 bg-white p-5 sm:p-6">
      <h2 className="text-xl">
        {m.administrationOperationDetailTitle({}, { locale })}
      </h2>
      <dl className="mt-5 grid gap-5 text-sm sm:grid-cols-2 lg:grid-cols-3">
        <AdministrationFact
          label={m.administrationOperationFactType({}, { locale })}
          value={
            operation.operationType
              ? getProviderValueLabel(operation.operationType, locale)
              : m.administrationOperationNotReported({}, { locale })
          }
        />
        <AdministrationFact
          label={m.administrationOperationFactResult({}, { locale })}
          value={
            operation.operationResult
              ? getProviderValueLabel(operation.operationResult, locale)
              : m.administrationOperationNotReported({}, { locale })
          }
        />
        <AdministrationFact
          label={m.administrationOperationFactOrigin({}, { locale })}
          value={
            operation.channel
              ? getProviderValueLabel(operation.channel, locale)
              : m.administrationOperationNotReported({}, { locale })
          }
        />
        <AdministrationFact
          label={m.administrationOperationFactOccurred({}, { locale })}
          value={formatProviderDateTime(operation.operationTime, locale)}
        />
        <AdministrationFact
          label={m.administrationOperationFactAmount({}, { locale })}
          value={formatProviderMoney(
            operation.amount,
            operation.currency,
            locale
          )}
        />
        <AdministrationFact
          label={m.administrationOperationFactReverses({}, { locale })}
          value={
            operation.cancelledOperationId ??
            m.administrationOperationNotApplicable({}, { locale })
          }
        />
      </dl>
    </section>
  );
}

function OperationRelatedRecords({
  linkedReservationId,
  locale,
  operation,
}: {
  readonly linkedReservationId: OperationDetail["linkedReservationId"];
  readonly locale: Locale;
  readonly operation: ProviderOperation;
}) {
  return (
    <aside className="space-y-5 xl:sticky xl:top-24 xl:h-fit">
      <RelatedEntity
        href={
          operation.orderId
            ? administrationHref("/[locale]/admin/orders/[orderId]", {
                orderId: operation.orderId,
              })
            : undefined
        }
        label={
          operation.orderId ??
          m.administrationOperationNotReported({}, { locale })
        }
        title={m.administrationOperationRelatedOrder({}, { locale })}
      />
      <RelatedEntity
        href={
          linkedReservationId
            ? administrationHref(
                "/[locale]/admin/reservations/[reservationId]",
                { reservationId: linkedReservationId }
              )
            : undefined
        }
        label={
          linkedReservationId ??
          m.administrationOperationReservationNotLinked({}, { locale })
        }
        title={m.administrationOperationRelatedReservation({}, { locale })}
      />
    </aside>
  );
}

function RelatedEntity({
  href,
  label,
  title,
}: {
  readonly href?: AdministrationHref;
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
        <AdministrationRecordLink href={href}>
          {content}
        </AdministrationRecordLink>
      ) : (
        <div className="px-3 py-3">{content}</div>
      )}
    </AdministrationDetailSection>
  );
}
