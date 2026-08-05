export interface WorkspaceEmailDetail {
  readonly label: string;
  readonly value: string;
}

export const renderWorkspaceEmailDetailsText = (
  details: readonly WorkspaceEmailDetail[]
): readonly string[] => details.map(({ label, value }) => `${label}: ${value}`);
