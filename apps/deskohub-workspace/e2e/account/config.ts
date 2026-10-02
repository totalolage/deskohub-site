import type { WorkspaceE2EConfig } from "../config";
import { parseWorkspaceE2EBaseUrl } from "../config";
import type { WorkspaceE2EEnvironment } from "../e2e-env";
import { workspaceE2EError } from "../errors";
import type { WorkspaceE2ERunId } from "../run-identifiers";
import { addRedaction } from "../runtime";
import { workspaceE2ETimeouts } from "../timeouts";

/** Resend synthetic test recipients ignore local parts; this host stays fixed. */
const resendSyntheticRecipientHost = "resend.dev";

/** The lane's primary synthetic identity, shared with the failure diagnostic. */
export const workspaceE2EAccountMainRecipientLabel = "main";

export type WorkspaceE2EAccountConfig = {
  readonly baseUrl: string;
  /** Vercel automation bypass for the protected preview; never a runtime bypass. */
  readonly bypassSecret: string | undefined;
  readonly expectedHost: string;
  readonly locale: "en-US";
  /** Validated run-context run id; every synthetic recipient derives from it. */
  readonly runId: WorkspaceE2ERunId;
  readonly timeouts: WorkspaceE2EConfig["timeouts"];
  /** GitHub-only Vercel token for Workspace history reads; never enters Vercel or app config. */
  readonly vercelToken: string;
  readonly vercelProjectId: string;
};

export const getAccountE2EConfig = (
  environment: WorkspaceE2EEnvironment,
  runId: WorkspaceE2ERunId
): WorkspaceE2EAccountConfig => {
  const vercelToken = environment.WORKSPACE_E2E_VERCEL_TOKEN;
  if (!vercelToken) {
    throw workspaceE2EError(
      "WORKSPACE_E2E_VERCEL_TOKEN is required for account e2e cases; provide the protected workspace-checkout-e2e GitHub environment token with verified Workspace team history access. Account coverage fails closed instead of skipping",
      { operation: "configure workspace account e2e" }
    );
  }
  const vercelProjectId = environment.WORKSPACE_E2E_VERCEL_PROJECT;
  if (!vercelProjectId) {
    throw workspaceE2EError(
      "WORKSPACE_E2E_VERCEL_PROJECT is required for account e2e cases; provision the Workspace Vercel project id as a runner-owned variable. Account coverage fails closed instead of skipping",
      { operation: "configure workspace account e2e" }
    );
  }

  addRedaction(vercelToken);
  const bypassSecret = environment.VERCEL_AUTOMATION_BYPASS_SECRET;
  addRedaction(bypassSecret);
  const { baseUrl, expectedHost } = parseWorkspaceE2EBaseUrl(
    environment.WORKSPACE_E2E_BASE_URL
  );

  return {
    baseUrl,
    bypassSecret,
    expectedHost,
    locale: "en-US",
    runId,
    timeouts: workspaceE2ETimeouts,
    vercelProjectId,
    vercelToken,
  };
};

/**
 * Derives the exact synthetic recipient for one account fixture from the
 * validated run-context run id. Because the derivation is deterministic, the
 * failure-only account-state diagnostic reconstructs the exact synthetic main
 * account without reading any broader rows. The recipient is registered with
 * the process redactor before it can reach any log line or artifact.
 */
export const makeWorkspaceE2EAccountRecipientForRunId = (
  runId: WorkspaceE2ERunId,
  label: string
) => {
  const localPart = `${runId}-${label}`;
  assertSyntheticRecipientLabel(localPart);
  const recipient = `delivered+${localPart}@${resendSyntheticRecipientHost}`;
  addRedaction(recipient);
  return recipient;
};

export const makeWorkspaceE2EAccountRecipient = (
  config: WorkspaceE2EAccountConfig,
  label: string
) => makeWorkspaceE2EAccountRecipientForRunId(config.runId, label);

const assertSyntheticRecipientLabel = (localPart: string) => {
  if (!/^[a-z0-9-]+$/.test(localPart)) {
    throw workspaceE2EError(
      "Workspace account e2e synthetic recipient labels must stay opaque",
      { operation: "derive workspace account e2e recipient" }
    );
  }
};
