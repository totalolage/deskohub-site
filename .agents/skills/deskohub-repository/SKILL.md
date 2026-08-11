---
name: deskohub-repository
description: Deskohub monorepo setup, development, build, validation, and architecture.
---

# Deskohub repository

Read only the reference relevant to the change:

- For installation, root commands, environment files, generated assets, checks, and CI boundaries, read [references/development.md](references/development.md).
- For application, package, feature, shared-module, and import boundaries, read [references/architecture.md](references/architecture.md).

Use root Turborepo tasks when their dependency graph matters. Inspect the target package scripts before inventing a command or assuming every application exposes the same task.

Put business rules in the owning application's business specification. Put durable implementation guidance in the narrowest matching repository skill rather than adding technical Markdown beside the code.
