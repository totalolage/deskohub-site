import type { WorkspaceE2EConfig } from "../config";
import { parseWorkspaceE2EBaseUrl } from "../config";
import type { WorkspaceE2EEnvironment } from "../e2e-env";
import { workspaceE2EError } from "../errors";
import { addRedaction } from "../runtime";
import { workspaceE2ETimeouts } from "../timeouts";

/**
 * Fixed correlation tags shared with the deployed magic-link sender. The
 * retrieval path requires them on the retrieved synthetic message as one
 * additional equality check; they are non-secret and carry no per-run data.
 */
export const workspaceE2EAuthCorrelationTags = [
  { name: "category", value: "account-magic-link" },
  { name: "surface", value: "workspace" },
] as const;

/** Resend synthetic test recipients ignore local parts; this host stays fixed. */
const resendSyntheticRecipientHost = "resend.dev";

const runIdCharacters = "abcdefghijklmnopqrstuvwxyz0123456789";

export type WorkspaceE2EAccountConfig = {
  readonly baseUrl: string;
  /** Vercel automation bypass for the protected preview; never a runtime bypass. */
  readonly bypassSecret: string | undefined;
  readonly expectedHost: string;
  readonly locale: "en-US";
  readonly resendApiKey: string;
  readonly runId: string;
  readonly timeouts: WorkspaceE2EConfig["timeouts"];
};

/**
 * Builds the account E2E configuration. The GitHub-only Resend retrieval key
 * never enters Vercel or application configuration, so account cases fail
 * closed when it is absent: they block before executing and never skip.
 */
export const getAccountE2EConfig = (
  environment: WorkspaceE2EEnvironment
): WorkspaceE2EAccountConfig => {
  const resendApiKey = environment.WORKSPACE_E2E_RESEND_API_KEY;
  if (!resendApiKey) {
    throw workspaceE2EError(
      "WORKSPACE_E2E_RESEND_API_KEY is required for account e2e cases; account coverage fails closed instead of skipping",
      { operation: "configure workspace account e2e" }
    );
  }

  addRedaction(resendApiKey);
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
    resendApiKey,
    runId: makeWorkspaceE2EAccountRunId(),
    timeouts: workspaceE2ETimeouts,
  };
};

/**
 * Opaque per-run identifier used only to derive unique synthetic recipients
 * and to correlate fixed tags; it carries no secret and no personal data.
 */
export const makeWorkspaceE2EAccountRunId = (
  random: () => number = Math.random
) => {
  let value = "";
  for (let index = 0; index < 12; index += 1) {
    value += runIdCharacters[Math.floor(random() * runIdCharacters.length)];
  }
  return value;
};

/**
 * Derives the exact synthetic recipient for one account fixture. The
 * recipient is registered with the process redactor before it can reach any
 * log line or artifact.
 */
export const makeWorkspaceE2EAccountRecipient = (
  config: WorkspaceE2EAccountConfig,
  label: string
) => {
  const localPart = `${config.runId}-${label}`;
  assertSyntheticRecipientLabel(localPart);
  const recipient = `delivered+${localPart}@${resendSyntheticRecipientHost}`;
  addRedaction(recipient);
  return recipient;
};

const assertSyntheticRecipientLabel = (localPart: string) => {
  if (!/^[a-z0-9-]+$/.test(localPart)) {
    throw workspaceE2EError(
      "Workspace account e2e synthetic recipient labels must stay opaque",
      { operation: "derive workspace account e2e recipient" }
    );
  }
};
