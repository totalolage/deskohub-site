# Message catalogs

## Inlang projects

| Project | Settings | Catalogs | Import |
| --- | --- | --- | --- |
| Workspace customer | `apps/deskohub-workspace/project.inlang/settings.json` | `features/i18n/messages/<locale>.json` | `m` from `@/features/i18n` |
| Workspace administration | `features/administration/i18n/project.inlang/settings.json` | `features/administration/i18n/messages/<area>/<locale>.json`, one `pathPattern` per area | `m` from `@/features/administration/i18n` |
| Mobile | `apps/deskohub-mobile/project.inlang/settings.json` | `apps/deskohub-mobile/messages/<locale>.json` (every registry locale) | see `deskohub-mobile` |

Workspace paths are relative to `apps/deskohub-workspace`. Both Workspace projects serve every registry locale. The generated Paraglide output (`paraglide/` beside each project's messages) is gitignored and compiled as locale modules.

## Format

- Each catalog is one JSON object of flat root keys, in the same order as `cs-CZ`. Within one locale, keys are unique across all of a project's catalogs. Administration keys start with their area in camelCase.
- A plain message is a string. Placeholders are `{name}`, keep their exact name, and are never translated. A literal brace is escaped with a backslash, written `\\{` and `\\}` inside the JSON string; Paraglide renders `"Use \\{name\\}"` as `Use {name}`.
- A message with variants is a one-element array holding `declarations`, `selectors`, and `match`. Translations keep the declarations and selectors exactly as in `cs-CZ`.

### Plurals

```json
"reservationMeetingRoomDurationHours": [
  {
    "declarations": ["input count", "local countPlural = count: plural"],
    "selectors": ["countPlural"],
    "match": {
      "countPlural=one": "{count} hodina",
      "countPlural=few": "{count} hodiny",
      "countPlural=other": "{count} hodin"
    }
  }
]
```

Each locale's catalog carries its own CLDR cardinal plural categories, not the Czech ones (a few English administration messages also select on ordinal categories such as `two`):

| Locale | Match keys |
| --- | --- |
| `cs-CZ` | `one`, `few`, `other` |
| `sk-SK` | `one`, `few`, `many`, `other` (`many` is for fractional counts) |
| `uk-UA` | `one`, `few`, `many`, `other` (`other` is for fractional counts) |
| `de-DE`, `en-US` | `one`, `other` |
| `hi-IN` | `one` (0 and 1), `other` |
| `vi-VN` | `other` only |

A catch-all `*` key (`countPlural=*`) appears where the source uses one; keep it. Group a count's digits with Inlang's `number` function (`local formattedCount = count: number`) rather than formatting in code. No test checks plural categories: the parity check in [translation-workflow.md](translation-workflow.md#parity-check) does.

### Selects

A select is a selector on an input with fixed values, such as `"side=before"` and `"side=*"` in the administration `email-automation-flow` catalog. Translations keep the Czech match keys verbatim, translating only the values. A message that combines a select with a plural (`"side=before, countPlural=one"`) needs one key for every combination of the select values and the locale's plural categories.

## Compiling

Compile after every catalog edit:

- From the repository root, `bun turbo i18n:compile --filter=deskohub-workspace` compiles both Workspace projects (the app's `i18n:compile` task depends on `i18n:compile:administration`).
- Inside `apps/deskohub-workspace`, `bun run i18n:compile` compiles the customer project and `bun run i18n:compile:administration` the administration one.
- Mobile compiles with `bun run i18n:compile` in `apps/deskohub-mobile`.

`bun dev` in the Workspace watches both catalog folders and recompiles. Nothing else does: `bun test` and `typecheck` read whatever generated output is on disk. A stale runtime makes message tests and copy assertions pass or fail against old copy, and a missing one fails module resolution. `build:compile`, `lint:knip`, and `test:e2e` depend on the Turbo compile task.

## Message tests

- `features/i18n/message-modules.test.ts` and `features/administration/i18n/administration-message-modules.test.ts`: the generated output has one module per locale, and one sample message renders in every locale (falling back to the base).
- `features/i18n/inlang-project.test.ts` and its administration twin: the settings match the registry ([architecture](architecture.md#drift-tests)).
- `features/administration/i18n/administration-message-leaks.test.ts` (unit) and `administration-messages.build.test.ts` (production build output): administration copy stays out of customer chunks. See [administration localization](../../deskohub-workspace-administration/references/localization.md#build-output-check).

None of them checks key parity, order, placeholders, plural categories, or select keys across catalogs, so a translation needs the parity check. Run these tests inside `apps/deskohub-workspace` with `bun run test ./<path>...`, which adds the Workspace preload. Keep the `./`: a bare name is a substring filter, so `vercel.test.ts` also runs `e2e/integrations/vercel.test.ts`.
