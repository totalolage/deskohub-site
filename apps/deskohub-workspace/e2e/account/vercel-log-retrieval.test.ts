import { describe, expect, test } from "bun:test";
import { Effect, Schema } from "effect";
import { makeWorkspaceE2EEnvironment } from "../e2e-env";
import { validE2ERuntimeEnvironment } from "../e2e-env.test-fixture";
import { workspaceE2ERunIdSchema } from "../run-identifiers";
import { redact } from "../runtime";
import {
  getAccountE2EConfig,
  makeWorkspaceE2EAccountRecipient,
} from "./config";
import type { WorkspaceE2EVercelLogsProcess } from "./vercel-log-retrieval";
import {
  listSyntheticLogEntryIds,
  retrieveWorkspaceE2EMagicLink,
} from "./vercel-log-retrieval";

const config = getAccountE2EConfig(
  makeWorkspaceE2EEnvironment({
    ...validE2ERuntimeEnvironment,
    WORKSPACE_E2E_VERCEL_PROJECT: "workspace-preview-project",
    WORKSPACE_E2E_VERCEL_TOKEN: "vercel-log-read-token",
  }),
  Schema.decodeUnknownSync(workspaceE2ERunIdSchema)("1234567890-2")
);

const recipient = makeWorkspaceE2EAccountRecipient(config, "retrieval");
const expectedHost = config.expectedHost;
const authOrigin = `https://${expectedHost}`;
const callbackPath = `/${config.locale}/auth/callback`;

const magicLink = (token: string) =>
  `${authOrigin}/api/auth/magic-link/verify?token=${token}&callbackURL=${encodeURIComponent(callbackPath)}`;

const previewE2ELine = (text: string, recipientOverride?: string | null) =>
  JSON.stringify({
    code: "account.magic-link.preview-e2e",
    ...(recipientOverride === null
      ? {}
      : { recipient: recipientOverride ?? recipient }),
    message: "Synthetic preview magic-link text body for E2E retrieval.",
    text,
  });

type FakeLogEntry = {
  readonly message: string;
  readonly messageTruncated?: boolean;
};

type FakeLogRequest = {
  readonly id: string;
  readonly logs: readonly FakeLogEntry[];
  readonly message?: string;
  readonly messageTruncated?: boolean;
};

type CliInvocation = {
  readonly args: readonly string[];
  readonly env: Readonly<Record<string, string | undefined>>;
};

/** Serialized stdout exactly as `vercel logs --json` writes it: JSON Lines. */
const jsonl = (requests: readonly FakeLogRequest[]): string =>
  requests.map((request) => JSON.stringify(request)).join("\n");

const matchingLogEntry = (
  overrides: Partial<FakeLogEntry> = {}
): FakeLogEntry => ({
  message: previewE2ELine(magicLink("token")),
  ...overrides,
});

const infoLogEntry = (text: string): FakeLogEntry => ({ message: text });

const makeRetrieval = (
  stdout: string,
  options: {
    readonly exitCode?: number;
    readonly excludeLogEntryIds?: readonly string[];
    readonly processRejection?: Error;
    readonly stderr?: string;
  } = {}
) => {
  const invocations: CliInvocation[] = [];
  const fakeProcess: WorkspaceE2EVercelLogsProcess = async (command) => {
    invocations.push({ args: command.args, env: command.env });
    if (options.processRejection) throw options.processRejection;
    if (options.exitCode !== undefined) {
      return {
        exitCode: options.exitCode,
        stderr: options.stderr ?? "cli failed",
        stdout: "",
      };
    }
    return { exitCode: 0, stderr: "", stdout };
  };

  const result = Effect.runPromise(
    retrieveWorkspaceE2EMagicLink(
      { ...config, vercelLogsProcess: fakeProcess },
      {
        callbackPath,
        deadlineAfterMs: 200,
        excludeLogEntryIds: options.excludeLogEntryIds,
        pollIntervalMs: 10,
        recipient,
        startedAt: new Date(),
      }
    )
  );
  return { invocations, result };
};

const captureFailure = (result: Promise<string>) =>
  result.then(
    () => {
      throw new Error("expected Vercel log retrieval to fail");
    },
    (failure: unknown) => failure
  );

