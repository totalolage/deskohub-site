import { describe, expect, test } from "bun:test";
import {
  evaluateWorkflowValue,
  workflowExpressionBoolean,
  workflowExpressionString,
} from "./workflow-contract";

const context = {
  contexts: ["github", "inputs"],
  values: new Map([
    ["github.event_name", workflowExpressionString("workflow_dispatch")],
    ["inputs.enabled", workflowExpressionBoolean(true)],
    ["inputs.disabled", workflowExpressionBoolean(false)],
    ["secrets.example", workflowExpressionString("unmodeled")],
  ]),
};

const evaluate = (expression: string) =>
  evaluateWorkflowValue(`\${{ ${expression} }}`, context);

describe("workflow expression evaluation", () => {
  test("returns operands from && and || as GitHub does", () => {
    expect(evaluate("'a' && 'b'")).toBe("b");
    expect(evaluate("'' && 'b'")).toBe("");
    expect(evaluate("'' || 'b'")).toBe("b");
    expect(evaluate("inputs.disabled && 'set'")).toBe("false");
  });

  test("binds == tighter than && and && tighter than ||", () => {
    expect(evaluate("'x' || '' && 'y'")).toBe("x");
    expect(evaluate("'a' == 'b' || 'c' == 'c' && 'd'")).toBe("d");
  });

  test("treats the string 'false' as truthy and the boolean false as falsy", () => {
    expect(evaluate("'false' && 'set'")).toBe("set");
    expect(evaluate("inputs.disabled || 'unset'")).toBe("unset");
  });

  test("hands the step booleans as text and a missing input as empty", () => {
    expect(evaluate("inputs.enabled")).toBe("true");
    expect(evaluate("inputs.missing")).toBe("");
  });

  test("compares strings case-insensitively and unescapes quotes", () => {
    expect(evaluate("github.event_name == 'WORKFLOW_DISPATCH'")).toBe("true");
    expect(evaluate("'it''s set'")).toBe("it's set");
  });

  test("rejects expressions outside the modeled subset", () => {
    expect(() => evaluate("always()")).toThrow();
    expect(() => evaluate("secrets.example")).toThrow();
    expect(() => evaluate("'set' || secrets.example")).toThrow();
    expect(() => evaluate("inputs.enabled == 'true'")).toThrow();
    expect(() => evaluate("inputs.enabled &&")).toThrow();
    expect(() => evaluate("inputs.enabled 'set'")).toThrow();
    expect(() => evaluateWorkflowValue("true", context)).toThrow();
    expect(() =>
      evaluateWorkflowValue(`prefix-\${{ inputs.enabled }}`, context)
    ).toThrow();
  });
});
