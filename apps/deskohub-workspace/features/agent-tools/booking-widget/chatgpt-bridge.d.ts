// ChatGPT's own widget bridge, which it injects beside MCP Apps. The booking
// view uses it to open a link when the host doesn't declare `openLinks`, and
// for the theme and language when the host context lacks them. It announces
// changes to them with an `openai:set_globals` window event; see
// https://developers.openai.com/plugins/reference.

export {};

declare global {
  interface Window {
    readonly openai?: {
      readonly theme?: "light" | "dark";
      /** The customer's language, a BCP 47 tag. */
      readonly locale?: string;
      /** Opens a link in the customer's browser; `redirectUrl: false` keeps it as is. */
      readonly openExternal: (options: {
        readonly href: string;
        readonly redirectUrl?: false;
      }) => Promise<void> | void;
    };
  }
}
