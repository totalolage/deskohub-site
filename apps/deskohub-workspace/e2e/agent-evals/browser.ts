import { join } from "node:path";
import { NodeServices } from "@effect/platform-node";
import {
  type BrowserContext,
  chromium,
  type LaunchOptions,
} from "@playwright/test";
import { Effect, FileSystem } from "effect";
import type { Locale } from "@/features/i18n";
import {
  toWorkspaceE2EError,
  tryWorkspaceE2EPromise,
  type WorkspaceE2EError,
} from "../errors";
import { pollUntil } from "../polling";
import { workspaceE2EPollIntervalMs, workspaceE2ETimeouts } from "../timeouts";

/**
 * A Chromium the harness attaches to over the DevTools protocol. It is a
 * persistent context, so the cookies the run sets live in the browser's
 * default context, which is the one CDP clients see first.
 */
export type AgentEvalBrowser = {
  readonly cdpEndpoint: string;
  readonly context: BrowserContext;
  /** Closes the browser and removes its profile directory. */
  readonly close: Effect.Effect<void>;
};

/** Chromium writes the port it picked to this file once DevTools listens. */
const readDevToolsPort = (
  fileSystem: FileSystem.FileSystem,
  userDataDir: string
): Effect.Effect<string, WorkspaceE2EError> =>
  pollUntil(
    fileSystem.readFileString(join(userDataDir, "DevToolsActivePort")).pipe(
      Effect.map((contents) => {
        const [port] = contents.split("\n");
        return port && /^\d+$/.test(port) ? port : undefined;
      }),
      Effect.catchIf(
        (cause) => cause.reason._tag === "NotFound",
        () => Effect.succeed(undefined)
      ),
      Effect.mapError((cause) =>
        toWorkspaceE2EError("read the Chromium DevTools port", cause)
      )
    ),
    {
      intervalMs: workspaceE2EPollIntervalMs.browser,
      label: "the Chromium DevTools port",
      timeoutMs: workspaceE2ETimeouts.browserAction,
    }
  );

/**
 * Launches the run's own Chromium with a loopback DevTools port. Agent evals
 * launch their browser instead of using Playwright's worker browser because
 * the harness must attach to it from another process.
 */
export const launchAgentEvalBrowser = Effect.fn("launchAgentEvalBrowser")(
  function* ({
    headless,
    launchOptions,
    locale,
  }: {
    readonly headless: boolean;
    readonly launchOptions: LaunchOptions;
    readonly locale: Locale;
  }) {
    const fileSystem = yield* FileSystem.FileSystem;
    const userDataDir = yield* fileSystem
      .makeTempDirectory({ prefix: "workspace-agent-eval-" })
      .pipe(
        Effect.mapError((cause) =>
          toWorkspaceE2EError("create the agent eval browser profile", cause)
        )
      );
    const removeUserDataDir = fileSystem
      .remove(userDataDir, { force: true, recursive: true })
      .pipe(Effect.ignore);
    const context = yield* tryWorkspaceE2EPromise(
      "launch the agent eval browser",
      () =>
        chromium.launchPersistentContext(userDataDir, {
          ...launchOptions,
          // Chromium binds the DevTools port to loopback and picks a free one.
          args: [...(launchOptions.args ?? []), "--remote-debugging-port=0"],
          headless,
          locale,
          viewport: { height: 900, width: 1440 },
        })
    ).pipe(Effect.onError(() => removeUserDataDir));
    const close = Effect.promise(() => context.close()).pipe(
      Effect.ensuring(removeUserDataDir)
    );
    const port = yield* readDevToolsPort(fileSystem, userDataDir).pipe(
      Effect.onError(() => close)
    );
    return {
      cdpEndpoint: `http://127.0.0.1:${port}`,
      close,
      context,
    } satisfies AgentEvalBrowser;
  },
  Effect.provide(NodeServices.layer)
);
