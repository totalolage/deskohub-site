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
- Read Vercel's standard `NEXT_PUBLIC_VERCEL_ENV` in client instrumentation and
  `VERCEL_ENV` in build/server code. Do not create a custom public mirror of the
  Vercel environment. Expose the public value through the Workspace typed `env`
  module rather than reading `process.env` directly in client code.
- Keep server-side `checkBotId()` before mutation side effects in production.
- Let the Workspace action boundary provide `BotProtectionService.Live`, but keep
  each protected workflow's `verifyHuman` call explicit so it owns placement and
  the `allow` or `deny` verification-failure policy. An unprotected action must
  not verify merely because the capability is available.
- Do not use blanket `/*` client interception without matching server verification.
- Preserve production verification failure policies and error mapping.

Every Workspace preview is protected by Vercel Deployment Protection. BotID is
a separate, production-only application concern: do not initialize it, install
its rewrites, or call its server verification in preview or development. Keep
the Vercel automation bypass header/cookie/query flow for authorized preview
automation; do not introduce an application-level BotID E2E bypass.

Update this skill when developer feedback changes either protection boundary.
