import { readFileSync } from "node:fs";

/**
 * Parses a tracked GitHub Actions workflow into typed objects so tests can
 * assert on workflow semantics (steps, run commands, permissions, env)
 * instead of pinned YAML substrings.
 */

export interface WorkflowStep {
  readonly name?: string;
  readonly run?: string;
  readonly uses?: string;
  readonly id?: string;
  readonly if?: string;
  readonly "working-directory"?: string;
  readonly "continue-on-error"?: boolean;
  readonly env?: Record<string, string>;
  readonly with?: Record<string, string | boolean>;
  readonly outputs?: Record<string, string>;
}

export interface WorkflowJob {
  readonly name?: string;
  readonly if?: string;
  readonly needs?: string | readonly string[];
  readonly steps?: readonly WorkflowStep[];
  readonly permissions?: Record<string, string>;
}

export interface WorkflowDoc {
  readonly jobs: Readonly<Record<string, WorkflowJob>>;
}

export const parseWorkflow = (path: string): WorkflowDoc =>
  Bun.YAML.parse(readFileSync(path, "utf8")) as WorkflowDoc;

export const workflowJobs = (doc: WorkflowDoc): readonly string[] =>
  Object.keys(doc.jobs);

export const workflowSteps = (
  doc: WorkflowDoc,
  jobId: string
): readonly WorkflowStep[] => doc.jobs[jobId]?.steps ?? [];

export const workflowStepNames = (doc: WorkflowDoc): readonly string[] =>
  Object.values(doc.jobs).flatMap((job) =>
    (job.steps ?? [])
      .map((step) => step.name ?? "")
      .filter((name) => name.length > 0)
  );

export const workflowStepRuns = (doc: WorkflowDoc): readonly string[] =>
  Object.values(doc.jobs).flatMap((job) =>
    (job.steps ?? [])
      .map((step) => step.run ?? "")
      .filter((run) => run.length > 0)
  );

export const findStepByName = (
  doc: WorkflowDoc,
  name: string
): WorkflowStep | undefined =>
  Object.values(doc.jobs)
    .flatMap((job) => job.steps ?? [])
    .find((step) => step.name === name);

export const stepOrderIndexes = (
  stepNames: readonly string[],
  names: readonly string[]
): readonly number[] => names.map((name) => stepNames.indexOf(name));
