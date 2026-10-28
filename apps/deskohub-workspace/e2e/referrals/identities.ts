import type {
  DotyposCustomerId,
  DotyposReservationId,
} from "@deskohub/dotypos";
import { Effect } from "effect";
import {
  makeWorkspaceE2ECaseIdentities,
  type WorkspaceE2ECaseAccount,
  type WorkspaceE2ECaseLinkedAccount,
} from "../account/case-identities";
import { createSyntheticReferralHistoryReservation } from "../account/fixtures";
import {
  seedWorkspaceE2EReferralOwner,
  type WorkspaceE2EReferralOwner,
} from "../account/referral-fixture";
import type { WorkspaceE2ESessionSigningSecret } from "../account/seeded-session";
import type { DatasourceConfig } from "../config";
import { type WorkspaceE2EError, workspaceE2EError } from "../errors";
import type { E2EDatabase } from "../integrations/database.service";
import type { WorkspaceE2EReferralCaseId } from "../playwright-checkout/case-catalog";
import type { WorkspaceE2ERunId } from "../run-identifiers";
import { addRedaction } from "../runtime";
import type { workspaceE2EReferralRecipientLabels } from "./journal-owners";

type ReferralRecipientLabel<Id extends WorkspaceE2EReferralCaseId> =
  (typeof workspaceE2EReferralRecipientLabels)[Id][number];

export type WorkspaceE2EReferralAccount = WorkspaceE2ECaseAccount;

export type WorkspaceE2EReferralLinkedAccount = WorkspaceE2ECaseLinkedAccount;

export type WorkspaceE2EReferrer = WorkspaceE2EReferralLinkedAccount &
  WorkspaceE2EReferralOwner;

/**
 * The synthetic identities of one referral-lane case: its case identities
 * journaled under the case id, plus referrers and past visits.
 */
export const makeWorkspaceE2EReferralIdentities = <
  Id extends WorkspaceE2EReferralCaseId,
>({
  baseUrl,
  caseId,
  datasourceConfig,
  runId,
  secret,
}: {
  readonly baseUrl: string;
  readonly caseId: Id;
  readonly datasourceConfig: DatasourceConfig;
  readonly runId: WorkspaceE2ERunId;
  readonly secret: WorkspaceE2ESessionSigningSecret;
}) => {
  const identities = makeWorkspaceE2ECaseIdentities<ReferralRecipientLabel<Id>>(
    {
      baseUrl,
      datasourceConfig,
      displayName: (label) => `Referral ${label}`,
      journalOwnerId: caseId,
      runId,
      secret,
    }
  );
  const { createCustomer, describe, record } = identities;

  return {
    ...identities,

    /** A finished confirmed Dotypos visit, journaled for cancellation. */
    createPastVisit: Effect.fn("ReferralIdentities.createPastVisit")(function* (
      customerId: DotyposCustomerId
    ) {
      const reservation = yield* createSyntheticReferralHistoryReservation(
        datasourceConfig,
        { customerId }
      );
      const reservationId = reservation.reservationId;
      if (!reservationId) {
        return yield* workspaceE2EError(
          "synthetic past visit has no provider id",
          {
            diagnosticCode: "dotypos_account_fixture_mutation_failed",
            operation: "create referral past visit",
          }
        );
      }
      yield* record({ dotyposReservationIds: [reservationId] });
      return {
        endedAt: new Date(Number(reservation.endsAt.epochMilliseconds)),
        reservationId: reservationId as DotyposReservationId,
      };
    }),

    /** A linked account that owns a usable referral code. */
    seedReferrer: (
      label: ReferralRecipientLabel<Id>
    ): Effect.Effect<WorkspaceE2EReferrer, WorkspaceE2EError, E2EDatabase> =>
      Effect.gen(function* () {
        const account = describe(label);
        yield* record({ authUserIds: [account.accountId] });
        const customerId = yield* createCustomer(label);
        const owner = yield* seedWorkspaceE2EReferralOwner({
          accountId: account.accountId,
          dotyposCustomerId: customerId,
          email: account.email,
          name: account.name,
        });
        addRedaction(owner.code, true);
        return { ...account, ...owner, customerId };
      }),
  };
};

export type WorkspaceE2EReferralIdentities = ReturnType<
  typeof makeWorkspaceE2EReferralIdentities
>;
