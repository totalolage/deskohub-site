# i18n architecture

Paths starting with `features/`, `app/`, `db/`, `shared/` or `e2e/`, and the files `vercel.json` and `proxy.ts`, are in `apps/deskohub-workspace`.

## The locale registry

`packages/i18n/src/locale-registry.ts`, imported by its subpath `@deskohub/i18n/locale-registry` (the package root doesn't re-export it). Each entry records:

- `tag`: the BCP 47 tag that identifies the locale in URLs, cookies, and storage.
- `language` and `region`: the subtags. A browser or device language matches on `language`.
- `nativeName`: the language picker label.
- `direction` and `script` (`latin`, `latin-vietnamese`, `cyrillic`, `devanagari`). `script` drives the fonts for scripts the brand font can't set (`features/i18n/locale-fonts.ts`; Hindi's line metrics are in `app/globals.css`); Vietnamese is Latin but has its own value because the brand font lacks its stacked diacritics.
- `fallbackChain`: the locales whose authored content stands in, in order, when content in this locale is missing.
- `nexiLanguage`: the language of the Nexi hosted payment page.
- `phoneRegion`: the region used to read a phone number that has no country calling code.

It also exports `supportedLocales` in registry order (base locale first), `baseLocale` (`en-US`, the catalog base that missing messages fall back to), `unstatedLanguageLocale` (`cs-CZ`, for a visitor who states no language), `unservedLanguageLocale` (`en-US`, for a visitor who states only languages Deskohub doesn't serve), `getLocaleDefinition`, `localeByLanguage`, `matchSupportedLocale`, and `mapSupportedLocales`. `locale-registry.test.ts` beside it pins the entries, their order, and the fallback-chain invariants.

## What reads it

Workspace code mostly uses the `Locale` type and `locales` list that Paraglide generates from the customer Inlang project. A drift test holds those to the registry. Code that needs registry facts imports the registry directly:

- Routing: `features/i18n/routing.ts` maps browser languages through `localeByLanguage`. `features/i18n/locale-resolution.ts` resolves a request's locale in this order: signed-in saved preference, URL, cookie, `Accept-Language`, then the registry defaults. Pages live under `app/[locale]/`.
- API contracts: `CustomerLocale` (`packages/workspace-customer-api/src/customer-locale.ts`) and `AdministrationCampaignLocale` (`packages/workspace-admin-api/src/campaign-locale-and-purpose.ts`) are literal unions of `supportedLocales`. A new locale therefore changes the golden fixtures (`workspace-customer-api.openapi.golden.json`, `administration-wire-contract.golden.json`). Their tests say how to regenerate the fixtures and what a change means for shipped mobile builds and `dhw` binaries.
- Mobile app: `apps/deskohub-mobile` serves every registry locale. Its `AppLocale` is the Paraglide type from its own Inlang project, held to the registry by drift guards (below). `src/i18n/app-locale.ts` resolves the device's languages through `matchSupportedLocale`, falling back to `unservedLanguageLocale`; the language setting labels locales with `nativeName`, and text in any `script` other than `latin` drops the Latin-only brand face for the system font (`src/ui/text-style.ts`).
- Payments: the Nexi service (`packages/nexi/src/backend/service.ts`) opens the hosted payment page in the locale's `nexiLanguage`.
- Other consumers include the Cloudinary localized context, accounting documents, AI booking tools, discount labels, and the campaign and email editors. List them all with `rg -l 'locale-registry' apps packages`.

## Content that falls back through the chain

Operator-written content exists in fewer locales than the catalogs, and the registry's `fallbackChain` picks a stand-in. Every chain reaches `cs-CZ`.

- Campaigns and automations: `features/email-campaigns/recipient-locale.ts` picks the recipient's locale (account preference, then latest reservation, then consent, then Czech), then the first locale on its chain that has content. Rendering (`features/emails/body/email-content.tsx`) takes the translation for exactly that locale, so the fallback happens before it.
- Reusable emails: publication requires `cs-CZ` content (`packages/workspace-admin-api/src/email-publication.ts`). A test checks that every chain reaches it.
- Discount labels: operators write them in `en-US` and `cs-CZ` only. Other locales read the first of those on their chain (`features/discounts/discount-label.ts`).
- Staff-facing text stays Czech for every customer locale: staff notifications and Dotypos reservation notes use `staffLocale` (`shared/backend/staff-locale.ts`). Product names shown to customers come from the customer catalog, not from Dotypos.

## Drift tests

| Artifact | Guard | Failure |
| --- | --- | --- |
| Customer and administration `project.inlang/settings.json` (`baseLocale`, `locales`) | `features/i18n/inlang-project.test.ts`, `features/administration/i18n/inlang-project.test.ts` | locale list or order differs from the registry |
| Generated Paraglide `Locale` type | `features/i18n/locale-registry.typecheck.ts` (and its administration twin) | typecheck error when the type isn't exactly `SupportedLocale` |
| `vercel.json` header route for locale pages | `vercel.test.ts` | the route's locale alternation differs from the registry order |
| Mobile `apps/deskohub-mobile/project.inlang/settings.json` (`baseLocale`, `locales`) | `apps/deskohub-mobile/src/i18n/inlang-project.test.ts` | locale list or order differs from the registry |
| Mobile generated Paraglide `Locale` type (`AppLocale`) | `apps/deskohub-mobile/src/i18n/locale-registry.typecheck.ts` | app typecheck error when the type isn't exactly `SupportedLocale` |
| Database locale `CHECK` constraints | schema files build them from the customer Inlang `locales` (`quotedSqlList(inlangSettings.locales)` in `db/schema/*.ts`); `db/schema/auth.test.ts` checks the generated SQL | schema diff with no migration |

Not guarded: tests that list locales by hand, such as `features/i18n/alternates.test.ts` and `app/sitemap.test.ts`. They fail on their own expectations when a locale is added.
