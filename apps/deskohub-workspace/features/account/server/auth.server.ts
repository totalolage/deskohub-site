import "server-only";

import { Effect } from "effect";
import { WorkspaceDatabase } from "@/db/database.service";
import { env } from "@/env";
import { resolveBetterAuthAllowedHosts } from "@/features/account/backend/auth/auth-hosts";
import { parseBetterAuthSecrets } from "@/features/account/backend/auth/auth-secrets";
import {
  makeWorkspaceAuth,
  makeWorkspaceAuthDatabase,
  workspaceBeforeDeleteUser,
  workspaceSendMagicLink,
} from "@/features/account/backend/auth/auth-server";
import { seedAccountCommunicationPreference } from "@/features/account/backend/customer-communication-preference.repository";
import { runWorkspaceEffect } from "@/shared/backend/workspace-effect";
import { workspaceSiteConstants } from "@/shared/utils/site-constants";
import { areAccountsEnabled } from "./account-feature-flag.server";

const secrets = parseBetterAuthSecrets(env.BETTER_AUTH_SECRETS);
if (secrets.kind === "invalid") {
  throw new Error(`Workspace account bootstrap failed: ${secrets.message}`);
}

const allowedHosts = resolveBetterAuthAllowedHosts({
  vercelEnv: env.VERCEL_ENV,
  customerFacingHost: workspaceSiteConstants.brand.domain,
  projectProductionUrl: env.VERCEL_PROJECT_PRODUCTION_URL,
  deploymentUrl: env.VERCEL_URL,
  branchUrl: env.VERCEL_BRANCH_URL,
});
if (allowedHosts.kind === "invalid") {
  throw new Error(
    `Workspace account bootstrap failed: ${allowedHosts.message}`
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
  httpsOnly: env.VERCEL_ENV !== "development",
  areAccountsEnabled,
  sendMagicLink: workspaceSendMagicLink,
  beforeDeleteUser: workspaceBeforeDeleteUser,
  createAccountCommunicationPreference: (accountId, locale) =>
    runWorkspaceEffect("account.communication-preference.seed", {
      boundary: "route",
    })(
      seedAccountCommunicationPreference(accountId, locale).pipe(
        Effect.provide(WorkspaceDatabase.Default)
      )
    ),
});
