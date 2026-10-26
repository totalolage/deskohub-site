import { isWorkspaceE2EDiagnosticCode } from "./errors";
import type { WorkspaceE2EFailureDiagnostic } from "./services/telemetry";

const safeDiagnosticIdentifier = (value: string) =>
  /^[a-z0-9-]+$/.test(value) ? value : "invalid";

export const formatWorkspaceE2EFailureAnnotation = (
  diagnostic: WorkspaceE2EFailureDiagnostic
) =>
  `::error title=Workspace E2E case failed::${[
    `case=${safeDiagnosticIdentifier(diagnostic.caseId)}`,
    ...(diagnostic.stepId
      ? [`step=${safeDiagnosticIdentifier(diagnostic.stepId)}`]
      : []),
    ...(isWorkspaceE2EDiagnosticCode(diagnostic.diagnosticCode)
      ? [`diagnostic_code=${diagnostic.diagnosticCode}`]
      : []),
    `outcome=${diagnostic.outcome}`,
    `failure_kind=${diagnostic.failureKind}`,
  ].join(",")}\n`;

export const writeWorkspaceE2EFailureAnnotation = (
  diagnostic: WorkspaceE2EFailureDiagnostic
) => {
  process.stdout.write(formatWorkspaceE2EFailureAnnotation(diagnostic));
};
