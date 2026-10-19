import type { DocumentWithModelContext, ModelContext } from "./webmcp";

/**
 * The document's WebMCP model context when the browser implements it. This
 * is the only browser branch: never detect a user agent or a browser agent.
 */
export const getModelContext = (): ModelContext | undefined =>
  hasModelContext(document) ? document.modelContext : undefined;

const hasModelContext = (
  candidate: Document
): candidate is DocumentWithModelContext =>
  "modelContext" in candidate &&
  typeof (candidate as Partial<DocumentWithModelContext>).modelContext
    ?.registerTool === "function";
