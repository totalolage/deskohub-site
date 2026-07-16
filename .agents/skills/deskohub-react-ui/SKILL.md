---
name: deskohub-react-ui
description: Apply Deskohub React and TSX conventions when creating, editing, or refactoring components, conditional rendering, variant mappings, JSX className values, or one-use UI literals.
---

# Deskohub React UI

- For conditional rendering with no else branch, use `{condition && <Component />}` instead of `{condition ? <Component /> : null}`.
- When mapping a small variant union to copy, icons, or similar values, use an inline object lookup instead of ternaries. Keep one-use lookup objects inline.
- Inline a JSX `className` string when it is used only once. Do not hoist it into a local variable.
- Inline simple one-use literals or lookup objects where they are consumed. Do not hoist them to module scope.

Update this skill when developer feedback changes a durable React convention.
