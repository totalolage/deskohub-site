import { useSyncExternalStore } from "react";
import type { PublishedAgentTool } from "./agent-tool-mcp-client";

// The quote tool as the registrar last listed it. Page tools build on its
// published input, and exist only while the registrar's tools do.
let quoteTool: PublishedAgentTool | undefined;
const listeners = new Set<() => void>();

export const quoteToolName = "get_quote";

export const publishQuoteTool = (tool: PublishedAgentTool | undefined) => {
  quoteTool = tool;
  for (const listener of [...listeners]) listener();
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/**
 * The published quote tool while the site tools are registered in this
 * document, or `undefined` before then, without the API, or with the release
 * gate off.
 */
export const useQuoteTool = () =>
  useSyncExternalStore(
    subscribe,
    () => quoteTool,
    () => undefined
  );
