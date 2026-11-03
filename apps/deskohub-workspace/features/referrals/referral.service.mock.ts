import { DotyposService } from "@deskohub/dotypos";
import { Effect, Layer } from "effect";
import {
  WorkspaceDatabase,
  type WorkspaceDatabaseClient,
} from "@/db/database.service";
import { WorkspaceDatabaseAdvisoryLock } from "@/db/postgres-advisory-lock";
import { CustomerAccountLinkRepository } from "@/features/account/backend/customer-account-link.repository";
import { CustomerAccountResolver } from "@/features/account/backend/customer-account-resolver.service";
import { type IReferralService, ReferralService } from "./referral.service";
import { ReferralReleaseGate } from "./referral-release-gate";

export const ReferralServiceMock = (
  overrides: Partial<IReferralService> = {}
) =>
  Layer.succeed(ReferralService, {
    getAccountSummary: () => Effect.die("getAccountSummary was not mocked"),
    acceptReferral: () => Effect.die("acceptReferral was not mocked"),
    lookupCodeKind: () => Effect.die("lookupCodeKind was not mocked"),
    findAvailableCode: () => Effect.die("findAvailableCode was not mocked"),
    evaluateCheckoutReferral: () =>
      Effect.die("evaluateCheckoutReferral was not mocked"),
    hasSettledReferral: () => Effect.die("hasSettledReferral was not mocked"),
    resolveInvitationCandidate: () => Effect.undefined,
    resolveReferrerCandidate: () => Effect.undefined,
    ...overrides,
  });

/**
 * The real ReferralService over empty data mocks: any read of recorded
 * referrals dies. It takes the referral decision from the caller's
 * `ReferralReleaseGate`.
 */
export const ReferralServiceWithoutData = ReferralService.Default.pipe(
  Layer.provide(
    Layer.mergeAll(
      Layer.mock(WorkspaceDatabase, {
        db: new Proxy({} as WorkspaceDatabaseClient, {
          get: () => {
            throw new Error("Referral data is unavailable in this test.");
          },
        }),
      }),
      Layer.mock(WorkspaceDatabaseAdvisoryLock, {}),
      Layer.mock(DotyposService, {}),
      Layer.mock(CustomerAccountResolver, {}),
      Layer.mock(CustomerAccountLinkRepository, {})
    )
  )
);

/** The real ReferralService while the `referrals` flag withholds the program. */
export const WithheldReferralService = ReferralServiceWithoutData.pipe(
  Layer.provide(ReferralReleaseGate.fromDecision(false))
);
