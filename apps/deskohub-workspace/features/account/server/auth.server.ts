import "server-only";

import { Effect } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { WorkspaceDatabaseAdvisoryLock } from "@/db/postgres-advisory-lock";
import { WorkspaceLockSections } from "@/db/workspace-locks";
import { env } from "@/env";
import { revokeUnconsentedAdministrationTokens } from "@/features/account/backend/auth/administration-agent-access";
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
  workspaceBeforeDeleteUser,
  workspaceSendMagicLink,
} from "@/features/account/backend/auth/auth-server";
import { ensureCustomerAccount } from "@/features/account/backend/customer-account.repository";
import { captureAccountLocalePreference } from "@/features/account/backend/customer-locale-preference";
import { customerMcpServerPath } from "@/features/account/customer-agent-routes";
import { AccountRoleGrants } from "@/features/administrators/backend/account-role-grants.service";
import { ReviewAccounts } from "@/features/review-accounts";
import { BotProtectionService } from "@/shared/backend/bot-protection/bot-protection.service";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";
import {
  arePasskeysEnabled,
  isSignInCodeEnabled,
} from "./account-feature-flag.server";

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

const passkeyRelyingParty = resolvePasskeyRelyingParty(hostEnvironment);
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
  passkeyRelyingParty: passkeyRelyingParty.relyingParty,
  customerMcpResource,
  httpsOnly: env.VERCEL_ENV !== "development",
  isSignInCodeEnabled,
  arePasskeysEnabled,
  verifyHuman: (input) =>
    Effect.flatMap(BotProtectionService, (botProtection) =>
      botProtection.verifyHuman(input)
    ).pipe(Effect.provide(BotProtectionService.Default)),
  withSignInEmailLock: (address, effect) =>
    WorkspaceLockSections.signInEmail(address)(effect).pipe(
      Effect.provide(WorkspaceDatabaseAdvisoryLock.Default)
    ),
  sendMagicLink: workspaceSendMagicLink,
  beforeDeleteUser: workspaceBeforeDeleteUser,
  createCustomerAccount: (accountId) =>
    ensureCustomerAccount(accountId).pipe(
      Effect.provide(WorkspaceDatabase.Default)
    ),
  hasAdministratorGrant: (accountId) =>
    Effect.flatMap(AccountRoleGrants, (grants) =>
      grants.has({ accountId, role: "administrator" })
    ).pipe(Effect.provide(AccountRoleGrants.Live)),
  revokeUnconsentedAdministrationTokens: (owner) =>
    revokeUnconsentedAdministrationTokens(owner).pipe(
      Effect.provide(WorkspaceDatabase.Default)
    ),
  captureAccountLocalePreference: (accountId, locale) =>
    captureAccountLocalePreference(accountId, locale).pipe(
      Effect.provide(WorkspaceDatabase.Default)
    ),
  reviewAccountCredentials: env.REVIEW_ACCOUNT_CREDENTIALS ?? [],
  isReviewAccount: (accountId) =>
    Effect.flatMap(ReviewAccounts, (reviewAccounts) =>
      reviewAccounts.isReviewAccount(accountId)
    ).pipe(Effect.provide(ReviewAccounts.Live)),
  registerReviewAccount: (accountId) =>
    Effect.flatMap(ReviewAccounts, (reviewAccounts) =>
      reviewAccounts.register(accountId)
    ).pipe(Effect.provide(ReviewAccounts.Live)),
});
