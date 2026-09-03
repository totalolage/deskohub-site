export const workspaceE2EAccountCaseIds = [
  "account-anonymous-redirect",
  "account-sign-in-form",
  "account-magic-link-delivery",
  "account-profile-completion",
  "account-reservation-transitions",
  "account-deletion-marker-reauth",
  "account-deletion-and-reactivation",
  "account-session-lifecycle",
  "account-linking-variants",
] as const;

export type WorkspaceE2EAccountCaseId =
  (typeof workspaceE2EAccountCaseIds)[number];

export const isWorkspaceE2EAccountCaseId = (
  value: string
): value is WorkspaceE2EAccountCaseId =>
  (workspaceE2EAccountCaseIds as readonly string[]).includes(value);
