import { describe, expect, test } from "bun:test";
import {
  parseAgentEvalHarnesses,
  parseAgentEvalResponse,
} from "./harness-contract";

describe("parseAgentEvalHarnesses", () => {
  test("decodes the devbox harness list", () => {
    expect(
      parseAgentEvalHarnesses(
        JSON.stringify([
          {
            command: ["./bin/run-harness", "playwright-mcp"],
            id: "playwright-mcp",
            perception: "accessibility-tree",
          },
          {
            command: ["/usr/bin/agent"],
            id: "vision",
            perception: "screenshot",
          },
        ])
      ).map((harness) => harness.id)
    ).toEqual(["playwright-mcp", "vision"]);
  });

  test.each([
    ["an empty list", "[]"],
    ["a list that isn't JSON", "playwright-mcp"],
    [
      "an unknown perception",
      JSON.stringify([{ command: ["a"], id: "a", perception: "dom" }]),
    ],
    [
      "an id that isn't a slug",
      JSON.stringify([
        { command: ["a"], id: "Playwright MCP", perception: "hybrid" },
      ]),
    ],
    [
      "an empty command",
      JSON.stringify([{ command: [], id: "a", perception: "hybrid" }]),
    ],
  ])("rejects %s", (_label, serialized) => {
    expect(() => parseAgentEvalHarnesses(serialized)).toThrow(
      "JSON array of { id, perception, command }"
    );
  });

  test("rejects duplicate ids", () => {
    const harness = { command: ["a"], id: "a", perception: "hybrid" };
    expect(() =>
      parseAgentEvalHarnesses(JSON.stringify([harness, harness]))
    ).toThrow("unique");
  });
});

describe("parseAgentEvalResponse", () => {
  test("decodes a response and ignores harness-specific extra keys", () => {
    expect(
      parseAgentEvalResponse(
        `${JSON.stringify({
          costUsd: 0.12,
          driver: "codex",
          finalAnswer: "Booked.",
          steps: 14,
          usage: { inputTokens: 10 },
        })}\n`
      )
    ).toEqual({ costUsd: 0.12, finalAnswer: "Booked.", steps: 14 });
  });

  test.each([
    ["log lines before the JSON", 'log\n{"finalAnswer":"","steps":0}'],
    ["negative steps", '{"finalAnswer":"","steps":-1}'],
    ["a missing final answer", '{"steps":2}'],
    ["empty output", ""],
  ])("rejects %s", (_label, stdout) => {
    expect(parseAgentEvalResponse(stdout)).toBeUndefined();
  });
});
