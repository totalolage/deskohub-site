---
name: deskohub-workspace-botid
description: Workspace BotID, checkBotId, verifyHuman, BotProtectionService, protected Server Actions, bot protection in preview or E2E, Vercel automation bypass.
---

# Deskohub Workspace BotID

BotID is a production-only application control. Every Workspace preview sits behind Vercel Deployment Protection instead, so preview and development never initialize BotID, install its rewrites, or call server verification.

## Where it lives

- `apps/deskohub-workspace/shared/bot-protection/bot-protection.policy.js`: the shared enforcement policy, `VERCEL_ENV === "production"`. Client, build, and server code all go through it.
- `instrumentation-client.ts`: `initBotId` with the `protect` path list, gated on `NEXT_PUBLIC_VERCEL_ENV`.
- `next.config.mjs`: `withBotId` rewrites, gated on `VERCEL_ENV`.
- `shared/backend/bot-protection/bot-protection.service.ts`: `BotProtectionService` and its `verifyHuman`, which calls `checkBotId()`.

## Rules

- Gate on `VERCEL_ENV`, never `NODE_ENV`: Vercel preview builds are production-mode Next.js builds. In client code, read Vercel's standard `NEXT_PUBLIC_VERCEL_ENV` through the Workspace typed client env, not `process.env` or a custom public mirror.
- List in `protect` only the page paths that invoke protected Server Actions, plus the Better Auth sign-in routes `/api/auth/sign-in/magic-link` and `/api/auth/sign-in/email-otp`, which the auth guard verifies through the injected `verifyHuman` (code sign-in always, sign-in emails while `login_email_code` is on). Every listed path needs matching server verification; never intercept `/*` on the client.
- The Workspace action boundary provides `BotProtectionService.Default`. Each protected workflow calls `verifyHuman` explicitly, before any mutation side effect, and chooses its `verificationFailurePolicy` (`allow` or `deny`). An unprotected action doesn't verify just because the service is available.
- Preserve existing verification failure policies and error mapping.
- Each `verifyHuman` call names its `callSite` (`BotProtectionCallSite` in `bot-protection-rejection.ts`). A rejection schedules a `bot protection rejection` event with the call site, agent category and name, and `verified_bot`; see the account skill's PostHog identity and privacy reference.
- Authorized preview automation uses the Vercel automation bypass header, cookie, and query flow. Don't add an application-level BotID bypass for E2E.
