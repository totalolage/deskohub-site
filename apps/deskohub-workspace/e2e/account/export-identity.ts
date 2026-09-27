/**
 * The closed verdict space for the account data export identity comparison.
 * The delivered document's `identity.accountId` is compared as a boolean
 * against the journaled Better Auth user id before the email string itself,
 * so one failed preview run decides between two root-cause classes: the
 * session belonged to a different identity (`account-mismatch`), or the
 * session identity was correct but its delivered email string diverged from
 * the synthetic recipient (`email-mismatch`).
 */
export type WorkspaceE2EExportIdentityVerdict =
  | "account-mismatch"
  | "email-mismatch"
  | "match";

export const classifyWorkspaceE2EExportIdentityMatch = (input: {
  readonly accountIdMatches: boolean;
  readonly emailMatches: boolean;
}): WorkspaceE2EExportIdentityVerdict => {
  if (!input.accountIdMatches) return "account-mismatch";
  return input.emailMatches ? "match" : "email-mismatch";
};

/**
 * The fixed failure message for one non-match verdict. The messages name
 * only the closed verdict class: they never carry the recipient address,
 * the delivered email, or any account identifier.
 */
export const exportIdentityVerdictFailureMessage = (
  verdict: WorkspaceE2EExportIdentityVerdict
): string => {
  switch (verdict) {
    case "account-mismatch":
      return "the export document identity was not the journaled synthetic account: the export session resolved to a different Better Auth identity";
    case "email-mismatch":
      return "the export identity email diverged from the synthetic recipient while the journaled account id matched: email-string divergence, not a session divergence";
    case "match":
      return "the export identity matched the synthetic expectations";
  }
};
