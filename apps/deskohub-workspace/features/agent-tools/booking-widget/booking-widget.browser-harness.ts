import type { CallToolResult } from "@modelcontextprotocol/client";
import {
  AppBridge,
  type McpUiHostContext,
  type McpUiStyles,
  type McpUiTheme,
  PostMessageTransport,
} from "@modelcontextprotocol/ext-apps/app-bridge";
import type { Schema } from "effect";

/** The host context fields the view reads. */
type BookingHostSettings = {
  readonly locale?: string;
  readonly theme?: McpUiTheme;
  /** Hosts send only the style variables they define. */
  readonly styleVariables?: Partial<McpUiStyles>;
};

/** What the test hands the host page before this script runs. */
type BookingHarness = {
  /** The built view, as `resources/read` serves it. */
  readonly html: string;
  readonly host: BookingHostSettings;
  /** Whether the host declares `openLinks`. */
  readonly opensLinks: boolean;
  readonly toolArguments: Schema.JsonObject;
  readonly toolResult: CallToolResult;
};

declare global {
  interface Window {
    readonly bookingHarness: BookingHarness;
    /** Answers the view's `tools/call`; the test exposes it. */
    readonly callBookingTool: (
      name: string,
      args: Schema.JsonObject
    ) => Promise<CallToolResult>;
    /** Records the view's `ui/open-link`; the test exposes it. */
    readonly openBookingLink: (url: string) => Promise<void>;
    /** Records the view's `window.openai.openExternal`; the test exposes it. */
    readonly openBookingExternal: NonNullable<Window["openai"]>["openExternal"];
    /** Changes the host context, as a host does when its theme changes. */
    readonly changeBookingHost: (changes: BookingHostSettings) => void;
  }
}

// A minimal MCP Apps host: the view runs in a sandboxed frame without the
// page's origin, as hosts run it, and talks to the host over postMessage.
const { html, host, opensLinks, toolArguments, toolResult } =
  window.bookingHarness;

// The spec's type lists every style variable, though hosts send a subset.
const toHostContext = ({
  styleVariables,
  ...context
}: BookingHostSettings): McpUiHostContext => ({
  ...context,
  ...(styleVariables && {
    styles: { variables: styleVariables as McpUiStyles },
  }),
});
const frame = document.createElement("iframe");
frame.setAttribute("sandbox", "allow-scripts");
frame.title = "Booking view";
frame.style.cssText = "width: 100%; height: 400px; border: 0; display: block";
document.body.append(frame);

const view = frame.contentWindow;
if (view) {
  const bridge = new AppBridge(
    null,
    { name: "booking-harness", version: "1.0.0" },
    { serverTools: {}, ...(opensLinks && { openLinks: {} }) },
    { hostContext: toHostContext(host) }
  );
  bridge.oncalltool = ({ name, arguments: args = {} }) =>
    window.callBookingTool(name, args as Schema.JsonObject);
  bridge.onopenlink = async ({ url }) => {
    await window.openBookingLink(url);
    return {};
  };
  bridge.onsizechange = ({ height }) => {
    if (height !== undefined) frame.style.height = `${height}px`;
  };
  bridge.oninitialized = () => {
    void bridge
      .sendToolInput({ arguments: toolArguments })
      .then(() => bridge.sendToolResult(toolResult));
  };
  let settings = host;
  Object.assign(window, {
    changeBookingHost: (changes: BookingHostSettings) => {
      settings = { ...settings, ...changes };
      bridge.setHostContext(toHostContext(settings));
    },
  });
  void bridge.connect(new PostMessageTransport(view, view));
  frame.srcdoc = html;
}
