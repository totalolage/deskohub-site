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
  readonly "timeout-minutes"?: number;
  readonly env?: Record<string, string>;
  readonly with?: Record<string, string | boolean>;
  readonly outputs?: Record<string, string>;
}

interface WorkflowJob {
  readonly name?: string;
  readonly if?: string;
  readonly needs?: string | readonly string[];
  readonly concurrency?: {
    readonly group: string;
    readonly "cancel-in-progress"?: boolean | string;
  };
  readonly outputs?: Record<string, string>;
  readonly steps?: readonly WorkflowStep[];
  readonly permissions?: Record<string, string>;
}

interface WorkflowDispatchInput {
  readonly default?: boolean | string;
  readonly description?: string;
  readonly required?: boolean;
  readonly type?: string;
}

export interface WorkflowDoc {
  readonly concurrency?: WorkflowJob["concurrency"];
  readonly jobs: Readonly<Record<string, WorkflowJob>>;
  readonly on?: Readonly<{
    readonly schedule?: readonly { readonly cron: string }[];
    readonly workflow_dispatch?: null | {
      readonly inputs?: Readonly<Record<string, WorkflowDispatchInput>>;
    };
  }>;
  readonly permissions?: Record<string, string>;
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

type WorkflowExpressionValue =
  | { readonly kind: "null" }
  | { readonly kind: "boolean"; readonly value: boolean }
  | { readonly kind: "string"; readonly value: string };

export interface WorkflowExpressionContext {
  /**
   * Contexts the caller models, such as `inputs`. A missing property of one
   * reads as null, as on GitHub; a path under any other context throws.
   */
  readonly contexts: readonly string[];
  /** Values keyed by their full path, such as `inputs.sha`. */
  readonly values: ReadonlyMap<string, WorkflowExpressionValue>;
}

type WorkflowExpressionToken =
  | { readonly kind: "operator"; readonly value: string }
  | { readonly kind: "path"; readonly value: string }
  | { readonly kind: "string"; readonly value: string };

export const workflowExpressionString = (
  value: string
): WorkflowExpressionValue => ({ kind: "string", value });

export const workflowExpressionBoolean = (
  value: boolean
): WorkflowExpressionValue => ({ kind: "boolean", value });

const expressionToken =
  /\s*(?:(==|&&|\|\|)|'((?:[^']|'')*)'|([A-Za-z_][\w-]*(?:\.[A-Za-z_][\w-]*)*))/y;

const tokenizeExpression = (
  source: string
): readonly WorkflowExpressionToken[] => {
  const tokens: WorkflowExpressionToken[] = [];
  expressionToken.lastIndex = 0;
  while (source.slice(expressionToken.lastIndex).trim() !== "") {
    const match = expressionToken.exec(source);
    if (match === null) {
      throw new Error(`unsupported workflow expression syntax: ${source}`);
    }
    const [, operator, text, path] = match;
    if (operator !== undefined) {
      tokens.push({ kind: "operator", value: operator });
    } else if (text !== undefined) {
      tokens.push({ kind: "string", value: text.replaceAll("''", "'") });
    } else {
      tokens.push({ kind: "path", value: path as string });
    }
  }
  return tokens;
};

const expressionTruthy = (value: WorkflowExpressionValue) =>
  value.kind === "boolean"
    ? value.value
    : value.kind === "string" && value.value !== "";

const expressionEqual = (
  left: WorkflowExpressionValue,
  right: WorkflowExpressionValue
) => {
  if (left.kind === "string" && right.kind === "string") {
    return left.value.toLowerCase() === right.value.toLowerCase();
  }
  if (left.kind === "boolean" && right.kind === "boolean") {
    return left.value === right.value;
  }
  if (left.kind === "null" && right.kind === "null") {
    return true;
  }
  throw new Error("unsupported mixed-type workflow expression comparison");
};

const resolveExpressionPath = (
  context: WorkflowExpressionContext,
  path: string
): WorkflowExpressionValue => {
  if (!context.contexts.some((root) => path.startsWith(`${root}.`))) {
    throw new Error(`unsupported workflow expression context: ${path}`);
  }
  return context.values.get(path) ?? { kind: "null" };
};

// Evaluates the GitHub Actions expression subset of context paths, string
// literals, ==, && and ||, with GitHub's precedence and operand-returning &&
// and ||. It evaluates both operands where GitHub short-circuits, and anything
// outside the subset throws, so an expression it cannot model fails instead
// of misevaluating.
const evaluateExpression = (
  source: string,
  context: WorkflowExpressionContext
): WorkflowExpressionValue => {
  const tokens = tokenizeExpression(source);
  let position = 0;
  const accept = (operator: string) => {
    const token = tokens[position];
    if (token?.kind !== "operator" || token.value !== operator) {
      return false;
    }
    position += 1;
    return true;
  };
  const operand = (): WorkflowExpressionValue => {
    const token = tokens[position];
    position += 1;
    if (token?.kind === "string") {
      return workflowExpressionString(token.value);
    }
    if (token?.kind === "path") {
      return resolveExpressionPath(context, token.value);
    }
    throw new Error(`unsupported workflow expression: ${source}`);
  };
  const equality = (): WorkflowExpressionValue => {
    const left = operand();
    return accept("==")
      ? workflowExpressionBoolean(expressionEqual(left, operand()))
      : left;
  };
  const and = (): WorkflowExpressionValue => {
    let value = equality();
    while (accept("&&")) {
      const right = equality();
      value = expressionTruthy(value) ? right : value;
    }
    return value;
  };
  const or = (): WorkflowExpressionValue => {
    let value = and();
    while (accept("||")) {
      const right = and();
      value = expressionTruthy(value) ? value : right;
    }
    return value;
  };
  const value = or();
  if (position !== tokens.length) {
    throw new Error(`unsupported workflow expression: ${source}`);
  }
  return value;
};

/**
 * Resolves a workflow value that is a single `${{ }}` expression to the
 * string GitHub hands the step, so tests can assert what a workflow does for
 * a given event instead of pinning its expression text.
 */
export const evaluateWorkflowValue = (
  value: string,
  context: WorkflowExpressionContext
): string => {
  const expression = /^\$\{\{(.*)\}\}$/s.exec(value.trim());
  if (expression === null) {
    throw new Error(`expected a single workflow expression: ${value}`);
  }
  const result = evaluateExpression(expression[1] as string, context);
  if (result.kind === "null") {
    return "";
  }
  return String(result.value);
};
