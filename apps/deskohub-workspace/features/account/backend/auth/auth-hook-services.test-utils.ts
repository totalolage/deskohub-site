import { PostHogFeatureFlagEvaluationError } from "@deskohub/posthog/feature-flags/node";
import { Effect, Layer } from "effect";
import { WorkspaceDatabaseAdvisoryLock } from "@/db/postgres-advisory-lock";
import { AccountRoleGrants } from "@/features/administrators/backend/account-role-grants.service";
import { releaseGateOverFlags } from "@/features/feature-flags/backend/release-gate.test-utils";
import { releaseGateForRun } from "@/features/feature-flags/backend/release-gate-run";
import type { WorkspaceFeatureFlagService } from "@/features/feature-flags/backend/workspace-feature-flag.service";
import { WorkspaceFeatureFlagServiceMock } from "@/features/feature-flags/backend/workspace-feature-flag.service.mock";
import {
  AnalyticsConsentLedger,
  type IAnalyticsConsentLedger,
} from "@/features/legal/backend/analytics-consent-ledger";
import { ReviewAccounts } from "@/features/review-accounts";
import { BotProtectionService } from "@/shared/backend/bot-protection/bot-protection.service";
import type { WorkspacePostgresTestDatabase } from "@/shared/testing/workspace-postgres-test-database.test-utils";
import {
  accountReleaseRunPolicy,
  PasskeyReleaseGate,
  SignInCodeReleaseGate,
} from "../account-release-gates";
import { CustomerAccountDeletionService } from "../customer-account-deletion";
import type { WorkspaceAuthHookServices } from "./auth-server";
import { LoginLifecycleRecords } from "./login-lifecycle-records.service";

/**
 * The Workspace auth hooks' capabilities under test: over the migrated
 * disposable Postgres, or over nothing for an in-memory login store. Each
 * override replaces one capability operation on either.
 */

type FlagEvaluation = Effect.Effect<boolean, PostHogFeatureFlagEvaluationError>;

type Records = LoginLifecycleRecords["Service"];

export type AuthHookServiceOverrides = {
  /**
   * The `login_email_code` evaluation the real gate reads, once per hook
   * run; a failure is PostHog being unavailable. Off by default.
   */
  readonly signInCodeFlag?: FlagEvaluation;
  /** The `login_passkeys` evaluation, likewise. On by default. */
  readonly passkeyFlag?: FlagEvaluation;
  /**
   * The flag provider both gates build on, in place of one answering the
   * evaluations above, such as one that can't be built.
   */
  readonly flagProvider?: Layer.Layer<WorkspaceFeatureFlagService>;
  /** BotID verification; every request passes by default. */
  readonly verifyHuman?: BotProtectionService["Service"]["verifyHuman"];
  readonly isReviewAccount?: ReviewAccounts["Service"]["isReviewAccount"];
  readonly registerReviewAccount?: ReviewAccounts["Service"]["register"];
  readonly createCustomerAccount?: Records["createCustomerAccount"];
  readonly captureLocalePreference?: Records["captureLocalePreference"];
  /**
   * The ledger's mirror of a signing-in device's consent choice: the real
   * ledger over Postgres, and a no-op over an in-memory store.
   */
  readonly mirrorAnalyticsConsent?: IAnalyticsConsentLedger["mirror"];
};

/** A flag evaluation that fails as PostHog being unavailable. */
export const unavailableFlag: FlagEvaluation = Effect.fail(
  new PostHogFeatureFlagEvaluationError({
    cause: new Error("synthetic flag outage"),
    message: "Synthetic flag outage.",
  })
);

/**
 * A flag provider whose construction fails, as the production provider's
 * does when one of its module imports rejects.
 */
export const unbuildableFlagProvider: Layer.Layer<WorkspaceFeatureFlagService> =
  Layer.unwrap(
    Effect.promise(() =>
      Promise.reject(new Error("synthetic flag provider import failure"))
    )
  );

/**
 * Both account release gates, built on their first read over `overrides` as
 * the production hooks build them.
 */
