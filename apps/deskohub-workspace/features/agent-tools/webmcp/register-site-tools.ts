import { Effect, type Schema, Semaphore } from "effect";
import { type Locale, m } from "@/features/i18n";
import {
  runWorkspaceBrowserEffect,
  runWorkspaceBrowserEffectUntilAbort,
} from "@/shared/browser/workspace-browser-effect";
import { reportWorkspaceBrowserFailure } from "@/shared/browser/workspace-browser-logs";
import {
  type AgentToolRequestError,
  callAgentTool,
  isSiteTool,
  listAgentTools,
  type PublishedAgentTool,
} from "./agent-tool-mcp-client";
import { publishQuoteTool, quoteToolName } from "./site-tool-catalog";
import type { ModelContext, ModelContextTool } from "./webmcp";

const registrationLocks = new Map<string, Semaphore.Semaphore>();

const getRegistrationLock = (name: string) => {
  const existing = registrationLocks.get(name);
  if (existing) return existing;
  const lock = Semaphore.makeUnsafe(1);
  registrationLocks.set(name, lock);
  return lock;
};

/**
 * Registers a tool until `signal` aborts. Registrations of one name run one at
 * a time, so a remount, such as React Strict Mode's, registers only after the
 * previous registration settled and its signal aborted; a duplicate name
 * would reject with `InvalidStateError`. A rejected registration is reported,
 * never thrown.
 */
export const registerSiteTool = (
  modelContext: ModelContext,
  tool: ModelContextTool,
  signal: AbortSignal
) =>
  Effect.suspend(() =>
    signal.aborted
      ? Effect.void
      : Effect.tryPromise(() => modelContext.registerTool(tool, { signal }))
  ).pipe(
    getRegistrationLock(tool.name).withPermits(1),
    Effect.catch((cause) =>
      reportWorkspaceBrowserFailure(
        "agent-tools.site-tool.register-failed",
        cause
      ).pipe(Effect.annotateLogs({ tool: tool.name }))
    )
  );

/**
 * Lists the agent tools on `/api/mcp` once and registers each public read
 * tool as a site tool until `signal` aborts. The quote tool is published for
 * page tools that build on its input.
 */
export const registerReadSiteTools = ({
  locale,
  modelContext,
  signal,
}: {
  readonly locale: Locale;
  readonly modelContext: ModelContext;
  readonly signal: AbortSignal;
}) =>
  listAgentTools.pipe(
    Effect.map((tools) => tools.filter(isSiteTool)),
    Effect.tap((tools) =>
      Effect.forEach(
        tools,
        (tool) =>
          registerSiteTool(modelContext, toReadSiteTool(tool, locale), signal),
        { concurrency: "unbounded", discard: true }
      )
    ),
    Effect.tap((tools) =>
      Effect.sync(() =>
        publishQuoteTool(tools.find((tool) => tool.name === quoteToolName))
      )
    ),
    Effect.tapError((cause) =>
      reportWorkspaceBrowserFailure("agent-tools.site-tools.list-failed", cause)
    ),
    Effect.ignore,
    runWorkspaceBrowserEffectUntilAbort(
      "agent-tools.site-tools.register",
      signal
    )
  );

const toReadSiteTool = (
  tool: PublishedAgentTool,
  locale: Locale
): ModelContextTool => ({
  name: tool.name,
  title: getSiteToolTitle(tool, locale),
  description: tool.description,
  inputSchema: tool.inputSchema,
  annotations: { readOnlyHint: true },
  execute: (input, options) =>
    callAgentTool(tool.name, withPageLocale(tool, input, locale)).pipe(
      Effect.map(({ structuredContent }) => structuredContent),
      runSiteToolCall(
        `agent-tools.site-tool.${tool.name}`,
        locale,
        options?.signal
      )
    ),
});

/**
 * Runs a tool call for the agent: a tool's typed error is part of the result,
 * while a request failure rejects with a localized `Error`.
 */
export const runSiteToolCall =
  (operation: string, locale: Locale, signal: AbortSignal | undefined) =>
  <A>(call: Effect.Effect<A, AgentToolRequestError>) =>
    call.pipe(
      Effect.mapError(
        (cause) => new Error(m.siteToolRequestFailed({}, { locale }), { cause })
      ),
      runWorkspaceBrowserEffect(operation, { signal })
    );

/**
 * The tool's input with the page locale for an omitted `locale`, so results
 * and messages match the page the customer reads.
 */
export const withPageLocale = (
  tool: PublishedAgentTool,
  input: Schema.JsonObject,
  locale: Locale
): Schema.JsonObject =>
  tool.inputSchema.properties?.locale !== undefined &&
  input.locale === undefined
    ? { ...input, locale }
    : input;

// The browser shows the title, so it follows the page locale; a tool added on
// the server later keeps its published English title until it has copy here.
const getSiteToolTitle = (tool: PublishedAgentTool, locale: Locale) => {
  switch (tool.name) {
    case "list_offerings":
      return m.siteToolListOfferingsTitle({}, { locale });
    case "check_availability":
      return m.siteToolCheckAvailabilityTitle({}, { locale });
    case quoteToolName:
      return m.siteToolGetQuoteTitle({}, { locale });
    default:
      return tool.title;
  }
};
