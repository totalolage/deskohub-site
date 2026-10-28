import {
  type AdministrationStandaloneAccessCodeCreationOutcomeType,
  AdministrationStandaloneAccessCodeResult,
  type AdministrationStandaloneAccessCodeResultType,
  type CliMutationInProgress,
  CliMutationRejected,
  type CliMutationUncertain,
  CliResourceNotFound,
  CliServiceUnavailable,
  CliStandaloneAccessCodeCleanupRequired,
  CliStandaloneAccessCodeReconciled,
} from "@deskohub/workspace-admin-api";
import { standaloneAccessCodeAttemptStaleAfterMilliseconds } from "@/features/access-codes";
import type { ReservationAccessAdministrationError } from "@/features/administration/reservation-access-administration.service";
import { reservationAccessProvisioningStaleAfterMilliseconds } from "@/features/reservation-access";
import {
  RecoveryPolicy,
  type StoredResult,
} from "./administration-request-ledger.service";

/**
 * Discount mutations. A missing target or a rejected change applied
 * nothing, so it frees the request ID for a corrected retry. Any other
 * failure may have reached Dotypos and keeps the claim, which never
 * resumes. The result must be recorded.
 */
export const discountMutationRecovery = RecoveryPolicy.noResume({
  releasesOn: (
    failure: CliResourceNotFound | CliMutationRejected | CliServiceUnavailable
  ) =>
    failure instanceof CliResourceNotFound ||
    failure instanceof CliMutationRejected,
  completion: "required",
});

/**
 * Reservation access mutations, which can issue an Igloohome PIN. A failed
 * attempt frees its request ID unless recovery itself failed, which needs
 * provider reconciliation first. A claim left for the provisioning stale
 * window resumes the reservation's interrupted mutation, and any failure
 * of that resume frees the request ID. The result must be recorded.
 */
export const reservationAccessRecovery = RecoveryPolicy.resumeAfter(
  reservationAccessProvisioningStaleAfterMilliseconds,
  {
    releasesOn: (failure: ReservationAccessAdministrationError) =>
      failure.reason !== "recovery_failed",
    resumeReleasesOn: () => true,
    completion: "required",
  }
);

/**
 * Standalone access-code creation, which issues an Igloohome PIN. A failure
 * that proves no code exists frees the request ID: a rejection, an
 * unavailable provider, a required cleanup or a recorded reconciliation.
 * An uncertain creation or one still in progress keeps it. Recording the
 * result is best-effort: the code exists and the administrator gets its PIN
 * once, so a recording failure is logged and frees the request ID for a
 * retry under the same attempt ID. A claim left for the attempt stale window
 * resumes by creating again under the same attempt ID.
 */
export const standaloneAccessCodeRecovery = RecoveryPolicy.resumeAfter(
  standaloneAccessCodeAttemptStaleAfterMilliseconds,
  {
    releasesOn: (
      failure:
        | CliMutationInProgress
        | CliMutationRejected
        | CliMutationUncertain
        | CliServiceUnavailable
        | CliStandaloneAccessCodeCleanupRequired
        | CliStandaloneAccessCodeReconciled
    ) =>
      failure instanceof CliMutationRejected ||
      failure instanceof CliServiceUnavailable ||
      failure instanceof CliStandaloneAccessCodeCleanupRequired ||
      failure instanceof CliStandaloneAccessCodeReconciled,
    completion: "best-effort",
  }
);

/**
 * A created standalone access code is stored without its PIN, and a retry
 * replays it as already created, so the PIN reaches the administrator once.
 */
export const standaloneAccessCodeStoredResult: StoredResult<
  AdministrationStandaloneAccessCodeCreationOutcomeType,
  AdministrationStandaloneAccessCodeResultType
> = {
  schema: AdministrationStandaloneAccessCodeResult,
  from: (outcome) => ({
    attemptId: outcome.attemptId,
    providerCredentialId: outcome.providerCredentialId,
    name: outcome.name,
    startsAt: outcome.startsAt,
    endsAt: outcome.endsAt,
    issuedAt: outcome.issuedAt,
  }),
  replay: (stored) => ({ outcome: "already-created", ...stored }),
};
