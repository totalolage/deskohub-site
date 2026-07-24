# AGENTS

## Living guidance

Keep this file limited to rules that apply broadly across the repository. Store task-specific workflows and accumulated tips in the matching repository skill under `.agents/skills`, and load the relevant skill before doing that work. When developer feedback corrects durable guidance, update or create the matching skill; add a rule here only when it should apply to nearly every task.

If something in the project is surprising or unclear, alert the developer and name the sticking point before guessing.

## Always-on rules

- Make heavy use of exploration and research subagents to make sure you are taking the correct approach.
- Prefer the optimal domain structure over preserving an existing layout by default. If current placement is awkward, refactor toward the better boundary rather than bending new code around the old shape.
- Do not leave genuinely generic utility functions as one-off helpers in the first file that needs them. Check shared utilities first; reuse or extend an existing helper, or place a new generic helper where future callers can share it.
- Name code for the role or concept callers use, not hidden implementation details. Avoid qualifiers such as `Prisma`, `ZodParsed`, `ServerFetched`, or `SortableResizable` unless they distinguish real alternatives at the boundary.
- Do not replace implementation-detail suffixes such as `Effect` or `Object` with a generic `Program` suffix. Distinguish operations by domain role or behavior. Keep a technology term when it names the operation's subject, as in `runWorkspaceEffect`; remove it only when it leaks an otherwise domain-named operation's implementation.
- Do not rename helpers scoped to test files as part of a production identifier scrub.
- For schema-backed values passed around as types, prefer Standard Schema V1 types over library-specific schema types. Do not expose Zod or Effect Schema details in names or public type shapes unless callers need that specific API.
- Never print or quote secrets, access codes, tokens, or sensitive production payloads. Load `$deskohub-workspace-operations` before production diagnostics.
- Use the root-pinned, Effect-patched TypeScript 7.0.2 compiler for typechecks. Do not use app-local TypeScript 5.x, `tsgo`, or native-preview; a current TypeScript 6.x may exist only for development tooling.
- In this secondary worktree, `main` may already be checked out in the primary repository. After fetching, create the next feature branch directly from `origin/main` instead of trying to switch this worktree to `main`.
