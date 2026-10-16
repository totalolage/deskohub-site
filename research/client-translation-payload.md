# Which translations customer client bundles ship

Research for [#620](https://github.com/totalolage/deskohub-site/issues/620) (child of #618). Measured on `b98360e68` (origin/main, 2026-10-16) with `@inlang/paraglide-js` 2.26.0 and `next` 16.4.0 (Turbopack), both resolved in `bun.lock`.

## Summary

- Client chunks carry only messages that some client component calls. 448 of the 910 catalog keys reach the browser. Messages used only in server components are dropped.
- They are not split by route. All 448 client messages sit in one shared chunk, and every customer route and every admin route loads it. Home ships 179 `account*` messages.
- Each message function includes both locales and picks one at runtime.
- Translations are about 4-6% of first-load JS: 23.9 KiB gzip of message code on routes that load 471-656 KiB gzip. The whole shared chunk, with the `m` namespace object and the Paraglide runtime, is 31.3 KiB gzip.
- Admin messages called from admin client components through `m` ship to customers. The same happens with direct imports of the generated files and with a separate barrel over them. At 300 messages they all land in the shared chunk that home, checkout and account load. Neither `turbopackChunking.clusters` nor turning off chunk-merge incentives changes that.
- Admin messages compiled into a separate folder (`features/administration/...`) stayed out of every customer route's chunks.
- None of Paraglide's per-locale options fits this app.

## Method

1. Worktree at `b98360e68`. `bun run i18n:compile`, then `bunx next build --turbo --experimental-build-mode=compile` in `apps/deskohub-workspace`, using synthetic local-only env values (fake secrets, localhost database URL). Compile mode emits all client chunks and `page_client-reference-manifest.js` files, then stops before prerendering. A full `next build` with synthetic env failed at prerender on `/[locale]/reservation/cowork` (runtime data outside `<Suspense>` under Cache Components). That happens after the chunks are written and doesn't affect these measurements. Each build took about 62 s on the devbox, `i18n:compile` included.
2. Route → chunks: for each route's `.next/server/app/<route>/page_client-reference-manifest.js`, first-load JS is the union of `entryJSFiles[*]` plus `rootMainFiles` from `.next/build-manifest.json`. The guard prototype also adds `clientModules[*].chunks`, which covers lazily loaded client chunks.
3. Message detection: Turbopack emits each Paraglide message module as `let X=(e={},a={})=>"cs-CZ"===(o.I??a.locale??(0,o.Z)())?"<cs>":"<en>";e.s(["<key>",0,X],<id>),e.i(<id>)`. The analysis matched the `e.s(["<key>",0,` export against the catalog keys and measured each definition's bytes. Gzip is level 9 on the concatenated definitions or on whole chunks.
4. Probe builds (never committed; diffs kept outside the repo):
   - `probe`: `researchProbeClient` in a home client component (`landing-page-photo-carousel.tsx`), `researchProbeServer` in a home server component (`landing-page.tsx`), `researchProbeAdmin` in a new `"use client"` component on `app/admin/page.tsx`, all through `m`. Values are unique markers such as `PROBE_ADMIN_CS_7f3a`.
   - `probe-direct`: the same, but the admin probe imports its generated message file directly instead of `m`.
   - `bulk`: 300 synthetic admin messages (about 50 characters each, Czech with diacritics) called through `m` from one admin client component.
   - `bulk-clusters`: `bulk` plus `experimental.turbopackChunking.clusters: [[/^\/admin/], [/^\/(en-US|cs-CZ)/]]`.
   - `bulk-barrel`: `bulk`, but the component imports `* as am` from a separate admin-only barrel that re-exports the 300 generated files.
   - `bulk-folder`: the 300 generated files moved to `features/administration/research-i18n-probe/messages/` (still importing the main `runtime.js`) and removed from the main catalogs, consumed through a barrel in that folder.
   - `bulk-nomerge`: `bulk` plus `experimental.turbopackChunking: { requestCost: 0, minChunkSize: 0 }`.

## Measurements (baseline)

| Route | First-load chunks | First-load JS raw / gzip (KiB) | Messages | Message code raw / gzip (KiB) | Share of gzip |
| --- | --- | --- | --- | --- | --- |
| `/[locale]` (home) | 27 | 1913 / 593 | 448 | 93.8 / 23.9 | 4.0% |
| `/[locale]/reservation/cowork` | 32 | 2111 / 656 | 448 | 93.8 / 23.9 | 3.6% |
| `/[locale]/checkout/pay` | 27 | 1698 / 532 | 448 | 93.8 / 23.9 | 4.5% |
| `/[locale]/account` | 31 | 2018 / 630 | 448 | 93.8 / 23.9 | 3.8% |
| `/[locale]/reservation/status/[orderId]` | 22 | 1526 / 471 | 448 | 93.8 / 23.9 | 5.1% |
| `/admin` | 26 | 1675 / 502 | 448 | 93.8 / 23.9 | 4.8% |
| `/admin/reservations/[reservationId]` | 18 | 1194 / 366 | 448 | 93.8 / 23.9 | 6.5% |

- All 448 definitions are in a single chunk (127 KB raw, 31.3 KiB gzip). That chunk also holds the `m` namespace object, a 16.6 KB `e.s([...])` list of the 450 used exports, plus the Paraglide runtime. No message is defined twice.
- String literals for those 448 keys: en-US 19.7 KiB, cs-CZ 22.8 KiB (JSON-encoded catalog values). Most of the remaining ~51 KiB of message code is per-function wrapper code of about 100 bytes each.
- Real messages average about 214 B raw and 55 B gzip in the bundle. 250-400 admin messages in the shared chunk would add roughly 52-84 KiB raw and 13-21 KiB gzip to every customer route, about 2-4 percentage points of first load. The synthetic `bulk` strings repeat, so their measured gzip delta (+9.8 KiB) understates real copy.

## Answers

1. **Server-only messages are absent.** `PROBE_SERVER_*` appeared in no client chunk. Of 910 keys, 462 never reach the client.
2. **Messages used only on other routes are present.** The client-used set goes into one shared chunk loaded by every route. Account-only copy such as `accountAresLookupApply`, used only by `features/account/components/profile-form.tsx`, is in home's first-load JS, along with 178 other `account*` keys. The `probe` admin marker landed in that chunk (`3os42d6ntcjt9.js`), which home, cowork, checkout, account and admin all load.
3. **Every message carries both locales.** The generated module (`compiler-options.d.ts`; sample in the generated `messages/*.js`) defines one function per locale and dispatches on `experimentalStaticLocale ?? options.locale ?? getLocale()`. `experimentalStaticLocale` is a runtime import (`o.I`) that Turbopack doesn't fold, so both branches survive minification. The only one-branch functions are the 8 messages with identical text in both locales (`contactEmailLabel`, `accountReservationWifi`, …), where the minifier collapsed the ternary. Passing a literal `{ locale: "en-US" }`, as the admin probe did, doesn't remove the other branch.
4. **Translation share** is 3.6-5.1% of customer first-load gzip for message code alone, or 4.8-6.6% counting the whole shared chunk.

## Admin-only messages at scale

| Build | Chunk with `BULK_ADMIN_*_150` | Loaded by home / checkout / account | Leaked keys (guard prototype) |
| --- | --- | --- | --- |
| `bulk` (via `m`) | shared chunk, 212 KB | yes / yes / yes | 300 |
| `bulk-clusters` | same shared chunk, 212 KB | yes / yes / yes | 300 |
| `bulk-barrel` (separate barrel, same generated files) | shared chunk, 203 KB, also holds customer messages | yes / yes / yes | 300 |
| `bulk-nomerge` (`requestCost: 0, minChunkSize: 0`) | same shared chunk, 212 KB (256 chunk files total vs 128) | yes / yes / yes | 300 |
| `bulk-folder` (files under `features/administration/...`) | admin-only chunk, 65 KB | no / no / no | 0 |

Ordinary admin client code doesn't leak. In the baseline, none of the 7 admin client modules (`admin-shell.tsx`, `data-table.tsx`, the reservation, booking and customer tables, …) is defined in home's first-load chunks. The merging applies to the Paraglide message modules under `features/i18n/paraglide/messages/`, whatever imports them. Turbopack's chunker docs (`next/dist/server/config-shared.d.ts`, `turbopackChunking`) describe cost-based chunk merging. The fact that the location decides the outcome, while barrels and merge settings don't, suggests these modules are grouped by source directory first. That is a hypothesis, not checked in the Turbopack source. In `bulk-folder`, Turbopack also scope-hoisted the moved functions into the admin component's module and dropped the export names.

## Paraglide per-locale options (2.26.0)

From `node_modules/@inlang/paraglide-js/dist/compiler/compiler-options.d.ts` and `dist/bundler-plugins/vite.d.ts`:

- `outputStructure: "locale-modules"` produces `messages/en-US.js` and `messages/cs-CZ.js`, and `_index.js` imports both and dispatches by locale. The docs say it "may tree-shake less efficiently" and recommend it for development only. It doesn't split by locale for the browser.
- `experimentalStaticLocale` is a "compile-time locale constant used for per-locale tree-shaking". The documented flow serves a separate build per locale (`dist/de/…`, `dist/en/…`). Here that would mean a separate Next build and deployment per locale behind the `/[locale]` routing. Not practical.
- `experimentalMiddlewareLocaleSplitting` "only works in SSR/SSG environment without client-side routing. Do not rely on this feature for production." It needs Paraglide's server middleware to inject messages into HTML. The App Router routes on the client, and the repo doesn't use `paraglideMiddleware`. Not applicable.
- `experimentalPerLocaleBuild` is a Vite plugin option that requires Vite 8/Rolldown. Not applicable to Next/Turbopack.
- `isServer` (default `typeof window === "undefined"`) only gates server-only runtime code.

Even if per-locale splitting worked, it would save the other locale's literals, at most about 20-23 KiB raw (roughly 6-8 KiB gzip) per customer route today. That is less than the 13-21 KiB gzip that 250-400 leaked admin messages would add.

## Recommendation

1. **Keep admin translations out of `features/i18n/paraglide`.** Compile admin copy from its own Inlang project, for example `features/administration/i18n/{project.inlang,messages/}`, into an outdir under `features/administration/`, and expose it through an admin barrel that only `app/admin` and `features/*/admin` import. `bulk-folder` approximates this: the generated files lived under `features/administration/` and imported the main runtime. A separate project generates its own runtime. Admin always passes `{ locale }`, so a second runtime only adds its size to admin chunks. Confirm the real setup with the guard below before admin messages land.
2. **Server-rendered admin copy is free for customers.** Server-only messages never reach the client. This is a fallback for admin client components, at the cost of passing rendered strings to them.
3. **Leave per-locale splitting and `outputStructure` alone.** The options don't fit the stack, and the savings are small.
4. **Optional, separate decision:** route-level splitting of customer messages, such as account copy off home, would need the same folder-level separation per feature. At 23.9 KiB gzip total it probably isn't worth it yet.

## Proposed guard

A build-output test that fails when admin translations reach any customer route.

- **Where it runs:** a new Workspace CI job runs `bun run i18n:compile && next build --turbo --experimental-build-mode=compile` with the CI's synthetic env, then a colocated test such as `features/administration/i18n/client-bundle.build.test.ts`. That test sits outside the default `bun test` glob, or is selected by path. It fails, rather than skips, when `.next` is missing.
- **What it checks:**
  - Read every `page_client-reference-manifest.js`. Collect `entryJSFiles` plus `clientModules[*].chunks` for routes outside `admin/` (the customer set) and under `admin/` (the admin set).
  - Build fingerprints from the admin catalogs: for each message in both locales, take the longest static text segment, keep segments of 12+ characters, and drop any that also occur in the customer catalogs.
  - Fail if a fingerprint occurs in a customer chunk.
  - Also fail if no fingerprint occurs in any admin chunk. This positive control catches the scan going blind after a Turbopack output change.
- **Detection lesson from the probes:** match message text, not export names. Export names survive in the default layout (`e.s(["key",0,…])`) but disappeared after scope hoisting in `bulk-folder`. A name-based prototype (`/home/dev/scratch/admin618-r2/scripts/guard-prototype.mjs`, not committed) reported all 300 `bulk` leaks in about 150 ms, but found zero admin keys in `bulk-folder` even though the strings were there.
- **Cost:**
  - The scan takes under 1 s.
  - The compile-only build took about 62 s on the devbox. On a GitHub runner, expect 2-4 min including `bun install` and the cold Turbopack cache.
  - Run as a parallel job, it adds about 2-4 runner-minutes per push and little wall-clock time, since E2E takes about 5¾ min.
  - A cheaper alternative is running the same scan after `next build` in the Vercel build (`build` script), which costs under 1 s. It fails only at deployment time, and the check isn't a colocated test.
- **Optional budget:** the same job can assert a ceiling on translation bytes per customer route, for example the shared message chunk at 35 KiB gzip or less, so customer growth stays visible.

## Limitations

- Compile-mode builds with synthetic env. Vercel builds with real env, but env values shouldn't change client chunking.
- Synthetic bulk strings compress better than real copy. The admin size estimate scales from real-message averages instead.
- The directory-grouping explanation is inferred from the probes, not from Turbopack source. A Next/Turbopack upgrade can change chunking, which is why the guard keeps a positive control.
- The separate-Inlang-project layout itself wasn't built. `bulk-folder` reused the main runtime.
