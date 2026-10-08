import { Effect, Layer } from "effect";
import { type IReferralService, ReferralService } from "./referral.service";

export const ReferralServiceMock = (
  overrides: Partial<IReferralService> = {}
) =>
  Layer.succeed(ReferralService, {
    getAccountSummary: () => Effect.die("getAccountSummary was not mocked"),
    acceptReferral: () => Effect.die("acceptReferral was not mocked"),
    lookupCodeKind: () => Effect.die("lookupCodeKind was not mocked"),
    resolveInvitationCandidate: () => Effect.succeed(undefined),
    resolveReferrerCandidate: () => Effect.succeed(undefined),
    ...overrides,
  });
