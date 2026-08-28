import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const runner = join(import.meta.dir, "posthog-agent-loop");
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true }))
  );
});

async function runAgentLoop(replayed: boolean, watchRace = false) {
  const directory = await mkdtemp(join(tmpdir(), "posthog-agent-loop-"));
  temporaryDirectories.push(directory);

  const calls = join(directory, "calls");
  const fakeT3 = join(directory, "t3");
  await Bun.write(
    fakeT3,
    `#!/usr/bin/env bash
set -euo pipefail
printf '%s\\n' "$*" >> "$T3_FAKE_CALLS"
case "$1" in
  create)
    printf '{"threadId":"thread-1","commandId":"create-1","sequence":1,"replayed":%s,"idempotencyKey":"dispatcher"}\\n' "$T3_FAKE_REPLAYED"
    ;;
  send)
    printf '{"threadId":"thread-1","commandId":"send-1","sequence":2,"replayed":false,"idempotencyKey":"tick"}\\n'
    ;;
  watch)
    if [[ "$T3_FAKE_WATCH_RACE" == "true" && ! -e "$T3_FAKE_WATCH_MARKER" ]]; then
      touch "$T3_FAKE_WATCH_MARKER"
      exit 25
    fi
    ;;
  *)
    exit 64
    ;;
esac
`
  );
  await chmod(fakeT3, 0o755);

  const process = Bun.spawn([runner], {
    env: {
      ...Bun.env,
      POSTHOG_AGENT_INSTRUCTIONS: join(import.meta.dir, "../references"),
      POSTHOG_AGENT_TICK_ID: "2026-08-28T22:00Z",
      T3_BIN: fakeT3,
      T3_FAKE_CALLS: calls,
      T3_FAKE_REPLAYED: String(replayed),
      T3_FAKE_WATCH_MARKER: join(directory, "watch-raced"),
      T3_FAKE_WATCH_RACE: String(watchRace),
      T3_PROJECT_ID: "project-1",
    },
    stderr: "pipe",
    stdout: "pipe",
  });
  const [exitCode, stderr] = await Promise.all([
    process.exited,
    new Response(process.stderr).text(),
  ]);

  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
  return (await Bun.file(calls).text()).trim().split("\n");
}

describe("posthog-agent-loop", () => {
  test("uses the create turn as the first dispatcher pass", async () => {
    const calls = await runAgentLoop(false, true);

    expect(calls.map((call) => call.split(" ")[0])).toEqual([
      "create",
      "watch",
      "watch",
    ]);
  });

  test("sends one idempotent pass to an existing dispatcher", async () => {
    const calls = await runAgentLoop(true);

    expect(calls.map((call) => call.split(" ")[0])).toEqual([
      "create",
      "send",
      "watch",
    ]);
    expect(calls[1]).toContain(
      "--idempotency-key deskohub-posthog-dispatcher:2026-08-28T22:00Z"
    );
    expect(calls[1]).toContain("thread-1");
  });
});
