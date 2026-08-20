export interface WorkspaceEmailDetail {
  readonly href?: string;
  readonly label: string;
  readonly value: string;
}

export const renderWorkspaceEmailDetailsText = (
  details: readonly WorkspaceEmailDetail[]
): readonly string[] => details.map(({ label, value }) => `${label}: ${value}`);
