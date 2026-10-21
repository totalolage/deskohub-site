# Agent booking view (MCP Apps)

The customer MCP server (`app/api/mcp/route.ts`) serves an MCP Apps view, `ui://dh-workspace/booking-v1.html`, that hosts such as ChatGPT, Claude, and VS Code render beside the conversation. `show_booking` is the only tool linked to it. Paths below are relative to `apps/deskohub-workspace/features/agent-tools/`.

## Tool metadata and resources

- `agent-tool-mcp-handler.ts` publishes every tool's access in `_meta["cz.deskohub.workspace/access"]` (`agent-tool-metadata.ts`). `tools/list` answers every client with the public and the signed-in tools alike, so a client without a token selects by this key. WebMCP registers only tools that are `public` and link no view (`isSiteTool` in `webmcp/agent-tool-mcp-client.ts`). Keep the selection on published metadata, not on a list of names.
- A tool links a view by setting `view` in `defineAgentTool`. The handler registers each distinct view as a resource, with `_meta.ui` on both the registration and the `resources/read` content, and links the tool under `ui.resourceUri`, the flat `ui/resourceUri`, and `openai/outputTemplate` (`agent-tool-view.ts`). The server is stateless and can't see 2025-era client capabilities, so it always registers and links. Every result therefore stays complete as `structuredContent` and as JSON text.
- The view declares no connect or resource domains, and only the site origin as ChatGPT's `redirect_domains`. `ui.domain` and `openai/widgetDomain` stay unset, because Claude and ChatGPT expect conflicting formats. A breaking change to the document publishes a new versioned URI.

## Booking mode

The handler gives each call `CallableAgentTools`: the published tools its caller may call, meaning the public tools plus the signed-in tools its token's scopes grant (`isAgentToolGranted`). `show_booking` answers `booking_mode: "reserve"` only when that set holds `start_reservation`. The set holds it when the token grants `reservations:create` and the deployment's exposure is `transactional`. Otherwise the mode is `reservation_page`. The mode travels in `structuredContent`, so the model reads the same fact the view does.

The view sends `start_reservation` only the quoted selection and `locale`, never `marketing_consent`. When the call fails, the view shows its own message for the error code and the prefilled reservation-page link from `get_quote`.

## View code (`booking-widget/`)

- `booking-draft.ts` holds the pure state: locale choice, prefill, validation into tool arguments, and the required Reserved Desk workstation. `booking-form.tsx` renders it. `booking-host.ts` is the `BookingHost` service over ext-apps `App`, and `booking-atoms.ts` runs its Effects through an Effect Atom runtime. The view has no `Effect.run*` and no `@deskohub/next-effect`, which would bundle `next/navigation`.
- Every tool call goes through the host's `tools/call` (`app.callServerTool`). `/api/mcp` rejects the sandbox's foreign origin. Results decode with the tools' own `*.schema.ts` result schemas plus `agentToolErrorResultSchema`. Keep those schema modules browser-safe: no server imports.
- Tool `note` fields and error `message`s are written for the agent. The view renders only its own catalog copy, in the site's informal Czech ("ty"): facts such as prices, the discount, and the expiry come from the results, and errors are worded from their `code`.
- Locale order: the agent's `locale` argument, then `hostContext.locale` (any `cs*` gives `cs-CZ`), then `en-US`. A view whose locale differs from the result's lists the offerings again in its own locale. Copy comes from the customer Inlang catalogs, called with `{ locale }`.
- Hosts sandbox the view without `allow-forms`: the browser blocks a form submission before its submit event fires, so actions are `type="button"` clicks.
- Links: with `openLinks`, `app.openLink`; otherwise ChatGPT's `window.openai.openExternal`; otherwise the browser follows the plain anchor. The address always stays visible as text.

## Build

`booking-widget:build` (`build-booking-widget.ts`) runs `Bun.build` with `compile: true` on `index.html`. The output is one self-contained document in the gitignored `booking-widget/generated/`, with Tailwind applied by a CSS `onLoad` plugin over the shared `shared/styles/brand-theme.css`, and React's production build. `show-booking.tool.ts` imports it with `with { type: "text" }` (typed in `types/booking-widget-html.d.ts`). `build:compile`, `dev`, `test`, and `lint:knip` depend on the task; `typecheck` doesn't need the file. `dev:booking-widget` rebuilds on change. The document is about 710 KB (about 205 KB gzip). Of the gzip size, react-dom takes about 66 KB; the MCP client protocol and zod that ext-apps brings about 65 KB, as module-level schema calls no bundler can drop; Effect Schema decoding about 30 KB and Effect Atom about 10 KB; tailwind-merge (through the shared primitives' `cn`) about 9 KB; the CSS about 6 KB. Measure with `Bun.build({ metafile: true })` on `booking-widget.tsx`.

## Tests

- `booking-draft.test.ts` and `booking-form.test.tsx` (happy-dom) cover the state and the rendered results. `show-booking.tool.test.ts` covers the mode. The route tests cover the resources, the metadata, and both modes with real tokens. `agent-tool-mcp-handler.test.ts` covers `CallableAgentTools`, including a read-only deployment.
- `booking-widget.browser-acceptance.test.ts` builds the real document and renders it in a `sandbox="allow-scripts"` iframe. The host is an ext-apps `AppBridge` with a null client, in `booking-widget.browser-harness.ts`, and its `oncalltool` and `onopenlink` are stubbed through Playwright `exposeFunction`. Set `BOOKING_WIDGET_SCREENSHOT_DIRECTORY` to save a screenshot of each state for PR evidence.
- `e2e/cases/agent-booking.ts` checks the signed-in agent's `reserve` mode and reads the linked view.
