import { mock } from "bun:test";
import { Schema } from "effect";
import type { ModelContextTool } from "./webmcp";

const localeProperty = { type: "string", enum: ["en-US", "cs-CZ"] };

const accessMetaKey = "cz.deskohub.workspace/access";

const publicTool = { [accessMetaKey]: "public" } as const;

/**
 * The tools as `/api/mcp` lists them without a token, trimmed to what tests
 * read: the public read tools first, then a signed-in tool and the booking
 * view's tool, which the site never registers.
 */
export const publishedAgentTools = [
  {
    name: "list_offerings",
    title: "List DH Workspace offerings",
    description: "Lists every product DH Workspace in Prague offers.",
    inputSchema: {
      type: "object",
      properties: { locale: localeProperty },
      additionalProperties: false,
    },
    _meta: publicTool,
  },
  {
    name: "check_availability",
    title: "Check DH Workspace availability",
    description: "Checks whether a DH Workspace product looks free.",
    inputSchema: {
      type: "object",
      properties: {
        family: { type: "string", enum: ["cowork", "meeting-room", "office"] },
        date: { type: "string" },
        locale: localeProperty,
      },
      required: ["family", "date"],
      additionalProperties: false,
    },
    _meta: publicTool,
  },
  {
    name: "get_quote",
    title: "Quote a DH Workspace booking",
    description: "Prices a complete selection anonymously.",
    inputSchema: {
      type: "object",
      properties: {
        family: { type: "string", enum: ["cowork", "meeting-room", "office"] },
        date: { type: "string" },
        tier: { type: "string", enum: ["open-space", "reserved-desk"] },
        coffee: { type: "boolean" },
        locale: localeProperty,
      },
      required: ["family", "date"],
      additionalProperties: false,
    },
    _meta: publicTool,
  },
  {
    name: "start_reservation",
    title: "Start a DH Workspace booking",
    description: "Holds a complete selection for the signed-in customer.",
    inputSchema: {
      type: "object",
      properties: { locale: localeProperty },
      additionalProperties: false,
    },
    _meta: { [accessMetaKey]: "signed-in" },
  },
  {
    name: "show_booking",
    title: "Show the DH Workspace booking view",
    description: "Shows the customer an interactive booking view.",
    inputSchema: {
      type: "object",
      properties: { locale: localeProperty },
      additionalProperties: false,
    },
    _meta: {
      [accessMetaKey]: "public",
      ui: { resourceUri: "ui://dh-workspace/booking-v2.html" },
    },
  },
] as const;

export const publishedQuoteTool = publishedAgentTools[2];

type RegisteredSiteTool = {
  readonly tool: ModelContextTool;
  readonly signal?: AbortSignal;
};

/**
 * Installs a `document.modelContext` that behaves like the WebMCP draft:
 * registering a live name again rejects with `InvalidStateError`, and
 * aborting the registration signal unregisters the tool.
 */
export const installFakeModelContext = () => {
  const registered = new Map<string, RegisteredSiteTool>();
  const registerTool = mock(
    async (
      tool: ModelContextTool,
      options: { readonly signal?: AbortSignal } = {}
    ) => {
      if (options.signal?.aborted) return;
      if (registered.has(tool.name)) {
        throw new DOMException(
          `Duplicate tool ${tool.name}`,
          "InvalidStateError"
        );
      }
      registered.set(tool.name, { tool, signal: options.signal });
      options.signal?.addEventListener("abort", () =>
        registered.delete(tool.name)
      );
    }
  );
  Object.defineProperty(document, "modelContext", {
    configurable: true,
    value: Object.assign(new EventTarget(), { registerTool }),
  });

  return {
    registered,
    registerTool,
    getTool: (name: string) => {
      const entry = registered.get(name);
      if (!entry) throw new Error(`Site tool ${name} is not registered`);
      return entry.tool;
    },
    uninstall: () => {
      Reflect.deleteProperty(document, "modelContext");
    },
  };
};

const agentToolRequestSchema = Schema.Struct({
  method: Schema.String,
  params: Schema.Struct({
    name: Schema.optionalKey(Schema.String),
    arguments: Schema.optionalKey(Schema.Record(Schema.String, Schema.Json)),
  }),
});

type AgentToolRequest = typeof agentToolRequestSchema.Type & {
  readonly signal?: AbortSignal | null;
};

/** An event-stream body the way the endpoint answers the 2025 protocol leg. */
export const agentToolEventStream = (result: Schema.JsonObject) =>
  new Response(
    `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: 1, result })}\n\n`,
    { headers: { "Content-Type": "text/event-stream" } }
  );

/**
 * A response whose headers have arrived and whose body never finishes.
 * `reading` resolves once the client starts reading the body.
 */
export const pendingBodyResponse = () => {
  const { promise: reading, resolve: startReading } =
    Promise.withResolvers<void>();
  const response = new Response(
    new ReadableStream(
      {
        pull: () => {
          startReading();
          return new Promise<void>(() => undefined);
        },
      },
      { highWaterMark: 0 }
    ),
    { headers: { "Content-Type": "text/event-stream" } }
  );
  return { response, reading };
};

/**
 * Replaces `fetch` with a fake `/api/mcp` that lists the published tools, or
 * answers `tools/list` through `list`, and answers `tools/call` through `call`.
 */
export const mockAgentToolEndpoint = (
  call: (request: AgentToolRequest) => Response | Promise<Response> = () =>
    agentToolEventStream({ structuredContent: {} }),
  list: () => Response | Promise<Response> = () =>
    agentToolEventStream({ tools: publishedAgentTools })
) => {
  const requests: AgentToolRequest[] = [];
  const originalFetch = globalThis.fetch;
  const fetchMock = mock(async (...[url, init]: Parameters<typeof fetch>) => {
    if (String(url) !== "/api/mcp") {
      throw new Error(`Unexpected request to ${String(url)}`);
    }
    const body = Schema.decodeUnknownSync(
      Schema.fromJsonString(agentToolRequestSchema)
    )(String(init?.body));
    const request = { ...body, signal: init?.signal };
    requests.push(request);
    return body.method === "tools/list" ? list() : call(request);
  });
  globalThis.fetch = Object.assign(fetchMock, {
    preconnect: originalFetch.preconnect,
  });

  return {
    fetch: fetchMock,
    requests,
    restore: () => {
      globalThis.fetch = originalFetch;
    },
  };
};

/** Collects unhandled rejections until `stop` is called. */
export const recordUnhandledRejections = () => {
  const rejections: Parameters<NodeJS.UnhandledRejectionListener>[0][] = [];
  const record: NodeJS.UnhandledRejectionListener = (reason) => {
    rejections.push(reason);
  };
  process.on("unhandledRejection", record);
  return {
    rejections,
    stop: () => process.off("unhandledRejection", record),
  };
};
