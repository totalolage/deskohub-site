import type { WorkspaceAvailabilityQuery } from "./workspace-availability";

export const workspaceAvailabilityReplacementHeader =
  "x-deskohub-workspace-replacement";

export type WorkspaceAvailabilityClientRequest = {
  readonly query: WorkspaceAvailabilityQuery;
  readonly replacementToken?: string;
};
