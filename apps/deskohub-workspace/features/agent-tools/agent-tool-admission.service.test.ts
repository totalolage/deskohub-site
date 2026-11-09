import "@/shared/testing/workspace-test-env";

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { Effect, Logger } from "effect";

let checkResult: () => Promise<{
  readonly rateLimited: boolean;
  readonly error?: "not-found" | "blocked";
}> = async () => ({ rateLimited: false });
const checkRateLimit = mock(() => checkResult());
mock.module("@vercel/firewall", () => ({ checkRateLimit }));

const { AgentToolAdmission } = await import("./agent-tool-admission.service");

type LogRecord = {
  readonly level: string;
  readonly message: unknown;
  readonly annotations: unknown;
};

const logRecords: LogRecord[] = [];
const logger = Logger.make((options) => {
  logRecords.push({
    level: options.logLevel,
    message: options.message[0],
    annotations: options.message[1],
  });
});

const headers = new Headers({ "x-real-ip": "203.0.113.7" });

const isCallAllowed = () =>
  Effect.runPromise(
    AgentToolAdmission.pipe(
      Effect.flatMap((admission) => admission.isCallAllowed(headers)),
      Effect.result,
      Effect.provide([AgentToolAdmission.Default, Logger.layer([logger])])
    )
  );

describe("AgentToolAdmission", () => {
  beforeEach(() => {
    logRecords.length = 0;
    checkRateLimit.mockClear();
  });

  test("admits calls within the agent-tool-call limit", async () => {
    checkResult = async () => ({ rateLimited: false });

    const result = await isCallAllowed();

    expect(result).toMatchObject({ _tag: "Success", success: true });
    expect(checkRateLimit).toHaveBeenCalledWith("agent-tool-call", {
      headers,
    });
    expect(logRecords).toEqual([]);
  });

  test("denies rate-limited and blocked clients", async () => {
    checkResult = async () => ({ rateLimited: true });
    const limited = await isCallAllowed();
    checkResult = async () => ({ rateLimited: false, error: "blocked" });
    const blocked = await isCallAllowed();

    expect(limited).toMatchObject({ _tag: "Success", success: false });
    expect(blocked).toMatchObject({ _tag: "Success", success: false });
  });

  test("fails closed and logs the rule ID when the rule is missing", async () => {
    checkResult = async () => ({ rateLimited: false, error: "not-found" });

    const result = await isCallAllowed();

    expect(result).toMatchObject({
      _tag: "Failure",
      failure: { _tag: "AgentToolAdmissionError", reason: "rule-missing" },
    });
    expect(logRecords).toEqual([
      {
        level: "Error",
        message: "Agent tool rate limit could not be checked",
        annotations: {
          rateLimitId: "agent-tool-call",
          reason: "rule-missing",
          cause: undefined,
        },
      },
    ]);
  });

  test("fails closed and logs the cause when the firewall check rejects", async () => {
    const cause = new Error("firewall unreachable");
    checkResult = () => Promise.reject(cause);

    const result = await isCallAllowed();

    expect(result).toMatchObject({
      _tag: "Failure",
      failure: { _tag: "AgentToolAdmissionError", reason: "check-failed" },
    });
    expect(logRecords).toEqual([
      {
        level: "Error",
        message: "Agent tool rate limit could not be checked",
        annotations: {
          rateLimitId: "agent-tool-call",
          reason: "check-failed",
          cause,
        },
      },
    ]);
  });
});
