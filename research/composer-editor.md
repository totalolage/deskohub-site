# Email-campaign composer: editor library and document format

Researched 2026-10-14 against `origin/main` at `817f1e9d5`. Version numbers, star counts and issue counts are as of that date. **Fact** marks something a primary source or one of our spikes confirms. **Inference** marks our own judgment.

## Recommendation

**Use TipTap 3 (MIT, headless) with an app-owned set of extensions, and store each localized body as TipTap/ProseMirror JSON.** Render that JSON on the server with `@tiptap/static-renderer`'s `renderToReactElement` and app-owned node mappings to `react-email` components, and pass the resulting React node as `children` to `WorkspaceEmailLayout`. The `dhw` CLI turns Markdown into the same JSON with `@tiptap/markdown`'s `MarkdownManager`, using the same extension list.

**Runner-up: `@react-email/editor`.** It is Resend's MIT editor and is itself built on TipTap 3. It stores the same kind of JSON, so switching later is cheap. It ranks second because of its opinionated UI, its HTML-only composer and its larger default schema (see below).

### Why

- **License and cost (fact).** The TipTap repo is MIT ([LICENSE](https://github.com/ueberdosis/tiptap/blob/main/LICENSE)). StarterKit, Link, Image, lists, Markdown, FileHandler and static-renderer are all published as MIT ([registry: link](https://registry.npmjs.org/@tiptap%2fextension-link/latest), [image](https://registry.npmjs.org/@tiptap%2fextension-image/latest), [markdown](https://registry.npmjs.org/@tiptap%2fmarkdown/latest), [static-renderer](https://registry.npmjs.org/@tiptap%2fstatic-renderer/latest), [file-handler](https://registry.npmjs.org/@tiptap%2fextension-file-handler/latest)). The paid plans (Start $49/mo up to Enterprise) gate collaboration, comments, history and AI, none of which we need ([pricing](https://tiptap.dev/pricing), [Pro extensions](https://tiptap.dev/docs/guides/pro-extensions)).
- **Content set (fact).** StarterKit already includes Heading, Bold, Italic, Link, bullet and ordered lists, and HorizontalRule. Image is a separate MIT extension ([StarterKit](https://tiptap.dev/docs/editor/extensions/functionality/starterkit)). The CTA button is one custom `Node.create` atom, and `ReactNodeViewRenderer` is available if it needs an in-editor view ([React node views](https://tiptap.dev/docs/editor/extensions/custom-extensions/node-views/react)).
- **React 19 and App Router (fact).** `@tiptap/react` 3.32.0 has peer dependencies on React and React DOM `^19.0.0`. The Next.js guide uses a `'use client'` component with `immediatelyRender: false` ([npm](https://registry.npmjs.org/@tiptap%2freact/latest), [Next.js guide](https://tiptap.dev/docs/editor/getting-started/install/nextjs)).
- **Headless UI (fact, then inference).** TipTap ships no UI, and accessibility of the toolbar and its controls is left to the app ([accessibility guide](https://tiptap.dev/docs/guides/accessibility)). *Inference:* that is a good fit, because `deskohub-react-ui` says "Use the matching shadcn primitive for standard interactions" (`.agents/skills/deskohub-react-ui/SKILL.md:15`). We build the toolbar from shadcn/Radix primitives, which handle ARIA and keyboard behaviour.
- **Maintenance (fact).** v3.32.0 was released 2026-10-13. The repo has 936 commits in the past year, 38.7k stars and 750 open issues ([release](https://github.com/ueberdosis/tiptap/releases/tag/v3.32.0), [repo](https://github.com/ueberdosis/tiptap)).
- **The end-to-end path works without a DOM (fact, from our spike).** See [Spike evidence](#spike-evidence).

## Document format

**Fact.** TipTap recommends storing JSON. Each node has a `type` and optionally `attrs`, `content`, `marks` or `text` ([persistence](https://tiptap.dev/docs/editor/core-concepts/persistence)). The v2→v3 upgrade guide lists API and import changes but no rewrite of stored documents ([upgrade guide](https://tiptap.dev/docs/guides/upgrade-tiptap-v2)).

**Spike output** for the Markdown sample (abridged):

```json
{"type":"doc","content":[
  {"type":"heading","attrs":{"level":1},"content":[{"type":"text","text":"Hello"}]},
  {"type":"paragraph","content":[{"type":"text","text":"link","marks":[{"type":"link","attrs":{"href":"https://deskohub.cz","title":null}}]}]},
  {"type":"bulletList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"one"}]}]}]},
  {"type":"image","attrs":{"src":"https://res.cloudinary.com/demo/image/upload/sample.jpg","title":null,"alt":"Alt text"}},
  {"type":"horizontalRule"},
  {"type":"ctaButton","attrs":{"href":"https://example.com/book","label":"Book now"}}
]}
```

**Inference: proposed storage shape.**

- Store one body per campaign locale (`cs-CZ`, `en-US`, the locale ids already used by `WorkspaceEmailLayout`, `apps/deskohub-workspace/emails/_components/workspace-email-layout.tsx:14`), with a `formatVersion` number next to it.
- Keep the TipTap extension list in a single module that has no DOM dependencies. The client editor, the server renderer, the server-side validator and the CLI's Markdown parser all import it. This is what keeps the formats in sync.
- On every write (server action and admin API), validate with `getSchema(extensions).nodeFromJSON(json).check()`. Our spike showed this runs without a DOM, rejects `Unknown node type: table`, and rejects bad nesting (`Invalid content for node bulletList`).
- Add app-level checks that the schema does not cover: link `href` must be `https:` or `mailto:`, image `src` must point to our Cloudinary delivery host, and the CTA needs a non-empty label.
- Per the repo rule on Standard Schema V1 types, expose the stored type as `CampaignBodyDocument`. Do not expose `JSONContent`.

## Rendering approach (doc JSON → React Email)

**Fact.** `@tiptap/static-renderer` 3.32.0 provides `renderToReactElement`, `renderToHTMLString` and `renderToMarkdown`. They render JSON with no Editor, browser or DOM, and `nodeMapping`/`markMapping` can return any React element ([docs](https://tiptap.dev/docs/editor/api/utilities/static-renderer)). The spike used the `@tiptap/static-renderer/pm/react` entry:

```tsx
const body = renderToReactElement({
  content: json,
  extensions,
  options: {
    nodeMapping: {
      heading: ({ node, children }) => <Heading as={`h${node.attrs.level}`}>{children}</Heading>,
      paragraph: ({ children }) => <Text>{children}</Text>,
      image: ({ node }) => <Img src={node.attrs.src} alt={node.attrs.alt ?? ""} />,
      horizontalRule: () => <Hr />,
      ctaButton: ({ node }) => <Button href={node.attrs.href}>{node.attrs.label}</Button>,
      bulletList: ({ children }) => <ul>{children}</ul>,
      orderedList: ({ children }) => <ol>{children}</ol>,
      listItem: ({ children }) => <li>{children}</li>,
    },
    markMapping: { link: ({ mark, children }) => <Link href={mark.attrs.href}>{children}</Link> },
  },
});
```

**Fact (repo).** `WorkspaceEmailLayout` takes `children`, `locale` and `preview` (`workspace-email-layout.tsx:14-20`). `renderWorkspaceEmail` takes a `ReactElement` and returns `{ html, text }` from `react-email`'s `render()` (`apps/deskohub-workspace/shared/backend/email/render-react-email.tsx:11-30`).

**Inference.** The campaign email is therefore `<WorkspaceEmailLayout locale preview={preheader}>{body}</WorkspaceEmailLayout>`, passed to `renderWorkspaceEmail`, so no new rendering pipeline is needed. Paragraphs inside `listItem` need context-aware mapping. The spike rendered them as `<Text>` (a `<p>` with margins) inside `<li>`. Image `src` should go through the existing Cloudinary delivery helpers (`packages/cloudinary/src/delivery.ts:11`, `packages/cloudinary-image/src/url.ts:4`) to get bounded sizes in email.

## Markdown / CLI path

**Fact.** `@tiptap/markdown` is the official MIT package and is marked **Beta**. `MarkdownManager` parses and serializes without an Editor instance ([MarkdownManager](https://tiptap.dev/docs/editor/markdown/api/markdown-manager)). Custom nodes declare `markdownTokenizer`, `parseMarkdown` and `renderMarkdown` ([custom extension guide](https://tiptap.dev/docs/editor/markdown/guides/integrate-markdown-in-your-extension)). The constructor accepts `extensions`, which the API page leaves out (verified with the installed 3.32.0).

**Fact (spike).** Under Bun 1.4.2 with no DOM, the syntax `[[button: Book now](https://example.com/book)]` parsed to a `ctaButton` node and serialized back unchanged. `manager.serialize(json)` produced the original Markdown.

**Fact (repo).** `dhw` (`apps/dhw`) is built on `effect/unstable/cli` and calls the typed Workspace Admin HTTP API, not the database (`apps/dhw/src/command.ts:69`, `apps/dhw/src/api/workspace-admin-api-client.service.ts:400`).

**Inference.** The CLI should send Markdown to an admin API endpoint. The server parses it with the shared extension list, then validates and stores it. This keeps one parser on the server, and the CLI never needs TipTap. An alternative is for the CLI to parse locally and upload JSON, with the same server-side validation either way. The CTA syntax is our own convention, so it must be documented in the CLI help.

## Image uploads

**Fact.** FileHandler exposes paste and drop callbacks and "does not implement server file uploads" ([FileHandler](https://tiptap.dev/docs/editor/extensions/functionality/filehandler)).

**Fact (repo).** `packages/cloudinary` uploads on the server through `CloudinaryService` (`uploader.upload_stream`, `packages/cloudinary/src/service.ts:585`, exported from `packages/cloudinary/src/server.ts:7`). The only existing upload flow is the customer avatar: `AvatarControl` posts `FormData` to a server action (`apps/deskohub-workspace/features/account/components/profile/avatar-control.tsx:177`, `apps/deskohub-workspace/features/account/avatar-actions.ts:196`). There is no admin upload flow yet.

**Inference.** Copy the avatar pattern: an admin-only server action uploads to a campaign folder, and the editor inserts an `image` node with the returned delivery URL. Images uploaded through the CLI would go through an admin API endpoint.

## Candidates compared

| Candidate | License / cost | Server render without DOM | Markdown → doc | Fit notes |
|---|---|---|---|---|
| **TipTap 3.32** | MIT; needed features free | Yes, static-renderer to any React element (spike) | `@tiptap/markdown`, beta, DOM-free (spike) | Headless; we own UI and mapping |
| **@react-email/editor 1.7.12** | MIT | `composeReactEmail` needs an `Editor` (`element: null` works) and returns **HTML/text only**. A layout can be supplied through `SerializerPlugin.BaseTemplate`. Per-node `renderToReactEmail` exists, but no JSON-to-body serializer is exported | None built in; use `@tiptap/markdown` | Styled theme and bubble/slash UI; default schema includes tables, columns, code blocks and blockquotes, which must be disabled; 1.6 MB unpacked |
| **Lexical 0.52** | MIT | JSON and Markdown headless; HTML export needs `withDOM()`; no React Email exporter | `$convertFromMarkdownString` (headless) | Still 0.x; image node is only a Playground example; we would write the renderer by hand |
| **BlockNote 0.55** | Core MPL-2.0; **email exporter `GPL-3.0 OR PROPRIETARY`**, Business plan $195/mo billed yearly | Email exporter returns HTML | `tryParseMarkdownToBlocks` uses jsdom | `@blocknote/react` is 23.6 MB unpacked; block-editor UX |
| **Plate 53.3** | MIT (Plate Plus €299/€799 for premium UI) | `serializeHtml` without DOM; no React Email exporter | `@platejs/markdown` | Slate `Value` has no format version; heavier plugin system for a small content set |
| **Maily 0.3.7** | MIT | Renderer returns a **full-email** HTML string | None documented | Still on **TipTap 2**; last npm publish Feb 2026 |
| **Novel 1.0.2** | Apache-2.0 | No | No | TipTap 2.11; dormant since early 2025 |
| Unlayer / Easy Email / Waypoint | Unlayer paid from $250/mo; Easy Email has no React 19 support; Waypoint peers React ≤18 | Whole-email designs | No | Conflicts with code-defined layouts |

Sources:

- @react-email/editor: [npm](https://registry.npmjs.org/@react-email%2Feditor/1.7.12), [composer source](https://github.com/resend/react-email/blob/4fe0d9353b769d89ae79ce276c54186c8072f11c/packages/editor/src/core/serializer/compose-react-email.tsx#L52-L75), [serializer plugin](https://github.com/resend/react-email/blob/4fe0d9353b769d89ae79ce276c54186c8072f11c/packages/editor/src/core/serializer/serializer-plugin.ts#L3-L14), [extensions](https://github.com/resend/react-email/blob/4fe0d9353b769d89ae79ce276c54186c8072f11c/packages/editor/src/extensions/index.ts#L154-L197), [default theme](https://github.com/resend/react-email/blob/4fe0d9353b769d89ae79ce276c54186c8072f11c/packages/editor/src/ui/themes/default.css#L1-L33), [image upload type](https://github.com/resend/react-email/blob/4fe0d9353b769d89ae79ce276c54186c8072f11c/packages/editor/src/plugins/image/types.ts#L1-L6)
- Lexical: [npm](https://registry.npmjs.org/lexical), [headless](https://lexical.dev/docs/concepts/headless), [serialization](https://lexical.dev/docs/serialization), [markdown](https://lexical.dev/docs/packages/lexical-markdown), [Playground ImageNode](https://github.com/facebook/lexical/blob/main/packages/lexical-playground/src/nodes/ImageNode.tsx)
- BlockNote: [npm](https://registry.npmjs.org/%40blocknote%2Fcore), [ServerBlockNoteEditor](https://github.com/TypeCellOS/BlockNote/blob/v0.55.0/packages/server-util/src/context/ServerBlockNoteEditor.ts), [email exporter](https://github.com/TypeCellOS/BlockNote/blob/v0.55.0/packages/xl-email-exporter/src/react-email/reactEmailExporter.tsx), [pricing](https://www.blocknotejs.org/pricing)
- Plate: [npm](https://registry.npmjs.org/platejs), [Node usage](https://platejs.org/docs/installation/node), [static rendering](https://platejs.org/docs/static), [Plate Plus pricing](https://pro.platejs.org/pricing)
- Maily: [render source](https://github.com/arikchakma/maily.to/blob/main/packages/render/src/maily.tsx), [@maily-to/core](https://www.npmjs.com/package/%40maily-to/core), [license](https://github.com/arikchakma/maily.to/blob/main/license)
- Novel: [release](https://github.com/steven-tey/novel/releases/tag/novel%401.0.2), [npm](https://registry.npmjs.org/novel/latest)
- Unlayer: [pricing](https://unlayer.com/pricing). Easy Email: [repo](https://github.com/zalify/easy-email-editor). Waypoint: [repo](https://github.com/usewaypoint/email-builder-js)
- react-email 6.11.1 moved components into `react-email`; `@react-email/components` is deprecated ([changelog](https://github.com/resend/react-email/blob/main/packages/react-email/CHANGELOG.md))

### Why @react-email/editor is the runner-up, not the pick

Facts are from the sources above. Our reasons, in order:

1. `composeReactEmail` returns HTML/text, while the repo renders a React element through `renderWorkspaceEmail`. Using it means either a second render path or a hand-written walker over its `renderToReactEmail` methods, which is not an exported API.
2. Its default theme and bubble/slash UI would sit beside shadcn.
3. Its default schema is broader than the approved content set, which rules out tables, columns and raw HTML. Every unwanted node would need disabling, and later releases may add more.

What it does better: email-tuned node renderers and a ready-made UI. If building our own toolbar proves expensive, adopt its extensions and keep our renderer. The stored JSON would stay TipTap JSON.

## Bundle size

- TipTap: npm reports 657 kB unpacked for `@tiptap/react` + `starter-kit` + `pm`. Unpacked size overstates the browser cost. Bundlephobia rate-limited us, so we have no min+gzip figure.
- Lexical core: 62.99 kB gzip ([bundlephobia](https://bundlephobia.com/api/size?package=lexical%400.52.0)).
- *Inference:* the editor is admin-only and can be loaded with `next/dynamic`, so its size does not affect the customer-facing pages.

## Risks

- **`@tiptap/markdown` is beta.** Breaking changes would affect only the CLI path. The fallback is parsing with `unified`/mdast (already in the lockfile transitively, `bun.lock:2830`) and building the JSON ourselves.
- **Schema drift.** Renaming or removing a node or attribute breaks stored documents. Keep `formatVersion` and write migrations. Never use TipTap's default node names for app-specific semantics.
- **Validation gaps.** `check()` does not validate URLs. Without the app-level checks above, the API and CLI paths could store `javascript:` links or external images.
- **Email client rendering.** Lists and images inside `<Text>` need care in Outlook. Test with the react-email preview and real clients.
- **Accessibility** is our responsibility, because TipTap is headless.

## Spike evidence

The spikes ran outside the repo and were not committed.

- `/tmp/editor-spike/spike.tsx` (Bun 1.4.2, TipTap 3.32.0, React 19.3.0, react-email 6.11.1, no jsdom or happy-dom):
  - Markdown → JSON produced every required node type plus bold, italic and link marks.
  - `renderToReactElement` → `render()` produced HTML containing the Button `<a href="https://example.com/book">` and `<hr>`, plus plain text.
  - Czech diacritics (`žluťoučký`) survived in both outputs, and Markdown round-tripped.
  - We re-ran it independently: exit 0.
- `/tmp/editor-spike/validate.tsx` confirmed DOM-free schema validation as described above.
- `/tmp/editor-spike-re/` tested `@react-email/editor` 1.7.12:
  - `composeReactEmail` with `new Editor({ element: null })` ran under Bun without a DOM and returned full-document HTML.
  - A custom `BaseTemplate` was used.
  - A manual walker over the per-node `renderToReactEmail` methods also rendered.
