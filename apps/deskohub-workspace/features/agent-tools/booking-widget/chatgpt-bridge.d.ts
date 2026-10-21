// ChatGPT's own widget bridge, which it injects beside MCP Apps. The booking
// view uses it only to open a link when the host doesn't declare
// `openLinks`; see https://developers.openai.com/plugins/reference.

export {};

declare global {
  interface Window {
    readonly openai?: {
      /** Opens a link in the customer's browser; `redirectUrl: false` keeps it as is. */
      readonly openExternal: (options: {
        readonly href: string;
        readonly redirectUrl?: false;
      }) => Promise<void> | void;
    };
  }
}
