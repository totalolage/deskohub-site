// WebMCP (`document.modelContext`) as specified by the Community Group draft
// at https://webmachinelearning.github.io/webmcp/ (index.bs, 2026-10-15). The
// API is in origin trial, so these types stay in this feature module instead of
// a global lib.dom override. Every member is optional at runtime: callers
// feature-detect before use.

import type { Schema } from "effect";

export type ModelContextToolAnnotations = {
  readonly readOnlyHint?: boolean;
  readonly untrustedContentHint?: boolean;
  readonly consequentialHint?: boolean;
};

export type ModelContextToolExecuteOptions = {
  readonly signal?: AbortSignal;
};

export type ModelContextTool = {
  readonly name: string;
  readonly title?: string;
  readonly description: string;
  /** A JSON Schema; the browser rejects a registration it can't serialize. */
  readonly inputSchema?: Schema.JsonObject;
  /**
   * Receives the agent's JSON input; the result is JSON-serialized for it.
   * Chrome 151 calls it with the input alone, so the options may be missing.
   */
  readonly execute: (
    input: Schema.JsonObject,
    options?: ModelContextToolExecuteOptions
  ) => Promise<unknown>;
  readonly annotations?: ModelContextToolAnnotations;
};

export type ModelContextRegisterToolOptions = {
  /** Aborting the signal unregisters the tool; registration returns no handle. */
  readonly signal?: AbortSignal;
};

export interface ModelContext extends EventTarget {
  registerTool(
    tool: ModelContextTool,
    options?: ModelContextRegisterToolOptions
  ): Promise<void>;
}

export type DocumentWithModelContext = Document & {
  readonly modelContext: ModelContext;
};