const releaseGates = ({
  signInCodeFlag = Effect.succeed(false),
  passkeyFlag = Effect.succeed(true),
  flagProvider,
}: AuthHookServiceOverrides) => {
  const evaluations: Readonly<Record<string, FlagEvaluation>> = {
    login_email_code: signInCodeFlag,
    login_passkeys: passkeyFlag,
  };
  const featureFlags =
    flagProvider ??
    WorkspaceFeatureFlagServiceMock({
      isEnabled: (flag) =>
        evaluations[flag] ??
        Effect.die(new Error(`Unexpected auth flag read: ${flag}`)),
    });
  return Layer.mergeAll(
    releaseGateForRun(
      releaseGateOverFlags(SignInCodeReleaseGate, featureFlags),
      accountReleaseRunPolicy
    ),
    releaseGateForRun(
      releaseGateOverFlags(PasskeyReleaseGate, featureFlags),
      accountReleaseRunPolicy
    )
  );
};

const botProtection = ({ verifyHuman }: AuthHookServiceOverrides) =>
  Layer.succeed(BotProtectionService, {
    verifyHuman: verifyHuman ?? (() => Effect.void),
  });

/**
 * The real capabilities on the migrated disposable database: the account
 * records, role grants, review-account marker, and sign-in advisory lock.
 */
export const postgresAuthHookServices = (
  testDatabase: WorkspacePostgresTestDatabase,
  overrides: AuthHookServiceOverrides = {}
): Layer.Layer<WorkspaceAuthHookServices> => {
  const records = Layer.effect(
    LoginLifecycleRecords,
    Effect.map(
      LoginLifecycleRecords,
      (real): Records => ({
        ...real,
        ...(overrides.createCustomerAccount && {
          createCustomerAccount: overrides.createCustomerAccount,
        }),
        ...(overrides.captureLocalePreference && {
          captureLocalePreference: overrides.captureLocalePreference,
        }),
      })
    )
  ).pipe(Layer.provide(LoginLifecycleRecords.Default));
  const reviewAccounts = Layer.effect(
    ReviewAccounts,
    Effect.map(ReviewAccounts, (real) => ({
      isReviewAccount: overrides.isReviewAccount ?? real.isReviewAccount,
      register: overrides.registerReviewAccount ?? real.register,
    }))
  ).pipe(Layer.provide(ReviewAccounts.Default));
  const consentLedger = Layer.effect(
    AnalyticsConsentLedger,
    Effect.map(AnalyticsConsentLedger, (real) => ({
      ...real,
      mirror: overrides.mirrorAnalyticsConsent ?? real.mirror,
    }))
  ).pipe(Layer.provide(AnalyticsConsentLedger.Default));
  return Layer.mergeAll(
    Layer.mergeAll(
      records,
      reviewAccounts,
      consentLedger,
      AccountRoleGrants.Default
    ).pipe(Layer.provide(testDatabase.layer)),
    WorkspaceDatabaseAdvisoryLock.makeLayer(testDatabase.pool),
    botProtection(overrides),
    releaseGates(overrides)
  );
};

/**
 * Capabilities for an in-memory login store, which has no Workspace
 * database: no account records, role grants, review accounts, or consent
 * ledger, and a sign-in lock that only runs its effect, since one process
 * holds the store.
 */
export const memoryAuthHookServices = (
  overrides: AuthHookServiceOverrides = {}
): Layer.Layer<WorkspaceAuthHookServices> =>
  Layer.mergeAll(
    Layer.succeed(LoginLifecycleRecords, {
      createCustomerAccount:
        overrides.createCustomerAccount ?? (() => Effect.void),
      captureLocalePreference:
        overrides.captureLocalePreference ?? (() => Effect.void),
      revokeUnconsentedAdministrationTokens: () => Effect.void,
    }),
    Layer.mock(ReviewAccounts, {
      isReviewAccount:
        overrides.isReviewAccount ?? (() => Effect.succeed(false)),
      register: overrides.registerReviewAccount ?? (() => Effect.void),
    }),
    Layer.mock(AccountRoleGrants, { has: () => Effect.succeed(false) }),
    Layer.mock(AnalyticsConsentLedger, {
      mirror: overrides.mirrorAnalyticsConsent ?? (() => Effect.succeed(false)),
    }),
    Layer.mock(WorkspaceDatabaseAdvisoryLock, {
      withLock: (_key, effect) => effect,
    }),
    botProtection(overrides),
    releaseGates(overrides)
  );

/** The account deletion as `requestDeletion` answers it; a no-op by default. */
export const testAccountDeletion = (
  requestDeletion: CustomerAccountDeletionService["Service"]["requestDeletion"] = () =>
    Effect.void
) => Layer.succeed(CustomerAccountDeletionService, { requestDeletion });
