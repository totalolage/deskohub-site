import "server-only";

import { Layer } from "effect";
import { WorkspaceDatabaseAdvisoryLock } from "@/db/postgres-advisory-lock";
import { env } from "@/env";
import {
  PasskeyReleaseGateForRun,
  SignInCodeReleaseGateForRun,
} from "@/features/account/backend/account-release-gates-run";
import {
  type BetterAuthHostEnvironment,
  resolveBetterAuthAllowedHosts,
  resolveCustomerMcpResource,
  resolvePasskeyRelyingParty,
} from "@/features/account/backend/auth/auth-hosts";
import { parseBetterAuthSecrets } from "@/features/account/backend/auth/auth-secrets";
import {
  makeWorkspaceAuth,
  makeWorkspaceAuthDatabase,
  workspaceSendMagicLink,
} from "@/features/account/backend/auth/auth-server";
import { LoginLifecycleRecords } from "@/features/account/backend/auth/login-lifecycle-records.service";
import { CustomerAccountDeletionService } from "@/features/account/backend/customer-account-deletion";
import { customerMcpServerPath } from "@/features/account/customer-agent-routes";
import { AccountRoleGrants } from "@/features/administrators/backend/account-role-grants.service";
import { AnalyticsConsentLedger } from "@/features/legal/backend/analytics-consent-ledger";
import { ReviewAccounts } from "@/features/review-accounts";
import { BotProtectionService } from "@/shared/backend/bot-protection/bot-protection.service";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";

const secrets = parseBetterAuthSecrets(env.BETTER_AUTH_SECRETS);
if (secrets.kind === "invalid") {
  throw new Error(`Workspace account bootstrap failed: ${secrets.message}`);
}

const hostEnvironment: BetterAuthHostEnvironment = {
  vercelEnv: env.VERCEL_ENV,
  customerFacingHost: workspaceSiteConstants.brand.domain,
  projectProductionUrl: env.VERCEL_PROJECT_PRODUCTION_URL,
  deploymentUrl: env.VERCEL_URL,
  branchUrl: env.VERCEL_BRANCH_URL,
};

const allowedHosts = resolveBetterAuthAllowedHosts(hostEnvironment);
if (allowedHosts.kind === "invalid") {
  throw new Error(
    `Workspace account bootstrap failed: ${allowedHosts.message}`
  );
}

const passkeyRelyingParty = resolvePasskeyRelyingParty(hostEnvironment, {
  androidDebugCertificate: env.ANDROID_DEBUG_SIGNING_CERT_SHA256,
});
if (passkeyRelyingParty.kind === "invalid") {
  throw new Error(
    `Workspace account bootstrap failed: ${passkeyRelyingParty.message}`
  );
}

const mcpResource = resolveCustomerMcpResource(
  hostEnvironment,
  customerMcpServerPath
);
if (mcpResource.kind === "invalid") {
  throw new Error(`Workspace account bootstrap failed: ${mcpResource.message}`);
}

/** The canonical URL of this deployment's customer MCP server. */
export const customerMcpResource = mcpResource.resource;

/**
 * The fail-closed server-only Better Auth singleton. Loading this module
 * without valid authentication configuration throws, so a deployment cannot
 * serve account requests without it.
 */
export const auth = makeWorkspaceAuth({
  database: makeWorkspaceAuthDatabase(),
  secrets: secrets.secrets,
  allowedHosts: allowedHosts.hosts,
  nativeAppLinkOrigin: `https://${workspaceSiteConstants.brand.domain}`,
  passkeyRelyingParty: passkeyRelyingParty.relyingParty,
  customerMcpResource,
  httpsOnly: env.VERCEL_ENV !== "development",
  reviewAccountCredentials: env.REVIEW_ACCOUNT_CREDENTIALS ?? [],
  sendMagicLink: workspaceSendMagicLink,
  // Each hook run builds these once, against the run's request. A release
  // gate builds its flag provider only when the run reads it and decides its
  // flag at most once per run, so a provider that can't be built closes only
  // that gate and fails no hook that doesn't read it.
  services: Layer.mergeAll(
    AccountRoleGrants.Live,
    AnalyticsConsentLedger.Live,
    BotProtectionService.Default,
    LoginLifecycleRecords.Live,
    PasskeyReleaseGateForRun,
    ReviewAccounts.Live,
    SignInCodeReleaseGateForRun,
    WorkspaceDatabaseAdvisoryLock.Default
  ),
  // A deletion service that cannot be built is a configuration defect, not a
  // deletion failure; either way the hook rejects and Better Auth keeps the
  // account.
  accountDeletion: CustomerAccountDeletionService.Live.pipe(Layer.orDie),
});
