"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useRouteLocale } from "@/features/i18n/route-locale";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { isReservationAccessProvisioningStale } from "@/features/reservation-access/reservation-access";
import { Button } from "@/shared/components/ui/button";
import { StatusBadge } from "@/shared/components/ui/status-badge";
import { useWorkspaceAction } from "@/shared/utils/use-workspace-action";
import { mutateReservationAccess } from "./actions";
import type { AdministrationReservationAccessGrant } from "./administration.service";
import { AdministrationDetailSection, AdministrationFact } from "./components";
import { formatAdministrationDateTime } from "./formatters";
import { m } from "./i18n";

export function ReservationAccessAdministration({
  grant,
  reservationId,
}: {
  readonly grant: AdministrationReservationAccessGrant | null;
  readonly reservationId: WorkspaceReservationId;
}) {
  const locale = useRouteLocale();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const { execute, isExecuting } = useWorkspaceAction(mutateReservationAccess, {
    actionName: "mutateReservationAccess",
    onSuccess: () => router.refresh(),
    onError: ({ error: actionError }) =>
      setError(
        actionError.serverError ??
          m.administrationReservationAccessRecoveryFailed({}, { locale })
      ),
    onTransportError: () =>
      setError(m.administrationReservationAccessRecoveryFailed({}, { locale })),
  });

  if (!grant) {
    return (
      <AdministrationDetailSection
        title={m.administrationReservationAccessTitle({}, { locale })}
      >
        <p className="text-sm text-navy-blue/60">
          {m.administrationReservationAccessNone({}, { locale })}
        </p>
      </AdministrationDetailSection>
    );
  }

  const needsProviderReconciliation =
    grant.state === "uncertain" ||
    isReservationAccessProvisioningStale({
      state: grant.state,
      provisioningStartedAt: grant.provisioningStartedAt
        ? Temporal.Instant.from(grant.provisioningStartedAt)
        : null,
    });
  // A stale provisioning attempt needs the same reconciliation as an
  // uncertain one.
  const status = (
    {
      pending: {
        label: m.administrationReservationAccessStatePending,
        tone: "neutral",
      },
      provisioning: {
        label: m.administrationReservationAccessStateProvisioning,
        tone: "neutral",
      },
      issued: {
        label: m.administrationReservationAccessStateIssued,
        tone: "positive",
      },
      expired: {
        label: m.administrationReservationAccessStateExpired,
        tone: "neutral",
      },
      uncertain: {
        label: m.administrationReservationAccessStateNeedsReconciliation,
        tone: "attention",
      },
      failed: {
        label: m.administrationReservationAccessStateFailed,
        tone: "attention",
      },
    } as const
  )[needsProviderReconciliation ? "uncertain" : grant.state];

  return (
    <AdministrationDetailSection
      title={m.administrationReservationAccessTitle({}, { locale })}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <StatusBadge tone={status.tone}>
          {status.label({}, { locale })}
        </StatusBadge>
        {grant.state === "failed" && (
          <Button
            disabled={isExecuting}
            onClick={() => {
              setError(null);
              execute({ kind: "retry-failed", reservationId });
            }}
            size="sm"
            type="button"
          >
            {isExecuting
              ? m.administrationReservationAccessRetrying({}, { locale })
              : m.administrationReservationAccessRetry({}, { locale })}
          </Button>
        )}
      </div>

      {error && (
        <p
          className="mt-3 text-sm font-semibold text-burned-orange-ink"
          role="alert"
        >
          {error}
        </p>
      )}

      {needsProviderReconciliation && (
        <details className="mt-4 rounded-xl border border-burned-orange/25 bg-burned-orange/5 p-4">
          <Button asChild size="sm">
            <summary>
              {m.administrationReservationAccessReconcile({}, { locale })}
            </summary>
          </Button>
          <div className="mt-4 space-y-4 text-sm leading-6 text-navy-blue/65">
            <p>
              {m.administrationReservationAccessReconcileInstructions(
                { accessName: grant.accessName },
                { locale }
              )}
            </p>
            <Button
              disabled={isExecuting}
              onClick={() => {
                setError(null);
                execute({
                  kind: "confirm-provider-credential-removed",
                  providerCredentialRemoved: true,
                  reservationId,
                });
              }}
              type="button"
            >
              {isExecuting
                ? m.administrationReservationAccessRetrying({}, { locale })
                : m.administrationReservationAccessConfirmRemoved(
                    {},
                    { locale }
                  )}
            </Button>
          </div>
        </details>
      )}

      <dl className="mt-5 grid gap-5 text-sm sm:grid-cols-2 lg:grid-cols-3">
        <AdministrationFact
          label={m.administrationReservationAccessName({}, { locale })}
          value={grant.accessName}
        />
        <AdministrationFact
          label={m.administrationReservationAccessTargetDevice({}, { locale })}
          value={grant.deviceId}
        />
        <AdministrationFact
          label={m.administrationReservationAccessValidFrom({}, { locale })}
          value={formatAdministrationDateTime(grant.startsAt, locale)}
        />
        <AdministrationFact
          label={m.administrationReservationAccessValidUntil({}, { locale })}
          value={formatAdministrationDateTime(grant.endsAt, locale)}
        />
        <AdministrationFact
          label={m.administrationReservationAccessProviderCredential(
            {},
            { locale }
          )}
          value={
            grant.providerCredentialId ??
            m.administrationReservationUnavailable({}, { locale })
          }
          valueClassName="break-all font-mono text-xs"
        />
        <AdministrationFact
          label={m.administrationReservationAccessFailure({}, { locale })}
          value={
            grant.failureCode ??
            m.administrationReservationAccessNoFailure({}, { locale })
          }
        />
      </dl>
    </AdministrationDetailSection>
  );
}