describe("workspace e2e Vercel log retrieval", () => {
  test("runs the pinned CLI with the bounded scoped query and returns the validated link", async () => {
    const stdout = jsonl([
      {
        id: "req-1",
        logs: [
          infoLogEntry("GET /api/auth/sign-in/magic-link 200 in 42ms"),
          matchingLogEntry(),
          infoLogEntry("ERROR upstash ratelimit exceeded"),
        ],
      },
    ]);
    const { invocations, result } = makeRetrieval(stdout);

    await expect(result).resolves.toBe(magicLink("token"));
    expect(invocations).toHaveLength(1);
    const invocation = invocations[0];
    expect(invocation?.args.slice(0, 3)).toEqual([
      "logs",
      "--deployment",
      config.baseUrl,
    ]);
    expect(invocation?.args).toContain("--json");
    expect(invocation?.args).toContain("--limit");
    expect(invocation?.args[invocation.args.indexOf("--limit") + 1]).toBe(
      "100"
    );
    expect(invocation?.args).toContain("--since");
    expect(invocation?.args).toContain("--query");
    expect(invocation?.args).toContain("--no-branch");
    expect(invocation?.args[invocation.args.indexOf("--project") + 1]).toBe(
      "workspace-preview-project"
    );
    // The log-read token travels in the child environment, never in argv.
    expect(invocation?.env.VERCEL_TOKEN).toBe("vercel-log-read-token");
    expect(invocation?.args.join(" ")).not.toContain("vercel-log-read-token");
  });

  test("matches the individual log entry, not the request-level message", async () => {
    const stdout = jsonl([
      {
        id: "req-decoy",
        logs: [infoLogEntry("unrelated runtime log line")],
        message: previewE2ELine(magicLink("token")),
      },
    ]);
    const { result } = makeRetrieval(stdout);

    await expect(result).rejects.toThrow("before the deadline");
  });

  test("treats empty stdout as zero entries", async () => {
    const { result } = makeRetrieval("");

    await expect(result).rejects.toThrow("before the deadline");
  });

  test("rejects multiple valid matches for the exact recipient", async () => {
    const stdout = jsonl([
      {
        id: "req-a",
        logs: [matchingLogEntry()],
      },
      {
        id: "req-b",
        logs: [matchingLogEntry()],
      },
    ]);
    const { result } = makeRetrieval(stdout);

    await expect(result).rejects.toThrow("multiple preview log entries");
  });

  test("fails closed when the matching request record is truncated", async () => {
    const stdout = jsonl([
      { id: "req-t", logs: [matchingLogEntry()], messageTruncated: true },
    ]);
    const { result } = makeRetrieval(stdout);

    await expect(result).rejects.toThrow("truncated preview log entry");
  });

  test("fails closed when the matching log entry is truncated", async () => {
    const stdout = jsonl([
      {
        id: "req-t",
        logs: [matchingLogEntry({ messageTruncated: true })],
      },
    ]);
    const { result } = makeRetrieval(stdout);

    await expect(result).rejects.toThrow("truncated preview log entry");
  });

  test("rejects a malformed JSONL line and fails closed", async () => {
    const { result } = makeRetrieval(
      `${jsonl([{ id: "req-ok", logs: [infoLogEntry("fine")] }])}\nnot json`
    );

    await expect(result).rejects.toMatchObject({
      _tag: "WorkspaceE2EError",
      diagnosticCode: "auth_delivery_message_invalid",
      message: "Vercel runtime log payload was invalid",
      operation: "decode Vercel runtime log entries",
    });
  });

  test("rejects a JSONL request with an invalid log-entry shape", async () => {
    const { result } = makeRetrieval(
      JSON.stringify({ id: "req-invalid-shape", logs: [{ message: 1 }] })
    );

    await expect(result).rejects.toMatchObject({
      _tag: "WorkspaceE2EError",
      diagnosticCode: "auth_delivery_message_invalid",
      message: "Vercel runtime log payload was invalid",
      operation: "decode Vercel runtime log entries",
    });
  });

  test("rejects a matching log line that is not valid JSON", async () => {
    const stdout = jsonl([
      {
        id: "req-broken",
        logs: [
          {
            message: `{"code":"account.magic-link.preview-e2e","recipient":"${recipient}","text":"http`,
          },
        ],
      },
    ]);
    const { result } = makeRetrieval(stdout);

    await expect(result).rejects.toThrow("unreadable preview log entry");
  });

  test("rejects a matching entry whose recipient is absent", async () => {
    const noRecipient = jsonl([
      {
        id: "req-r",
        logs: [{ message: previewE2ELine(magicLink("token"), null) }],
      },
    ]);
    const { result } = makeRetrieval(noRecipient);

    await expect(result).rejects.toThrow("unreadable preview log entry");
  });

  test("skips a well-formed entry whose recipient does not match exactly", async () => {
    const stdout = jsonl([
      {
        id: "req-r",
        logs: [
          {
            message: previewE2ELine(magicLink("token"), "other@resend.dev"),
          },
        ],
      },
    ]);
    const { result } = makeRetrieval(stdout);

    await expect(result).rejects.toThrow("before the deadline");
  });

  test("returns only the requested recipient's link when other synthetic recipients are present", async () => {
    const secondRecipient = makeWorkspaceE2EAccountRecipient(config, "second");
    const mainLink = magicLink("main-token");
    const secondLink = magicLink("second-token");
    const stdout = jsonl([
      {
        id: "req-main",
        logs: [{ message: previewE2ELine(mainLink) }],
      },
      {
        id: "req-second",
        logs: [{ message: previewE2ELine(secondLink, secondRecipient) }],
      },
    ]);
    const { result } = makeRetrieval(stdout);

    await expect(result).resolves.toBe(mainLink);
  });

  test("matches a recipient case-insensitively", async () => {
    const stdout = jsonl([
      {
        id: "req-ci",
        logs: [
          {
            message: previewE2ELine(
              magicLink("token"),
              recipient.toUpperCase()
            ),
          },
        ],
      },
    ]);
    const { result } = makeRetrieval(stdout);

    await expect(result).resolves.toBe(magicLink("token"));
  });

  test("ignores a log entry without the fixed preview-e2e code and times out instead", async () => {
    const stdout = jsonl([
      {
        id: "req-wrong-code",
        logs: [
          {
            message: JSON.stringify({
              code: "other.code",
              text: magicLink("t"),
            }),
          },
        ],
      },
    ]);
    const { result } = makeRetrieval(stdout);

    await expect(result).rejects.toThrow("before the deadline");
  });

  test("passes the fixed preview-e2e code as the --query marker", async () => {
    const { invocations, result } = makeRetrieval(
      jsonl([{ id: "req-match", logs: [matchingLogEntry()] }])
    );

    await result;
    const invocation = invocations[0];
    expect(invocation?.args[invocation.args.indexOf("--query") + 1]).toBe(
      "account.magic-link.preview-e2e"
    );
  });

  test("categorizes a CLI HTTP failure without exposing raw CLI text", async () => {
    const secretSentinel = "sentinel-vercel-token-value";
    const urlSentinel = `https://private.example.test/logs?token=${secretSentinel}`;
    const { result } = makeRetrieval("", {
      exitCode: 1,
      stderr: `Error: HTTP 401 at ${urlSentinel}; credential ${secretSentinel}`,
    });

    const failure = await captureFailure(result);
    expect(failure).toMatchObject({
      _tag: "WorkspaceE2EError",
      diagnosticCode: "auth_delivery_message_retrieve_failed",
      message:
        "query Vercel preview runtime logs failed (cli-authentication-rejected)",
      operation: "query Vercel preview runtime logs",
    });
    expect((failure as { cause?: unknown }).cause).toBeUndefined();
    const failureText = [
      String(failure),
      (failure as { message?: string }).message,
      JSON.stringify(failure),
    ].join(" ");
    expect(failureText).not.toContain(secretSentinel);
    expect(failureText).not.toContain(urlSentinel);
  });

  test("maps only supported HTTP status classes to fixed CLI categories", async () => {
    const cases = [
      {
        stderr: "request failed with status code 403",
        category: "cli-access-forbidden",
      },
      { stderr: "HTTP/2 404", category: "cli-resource-not-found" },
      { stderr: "HTTP 429", category: "cli-rate-limited" },
      { stderr: "HTTP 503", category: "cli-server-error" },
      { stderr: "HTTP 418", category: "cli-rejected" },
      { stderr: "HTTP 401 then HTTP 403", category: "cli-rejected" },
    ] as const;

    for (const { stderr, category } of cases) {
      const { result } = makeRetrieval("", { exitCode: 1, stderr });
      await expect(result).rejects.toMatchObject({
        _tag: "WorkspaceE2EError",
        diagnosticCode: "auth_delivery_message_retrieve_failed",
        message: `query Vercel preview runtime logs failed (${category})`,
        operation: "query Vercel preview runtime logs",
      });
    }
  });

  test("categorizes process rejection without retaining raw cause text", async () => {
    const secretSentinel = "sentinel-process-token-value";
    const urlSentinel = `https://private.example.test/launch?token=${secretSentinel}`;
    const { result } = makeRetrieval("", {
      processRejection: new Error(`launch failed for ${urlSentinel}`),
    });

    const failure = await captureFailure(result);
    expect(failure).toMatchObject({
      _tag: "WorkspaceE2EError",
      diagnosticCode: "auth_delivery_message_retrieve_failed",
      message: "query Vercel preview runtime logs failed (process-rejected)",
      operation: "query Vercel preview runtime logs",
    });
    expect((failure as { cause?: unknown }).cause).toBeUndefined();
    const failureText = [
      String(failure),
      (failure as { message?: string }).message,
      JSON.stringify(failure),
    ].join(" ");
    expect(failureText).not.toContain(secretSentinel);
    expect(failureText).not.toContain(urlSentinel);
  });

  test("classifies standard process error messages without exposing their text", async () => {
    const secretSentinel = "sentinel-private-process-message";
    const cases = [
      {
        message: `spawn bunx: No such file or directory (${secretSentinel})`,
        category: "process-executable-not-found",
      },
      {
        message: `spawn bunx: Permission denied (${secretSentinel})`,
        category: "process-permission-denied",
      },
      {
        message: `spawn bunx: Resource temporarily unavailable (${secretSentinel})`,
        category: "process-resource-unavailable",
      },
      {
        message: `spawn bunx: Too many open files (${secretSentinel})`,
        category: "process-file-descriptors-exhausted",
      },
      {
        message: `spawn bunx: Out of memory (${secretSentinel})`,
        category: "process-memory-pressure",
      },
      {
        message: `spawn bunx: operation timed out (${secretSentinel})`,
        category: "process-timeout",
      },
    ] as const;

    const failureMessages: unknown[] = [];
    for (const { message } of cases) {
      const { result } = makeRetrieval("", {
        processRejection: new Error(message),
      });
      const failure = await captureFailure(result);

      expect(failure).toMatchObject({
        _tag: "WorkspaceE2EError",
        diagnosticCode: "auth_delivery_message_retrieve_failed",
        operation: "query Vercel preview runtime logs",
      });
      failureMessages.push((failure as { message?: unknown }).message);
      expect((failure as { cause?: unknown }).cause).toBeUndefined();
      const failureText = [
        String(failure),
        (failure as { message?: string }).message,
        JSON.stringify(failure),
      ].join(" ");
      expect(failureText).not.toContain(secretSentinel);
      expect(failureText).not.toContain(message);
    }
    expect(failureMessages).toEqual(
      cases.map(
        ({ category }) =>
          `query Vercel preview runtime logs failed (${category})`
      )
    );
  });

  test("classifies structured process rejection fields without exposing error text", async () => {
    const cases = [
      { code: "ENOENT", category: "process-executable-not-found" },
      { code: "EACCES", category: "process-permission-denied" },
      { code: "EPERM", category: "process-permission-denied" },
      { code: "ETIMEDOUT", category: "process-timeout" },
      { code: "EAGAIN", category: "process-resource-unavailable" },
      {
        code: "EMFILE",
        category: "process-file-descriptors-exhausted",
      },
      { code: "ENOMEM", category: "process-memory-pressure" },
      { name: "AbortError", category: "process-timeout" },
      { code: "UNKNOWN_CODE", category: "process-rejected" },
    ] as const;

    for (const rejection of cases) {
      const sentinel = `sentinel-process-rejection-${rejection.code ?? rejection.name}`;
      const error = Object.assign(
        new Error(`${sentinel}: private process details`),
        "code" in rejection ? { code: rejection.code } : {},
        "name" in rejection ? { name: rejection.name } : {}
      );
      const { result } = makeRetrieval("", { processRejection: error });

      const failure = await captureFailure(result);
      expect(failure).toMatchObject({
        _tag: "WorkspaceE2EError",
        diagnosticCode: "auth_delivery_message_retrieve_failed",
        message: `query Vercel preview runtime logs failed (${rejection.category})`,
        operation: "query Vercel preview runtime logs",
      });
      expect((failure as { cause?: unknown }).cause).toBeUndefined();
      const failureText = [
        String(failure),
        (failure as { message?: string }).message,
        JSON.stringify(failure),
      ].join(" ");
      expect(failureText).not.toContain(sentinel);
      expect(failureText).not.toContain("private process details");
    }
  });

  test("classifies recognized structured fields up to three nested causes", async () => {
    const cases = [
      { code: "ENOENT", category: "process-executable-not-found" },
      { code: "EACCES", category: "process-permission-denied" },
      { code: "EPERM", category: "process-permission-denied" },
      { code: "ETIMEDOUT", category: "process-timeout" },
      { code: "EAGAIN", category: "process-resource-unavailable" },
      {
        code: "EMFILE",
        category: "process-file-descriptors-exhausted",
      },
      { code: "ENOMEM", category: "process-memory-pressure" },
      { name: "AbortError", category: "process-timeout" },
      {
        message: "Resource temporarily unavailable",
        category: "process-resource-unavailable",
      },
    ] as const;

    for (const rejection of cases) {
      const sentinel = `sentinel-nested-rejection-${rejection.category}`;
      const rejectionMessage =
        "message" in rejection
          ? `${rejection.message} (${sentinel})`
          : `${sentinel}: private process details`;
      let cause: unknown = Object.assign(
        new Error(rejectionMessage),
        "code" in rejection ? { code: rejection.code } : {},
        "name" in rejection ? { name: rejection.name } : {}
      );
      for (let depth = 0; depth < 2; depth += 1) {
        cause = Object.assign(
          new Error(`${sentinel}: wrapped process details`),
          { cause }
        );
      }
      const processRejection = Object.assign(
        new Error(`${sentinel}: root process details`),
        { cause }
      );
      const { result } = makeRetrieval("", { processRejection });

      const failure = await captureFailure(result);
      expect(failure).toMatchObject({
        _tag: "WorkspaceE2EError",
        diagnosticCode: "auth_delivery_message_retrieve_failed",
        message: `query Vercel preview runtime logs failed (${rejection.category})`,
        operation: "query Vercel preview runtime logs",
      });
      expect((failure as { cause?: unknown }).cause).toBeUndefined();
      const failureText = [
        String(failure),
        (failure as { message?: string }).message,
        JSON.stringify(failure),
      ].join(" ");
      expect(failureText).not.toContain(sentinel);
      expect(failureText).not.toContain("private process details");
      expect(failureText).not.toContain("wrapped process details");
      expect(failureText).not.toContain("root process details");
    }
  });

  test("keeps over-depth, array, and string causes in the generic category", async () => {
    const sentinel = "sentinel-untraversed-process-rejection";
    let overDepthCause: unknown = Object.assign(
      new Error(`${sentinel}: structured private details`),
      { code: "ENOENT" }
    );
    for (let depth = 0; depth < 3; depth += 1) {
      overDepthCause = Object.assign(
        new Error(`${sentinel}: wrapped private details`),
        { cause: overDepthCause }
      );
    }
    const rejections = [
      Object.assign(new Error(`${sentinel}: root private details`), {
        cause: overDepthCause,
      }),
      Object.assign(new Error(`${sentinel}: array private details`), {
        cause: [
          Object.assign(new Error("nested private detail"), { code: "ENOENT" }),
        ],
      }),
      Object.assign(new Error(`${sentinel}: string private details`), {
        cause: "nested private detail: ENOENT",
      }),
    ];

    for (const processRejection of rejections) {
      const { result } = makeRetrieval("", { processRejection });
      const failure = await captureFailure(result);

      expect(failure).toMatchObject({
        _tag: "WorkspaceE2EError",
        diagnosticCode: "auth_delivery_message_retrieve_failed",
        message: "query Vercel preview runtime logs failed (process-rejected)",
        operation: "query Vercel preview runtime logs",
      });
      expect((failure as { cause?: unknown }).cause).toBeUndefined();
      const failureText = [
        String(failure),
        (failure as { message?: string }).message,
        JSON.stringify(failure),
      ].join(" ");
      expect(failureText).not.toContain(sentinel);
      expect(failureText).not.toContain("nested private detail");
    }
  });

  test("returns stable composite baseline ids and excludes them across poll iterations", async () => {
    const staleRequest: FakeLogRequest = {
      id: "req-baseline",
      logs: [infoLogEntry("boot"), matchingLogEntry()],
    };
    // A genuinely different link: exclusion bugs cannot be masked by the
    // stale and fresh entries sharing one URL.
    const freshToken = "fresh-token";
    const freshRequest: FakeLogRequest = {
      id: "req-fresh",
      logs: [{ message: previewE2ELine(magicLink(freshToken)) }],
    };

    const invocations: CliInvocation[] = [];
    let call = 0;
    const stdouts = [
      jsonl([staleRequest]),
      jsonl([staleRequest, freshRequest]),
    ];
    const fakeProcess: WorkspaceE2EVercelLogsProcess = async (command) => {
      invocations.push({ args: command.args, env: command.env });
      const stdout = stdouts[Math.min(call, stdouts.length - 1)] ?? "";
      call += 1;
      return { exitCode: 0, stderr: "", stdout };
    };

    const baseline = await Effect.runPromise(
      listSyntheticLogEntryIds(
        { ...config, vercelLogsProcess: fakeProcess },
        {
          callbackPath,
          recipient,
          startedAt: new Date(),
        }
      )
    );
    expect(baseline).toEqual(["req-baseline:1"]);

    call = 0;
    invocations.length = 0;

    const link = await Effect.runPromise(
      retrieveWorkspaceE2EMagicLink(
        { ...config, vercelLogsProcess: fakeProcess },
        {
          callbackPath,
          excludeLogEntryIds: baseline,
          deadlineAfterMs: 200,
          pollIntervalMs: 10,
          recipient,
          startedAt: new Date(),
        }
      )
    );
    expect(invocations.length).toBeGreaterThanOrEqual(2);
    expect(link).toBe(magicLink(freshToken));
  });

  test("rejects links whose host differs from the exact immutable preview", async () => {
    const foreignLink = magicLink("token").replace(
      authOrigin,
      "https://other.vercel.app"
    );
    const stdout = jsonl([
      { id: "req-host", logs: [{ message: previewE2ELine(foreignLink) }] },
    ]);
    const { result } = makeRetrieval(stdout);

    await expect(result).rejects.toThrow("exactly one auth link");
  });

  test("rejects links with a foreign callback target", async () => {
    const foreignCallback = `${authOrigin}/api/auth/magic-link/verify?token=token&callbackURL=${encodeURIComponent("https://evil.example.test/en-US/auth/callback")}`;
    const stdout = jsonl([
      {
        id: "req-callback",
        logs: [{ message: previewE2ELine(foreignCallback) }],
      },
    ]);
    const { result } = makeRetrieval(stdout);

    await expect(result).rejects.toThrow("exactly one auth link");
  });

  test("rejects bodies without a single auth link", async () => {
    const stdout = jsonl([
      { id: "req-nolink", logs: [{ message: previewE2ELine("no link here") }] },
    ]);
    const { result } = makeRetrieval(stdout);

    await expect(result).rejects.toThrow("exactly one auth link");
  });

  test("registers the returned link and token with the process redactor", async () => {
    const { result } = makeRetrieval(
      jsonl([{ id: "req-match", logs: [matchingLogEntry()] }])
    );

    await result;
    expect(redact(`link ${magicLink("token")} end`)).toBe(
      "link [redacted] end"
    );
  });
});
