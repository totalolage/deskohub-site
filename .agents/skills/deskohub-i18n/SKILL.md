---
name: deskohub-i18n
description: Locale registry, supported locales, adding a locale or language, translating or reviewing message catalogs, catalog parity, plural categories, select messages, Inlang settings, i18n:compile, stale Paraglide output, translation glossary, translation style guide, register (du, ty, ви, bạn, आप), de-DE, uk-UA, sk-SK, vi-VN, hi-IN, Devanagari.
---

# Deskohub i18n

`packages/i18n/src/locale-registry.ts` is the single source of truth for the locales Deskohub serves. Code reads its locale list from there, and drift tests hold the Inlang projects, `vercel.json`, the database, and the generated types to it. Copy lives in Inlang message catalogs, one JSON file per locale, compiled by Paraglide. Czech (`cs-CZ`) is the content source that translations are made from, with `en-US` as the cross-check. `en-US` is the Inlang base locale, so a message missing from a catalog renders in English.

Read the reference that matches the work:

- The registry, what reads it, the drift tests, and content that falls back through a locale's chain: [references/architecture.md](references/architecture.md).
- The Inlang projects, catalog JSON format (placeholders, plurals, selects), compiling, and the message tests: [references/catalogs.md](references/catalogs.md).
- Adding a locale, end to end: [references/add-a-locale.md](references/add-a-locale.md).
- Translating or reviewing a catalog: the register, parity check, and reviewer checklist in [references/translation-workflow.md](references/translation-workflow.md). Terms and style are in [references/glossary/](references/glossary/): [style-guide.md](references/glossary/style-guide.md) first, then the target locale's file (`de-DE.md`, `uk-UA.md`, `sk-SK.md`, `vi-VN.md`, `hi-IN.md`). [terms.md](references/glossary/terms.md) lists each term's Czech and English source.

Rules for every change:

- Take locale lists and per-locale facts from the registry (`supportedLocales`, `getLocaleDefinition`). Key per-locale data with `mapSupportedLocales` or a `Record` over the locale type, so typecheck names every map a new locale must fill.
- After editing any catalog, compile before running tests or trusting rendered copy. Tests import the generated output and do not compile it ([catalogs](references/catalogs.md#compiling)).

Domain guidance stays with its owning skill: administration catalog areas and the build-output leak check in `deskohub-workspace-administration` ([localization](../deskohub-workspace-administration/references/localization.md)); `m.*` call rules, date formatting and locale-prefixed links in `deskohub-react-ui`; saved language preference in `deskohub-workspace-account` ([locale preference](../deskohub-workspace-account/references/locale-preference.md)); hreflang, sitemap, and locale redirects in `deskohub-workspace-public-site`; mobile catalogs and compile in `deskohub-mobile`.
