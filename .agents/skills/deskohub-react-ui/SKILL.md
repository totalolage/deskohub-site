---
name: deskohub-react-ui
description: React, TSX, JSX, component, and UI convention handling.
---

# Deskohub React UI

- For conditional rendering with no else branch, use `{condition && <Component />}` instead of `{condition ? <Component /> : null}`.
- When mapping a small variant union to copy, icons, or similar values, use an inline object lookup instead of ternaries. Keep one-use lookup objects inline.
- Inline a JSX `className` string when it is used only once. Do not hoist it into a local variable.
- Inline simple one-use literals or lookup objects where they are consumed. Do not hoist them to module scope.
- Build administration list counts and associated search or filter controls with the shared administration table toolbar instead of page-local wrappers. Keep the compact count badge vertically centered with the primary controls.
- Use the matching shadcn primitive for standard interactions. In particular, use Tooltip for hover and focus hints instead of building controlled Popover timers or pointer-state machinery. If the primitive is missing, add it through the app's existing `components.json` configuration and adapt only its shared styling and React conventions.
- Keep reservation-family-neutral form shells and interaction primitives, including date and date-time pickers, in `features/reservation/components`. Keep only family-specific selection fields and policy UI under `features/cowork` or `features/meeting-room`.
- Treat screenshots as part of delivering UI work: every pull request that introduces a visible UI state must attach a screenshot of each newly introduced state from the exact committed implementation. Follow the screenshot upload workflow in the Deskohub PR review skill; never use Cloudinary for PR screenshots. Commit an image only when it is durable documentation or a test fixture. Use tests, not empty screenshots, for hidden preconditions or terminal states that deliberately render nothing.
- Model recurring time-driven client state with the existing Effect Atom and Stream pattern instead of manual `useEffect` interval state.
- Use `@doist/react-interpolate` when a localized sentence contains links or other React components. Keep the complete sentence in one translation so each locale controls word order and punctuation.
- Pass dates into localized messages after locale-aware formatting. Do not hardcode localized calendar dates in message strings.

Update this skill when developer feedback changes a durable React convention.
