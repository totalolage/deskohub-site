import {
  AppBridge,
  PostMessageTransport,
} from "@modelcontextprotocol/ext-apps/app-bridge";
import type { CallToolResult } from "@modelcontextprotocol/client";
import type { Schema } from "effect";

/** What the test hands the host page before this script runs. */
type BookingHarness = {
  /** The built view, as `resources/read` serves it. */
  readonly html: string;
  readonly hostLocale: string;
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
  }
}

// A minimal MCP Apps host: the view runs in a sandboxed frame without the
// page's origin, as hosts run it, and talks to the host over postMessage.
const { html, hostLocale, opensLinks, toolArguments, toolResult } =
  window.bookingHarness;
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
    { hostContext: { locale: hostLocale } }
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
  void bridge.connect(new PostMessageTransport(view, view));
  frame.srcdoc = html;
}
