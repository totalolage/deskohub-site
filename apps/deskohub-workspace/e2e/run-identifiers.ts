import { Schema } from "effect";

export const githubActionsRunIdSchema = Schema.Trim.check(Schema.isNonEmpty())
  .pipe(Schema.brand("GitHubActionsRunId"))
  .annotate({
    identifier: "GitHubActionsRunId",
    description: "Identifier of a GitHub Actions workflow run.",
  });
export type GitHubActionsRunId = typeof githubActionsRunIdSchema.Type;

export const workspaceE2ERunIdSchema = Schema.Trim.check(Schema.isNonEmpty())
  .pipe(Schema.brand("WorkspaceE2ERunId"))
  .annotate({
    identifier: "WorkspaceE2ERunId",
    description: "Correlation identifier for one Workspace E2E suite run.",
  });
export type WorkspaceE2ERunId = typeof workspaceE2ERunIdSchema.Type;
