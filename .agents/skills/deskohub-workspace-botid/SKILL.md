---
name: deskohub-workspace-botid
description: Configure, debug, or review Deskohub Workspace BotID protection, protected Server Actions, withBotId rewrites, checkBotId verification, client path registration, or the controlled browser-E2E bypass.
---

# Deskohub Workspace BotID

Configure BotID end to end:

- Register only the page paths that invoke protected Server Actions.
- Initialize the BotID client, apply `withBotId` rewrites, and call server-side
  `checkBotId()` only when `VERCEL_ENV === "production"`.
- Use the shared production-enforcement policy across client, build, and server
  contexts. Vercel preview builds use production-mode Next.js builds, so never
  substitute `NODE_ENV` for `VERCEL_ENV`.
- Keep server-side `checkBotId()` before mutation side effects in production.
- Do not use blanket `/*` client interception without matching server verification.
- Preserve production verification failure policies and error mapping.

Every Workspace preview is protected by Vercel Deployment Protection. BotID is
a separate, production-only application concern: do not initialize it, install
its rewrites, or call its server verification in preview or development. Keep
the Vercel automation bypass header/cookie/query flow for authorized preview
automation; do not introduce an application-level BotID E2E bypass.

Update this skill when developer feedback changes either protection boundary.
