import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { workspaceE2EAccessCodeMutationBarrierCount } from "../timeouts";
import { selectActionReplayHeaders } from "./access-code-case";

describe("access code creation case planning", () => {
  test("keeps only action-relevant headers when replaying a captured request", () => {
    const replayHeaders = selectActionReplayHeaders({
      accept: "*/*",
      "accept-encoding": "gzip, deflate",
      authorization: "Basic c2VjcmV0",
      connection: "keep-alive",
      "content-length": "256",
      "content-type": "text/plain;charset=UTF-8",
      cookie: "_vercel_protection_bypass=secret",
      host: "deskohub-workspace-site-abc12345-deskohub.vercel.app",
      "next-action": "7f9c0e2b",
      "next-router-state-tree": "%5B%22%22%5D",
      origin: "https://deskohub-workspace-site-abc12345-deskohub.vercel.app",
      "x-vercel-protection-bypass": "secret",
    });

    expect(replayHeaders).toEqual({
      accept: "*/*",
      "accept-encoding": "gzip, deflate",
      "content-type": "text/plain;charset=UTF-8",
      "next-action": "7f9c0e2b",
      "next-router-state-tree": "%5B%22%22%5D",
      origin: "https://deskohub-workspace-site-abc12345-deskohub.vercel.app",
    });
  });
});

describe("access code cleanup budget", () => {
  test("budgets every mutation barrier the case waits on", () => {
    const caseSource = readFileSync(
      resolve(import.meta.dir, "create-access-code.pw.ts"),
      "utf8"
    );
    // Comment-aware: a commented-out barrier call must not count as a wait.
    const activeCaseSource = caseSource
      .split("\n")
      .map((line) => {
        const commentAt = line.indexOf("//");
        return commentAt === -1 ? line : line.slice(0, commentAt);
      })
      .join("\n");
    const barrierWaits =
      activeCaseSource.split("awaitActionQuiescence(").length - 1;

    expect(barrierWaits).toBe(workspaceE2EAccessCodeMutationBarrierCount);
  });
});
