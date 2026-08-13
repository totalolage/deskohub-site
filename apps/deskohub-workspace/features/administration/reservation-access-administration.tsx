"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { WorkspaceReservationId } from "@/features/reservation/persistence-contracts";
import { isReservationAccessProvisioningStale } from "@/features/reservation-access/reservation-access";
import { Button, buttonVariants } from "@/shared/components/ui/button";
import { useWorkspaceAction } from "@/shared/utils/use-workspace-action";
import { mutateReservationAccess } from "./actions";
import type { AdministrationReservationAccessGrant } from "./administration.service";
import {
  AdministrationDetailSection,
  AdministrationFact,
  AdministrationStatusBadge,
} from "./components";
import { formatAdministrationDateTime } from "./formatters";

export function ReservationAccessAdministration({
  grant,
  reservationId,
}: {
  readonly grant: AdministrationReservationAccessGrant | null;
  readonly reservationId: WorkspaceReservationId;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const { execute, isExecuting } = useWorkspaceAction(mutateReservationAccess, {
    actionName: "mutateReservationAccess",
    onSuccess: () => router.refresh(),
    onError: ({ error: actionError }) =>
      setError(
        actionError.serverError ??
          "Reservation access recovery could not be completed."
      ),
    onTransportError: () =>
      setError("Reservation access recovery could not be completed."),
  });

  if (!grant) {
    return (
      <AdministrationDetailSection title="Door access">
        <p className="text-sm text-navy-blue/60">
          No access credential has been provisioned.
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
  const status = needsProviderReconciliation
    ? { label: "Needs reconciliation", tone: "attention" as const }
    : ({
        pending: { label: "Pending", tone: "neutral" },
        provisioning: { label: "Provisioning", tone: "neutral" },
        issued: { label: "Issued", tone: "positive" },
        expired: { label: "Expired", tone: "neutral" },
        uncertain: { label: "Needs reconciliation", tone: "attention" },
        failed: { label: "Failed", tone: "attention" },
      }[grant.state] as {
        readonly label: string;
        readonly tone: "attention" | "neutral" | "positive";
      });

  return (
    <AdministrationDetailSection title="Door access">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <AdministrationStatusBadge tone={status.tone}>
          {status.label}
        </AdministrationStatusBadge>
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
            {isExecuting ? "Retrying…" : "Retry access"}
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
          <summary className={buttonVariants({ size: "sm" })}>
            Reconcile access
          </summary>
          <div className="mt-4 space-y-4 text-sm leading-6 text-navy-blue/65">
            <p>
              At the lock, connect the Igloohome app over Bluetooth and find “
              {grant.accessName}”. Remove it, or verify that it does not exist.
              Do not continue if that cannot be confirmed; the possible
              credential must expire instead.
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
              {isExecuting ? "Retrying…" : "Confirm removed and retry"}
            </Button>
          </div>
        </details>
      )}

      <dl className="mt-5 grid gap-5 text-sm sm:grid-cols-2 lg:grid-cols-3">
        <AdministrationFact label="Access name" value={grant.accessName} />
        <AdministrationFact label="Target device" value={grant.deviceId} />
        <AdministrationFact
          label="Valid from"
          value={formatAdministrationDateTime(grant.startsAt)}
        />
        <AdministrationFact
          label="Valid until"
          value={formatAdministrationDateTime(grant.endsAt)}
        />
        <AdministrationFact
          label="Provider credential"
          value={grant.providerCredentialId ?? "Unavailable"}
          valueClassName="break-all font-mono text-xs"
        />
        <AdministrationFact
          label="Failure"
          value={grant.failureCode ?? "None"}
        />
      </dl>
    </AdministrationDetailSection>
  );
}
