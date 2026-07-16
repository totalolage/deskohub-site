---
name: deskohub-workspace-botid
description: Configure, debug, or review Deskohub Workspace BotID protection, protected Server Actions, withBotId rewrites, checkBotId verification, client path registration, or the controlled browser-E2E bypass.
---

# Deskohub Workspace BotID

Configure BotID end to end:

- Register only the page paths that invoke protected Server Actions.
- Keep the `withBotId` rewrites.
- Call server-side `checkBotId()` before mutation side effects.
- Do not use blanket `/*` client interception without matching server verification.
- Do not remove BotID as the final security posture when fixing its transport integration.

Treat Workspace browser E2E as automation that BotID correctly rejects. Set `WORKSPACE_E2E_BOTID_BYPASS=HUMAN` only on the dedicated E2E deployment, and honor it only outside Vercel production. Never configure this marker on a normal preview or production deployment.

Update this skill when developer feedback changes the protection boundary or the explicit E2E exception.
