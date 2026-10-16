import "server-only";

import { Effect } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { WorkspaceDatabaseAdvisoryLock } from "@/db/postgres-advisory-lock";
import { env } from "@/env";
import {
  type BetterAuthHostEnvironment,
  resolveBetterAuthAllowedHosts,
  resolvePasskeyRelyingParty,
} from "@/features/account/backend/auth/auth-hosts";
import { parseBetterAuthSecrets } from "@/features/account/backend/auth/auth-secrets";
import {
  makeWorkspaceAuth,
  makeWorkspaceAuthDatabase,
  workspaceBeforeDeleteUser,
  workspaceSendMagicLink,
} from "@/features/account/backend/auth/auth-server";
import { captureAccountLocalePreference } from "@/features/account/backend/customer-locale-preference";
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
  httpsOnly: env.VERCEL_ENV !== "development",
  isSignInCodeEnabled,
  arePasskeysEnabled,
  verifyHuman: (input) =>
    Effect.flatMap(BotProtectionService, (botProtection) =>
      botProtection.verifyHuman(input)
    ).pipe(Effect.provide(BotProtectionService.Default)),
  withSignInEmailLock: (key, effect) =>
    Effect.flatMap(WorkspaceDatabaseAdvisoryLock, (advisoryLock) =>
      advisoryLock.withLock(key, effect)
    ).pipe(Effect.provide(WorkspaceDatabaseAdvisoryLock.Default)),
  sendMagicLink: workspaceSendMagicLink,
  beforeDeleteUser: workspaceBeforeDeleteUser,
  captureAccountLocalePreference: (accountId, locale) =>
    captureAccountLocalePreference(accountId, locale).pipe(
      Effect.provide(WorkspaceDatabase.Default)
    ),
});
