import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const runner = join(import.meta.dir, "posthog-agent-loop");
const workerCreator = join(import.meta.dir, "posthog-create-worker");
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { force: true, recursive: true }))
  );
});

async function runAgentLoop(
  replayed: boolean,
  watchStatus = 0,
  watchRace = false
) {
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
    if [[ ! -e "$T3_FAKE_STATUS_MARKER" ]]; then
      touch "$T3_FAKE_STATUS_MARKER"
      if [[ "$T3_FAKE_WATCH_STATUS" != 0 ]]; then
        exit "$T3_FAKE_WATCH_STATUS"
      fi
    fi
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
      T3_FAKE_STATUS_MARKER: join(directory, "watch-status-used"),
      T3_FAKE_WATCH_MARKER: join(directory, "watch-raced"),
      T3_FAKE_WATCH_RACE: String(watchRace),
      T3_FAKE_WATCH_STATUS: String(watchStatus),
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
    const calls = await runAgentLoop(false, 0, true);

    expect(calls.map((call) => call.split(" ")[0])).toEqual([
      "create",
      "watch",
      "watch",
    ]);
  });

  test("sends one idempotent pass to an existing dispatcher", async () => {
    const calls = await runAgentLoop(true, 20);

    expect(calls.map((call) => call.split(" ")[0])).toEqual([
      "create",
      "watch",
      "send",
      "watch",
    ]);
    expect(calls[1]).toContain("--timeout 1s");
    expect(calls[2]).toContain(
      "--idempotency-key deskohub-posthog-dispatcher:2026-08-28T22:00Z"
    );
    expect(calls[2]).toContain("thread-1");
  });

  test("reattaches without sending when the dispatcher is running", async () => {
    const calls = await runAgentLoop(true, 23);

    expect(calls.map((call) => call.split(" ")[0])).toEqual([
      "create",
      "watch",
      "watch",
    ]);
  });

  test("creates issue workers with GPT-5.6-Sol and high reasoning", async () => {
    const directory = await mkdtemp(join(tmpdir(), "posthog-worker-"));
    temporaryDirectories.push(directory);
    const curlArguments = join(directory, "curl-arguments");
    const payloadPath = join(directory, "payload");
    const fakeT3 = join(directory, "t3");
    const fakeCurl = join(directory, "curl");

    await Bun.write(
      fakeT3,
      `#!/usr/bin/env bash
set -euo pipefail
case "$1" in
  session) printf '{"target":{"httpBaseUrl":"http://127.0.0.1:3773"}}\n' ;;
  auth) printf 'fake-token\n' ;;
  *) exit 64 ;;
esac
`
    );
    await Bun.write(
      fakeCurl,
      `#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" > "$CURL_FAKE_ARGUMENTS"
while (($#)); do
  if [[ "$1" == "--data-binary" ]]; then
    printf '%s' "$2" > "$CURL_FAKE_PAYLOAD"
    shift 2
  else
    shift
  fi
done
cat >/dev/null
printf '{"sequence":42}\n'
`
    );
    await Promise.all([chmod(fakeT3, 0o755), chmod(fakeCurl, 0o755)]);

    const process = Bun.spawn([workerCreator, "303"], {
      env: {
        ...Bun.env,
        CURL_BIN: fakeCurl,
        CURL_FAKE_ARGUMENTS: curlArguments,
        CURL_FAKE_PAYLOAD: payloadPath,
        T3_BASE_DIR: directory,
        T3_BIN: fakeT3,
      },
      stderr: "pipe",
      stdout: "pipe",
    });
    const [exitCode, stdout, stderr] = await Promise.all([
      process.exited,
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
    ]);
    const payload = await Bun.file(payloadPath).json();

    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual({
      commandId: "posthog-worker-create-issue-303-v1",
      sequence: 42,
      threadId: "posthog-worker-issue-303",
    });
    expect(payload.modelSelection).toEqual({
      instanceId: "codex",
      model: "gpt-5.6-sol",
      options: [{ id: "reasoningEffort", value: "high" }],
    });
    expect(payload.bootstrap.createThread.modelSelection).toEqual(
      payload.modelSelection
    );
    expect(await Bun.file(curlArguments).text()).not.toContain("fake-token");
  });
});
