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
- `shared/bot-protection/customer-agents.ts`: `customerAgentNames`, the Vercel verified-bot names of agents acting for a customer.

## Rules

- Gate on `VERCEL_ENV`, never `NODE_ENV`: Vercel preview builds are production-mode Next.js builds. In client code, read Vercel's standard `NEXT_PUBLIC_VERCEL_ENV` through the Workspace typed client env, not `process.env` or a custom public mirror.
- List in `protect` only the page paths that invoke protected Server Actions, plus the Better Auth sign-in routes `/api/auth/sign-in/magic-link`, `/api/auth/sign-in/email-otp`, and the review-login password route `/api/auth/sign-in/email`, which the auth guard verifies through the injected `verifyHuman` on every request. The per-email sign-in code limit is separate and applies only while `login_email_code` is on. Every listed path needs matching server verification; never intercept `/*` on the client.
- The Workspace action boundary provides `BotProtectionService.Default`. Each protected workflow calls `verifyHuman` explicitly, before any mutation side effect, and chooses its `verificationFailurePolicy` (`allow` or `deny`) and its `verifiedBots` policy (`{ allow: customerAgentNames }` or `"deny"`). Record the reason for the `verifiedBots` choice in a comment at the call site. An unprotected action doesn't verify just because the service is available.
- BotID screens browsers only. When an operation also serves a non-browser channel, such as the customer MCP server's `start_reservation`, the browser Server Action verifies before calling it and the shared operation never requires `BotProtectionService`; the reservation form does this in `features/reservation/actions/prepare-pay-state-form.ts`. The MCP channel relies on OAuth, the per-IP firewall rule, and its per-grant and per-account `RequestBudget` limits.
- Unverified bots are always rejected. A verified bot passes only when its `verifiedBotName` is in the call site's allow list, and the service logs that name. A signature identifies the agent's vendor, not the customer, so allowed call sites keep their own sign-in, payment, and limits. Add an agent to `customerAgentNames` only with a comment that links the vendor's signing doc.
- `BotDetectedError.reason` says why a request was rejected (`unverified_bot` or `verified_bot_not_allowed`). Show customers `m.automatedRequestRejected` (account surfaces: `m.accountSignInAutomatedRequest`), which tells them to continue in their own browser. Never show rate-limit copy for a bot rejection.
- Preserve existing verification failure policies and error mapping.
- Each `verifyHuman` call names its `callSite` (`BotProtectionCallSite` in `bot-protection-rejection.ts`). A rejection schedules a `bot protection rejection` event with the call site, agent category and name, and `verified_bot`; a verified bot the call site allows isn't counted. `classifyVerifiedBot` classifies a rejected verified bot from its BotID name and category, and names each `customerAgentNames` entry through `customerAgentOperators`, so a new customer agent needs an allow-listed agent name there. See the account skill's PostHog identity and privacy reference.
- Authorized preview automation uses the Vercel automation bypass header, cookie, and query flow. Don't add an application-level BotID bypass for E2E.
