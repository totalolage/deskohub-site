# Deskohub Workspace translation style guide

Shared rules for translating Deskohub Workspace copy from Czech into German (`de-DE`), Ukrainian (`uk-UA`), Slovak (`sk-SK`), Vietnamese (`vi-VN`) and Hindi (`hi-IN`): the customer catalog, the administration catalogs, the legal documents and the mobile catalog. The per-locale glossaries are [de-DE.md](de-DE.md), [uk-UA.md](uk-UA.md), [sk-SK.md](sk-SK.md), [vi-VN.md](vi-VN.md) and [hi-IN.md](hi-IN.md); the concept IDs they use (P01, R05, A09…) are defined in [terms.md](terms.md). Where this guide and a glossary disagree, the glossary wins for its locale; fix the disagreement in the same change so the two files agree again.

Catalog file format (key order, `{variable}` syntax, escaped braces, plural and select message structure) is in [../catalogs.md](../catalogs.md). This guide covers the language.

## 1. Sources and precedence

- **Czech is the source.** Translate the Czech meaning. Use English (`en-US.json`, same keys) only to check terminology and to resolve a Czech ambiguity. When the two disagree in substance, follow Czech and flag the key.
- **Glossary terms are binding.** If a glossary term reads badly in a sentence, rephrase the sentence; don't swap in a synonym. If no rephrasing works, change the glossary entry for every catalog, never one catalog on its own.
- **One concept, one word.** If Czech uses two words for one concept, use one target word for both. Examples: `okruh příjemců` / `uložené publikum` (audience), `cowork` / `coworking`, `zasedačka` / `zasedací místnost` (keep the colloquial/formal difference only if your language has a natural pair). If Czech uses one word for two concepts, use two target words. The main case is `akce`: a sale, an event, or an actions column. See section 5.

## 2. Register per locale and surface

| Surface | de-DE | uk-UA | sk-SK | vi-VN | hi-IN |
|---|---|---|---|---|---|
| Customer site, account, checkout, customer emails, invoices, mobile app | informal **du** (lowercase *du, dein, dir*) | polite **ви**, always lowercase (*ви, ваш, вам*); never **ти** | informal **ty** (*ty, tvoj, tebe*) | neutral **bạn** (lowercase mid-sentence); requests and retries with *Hãy* (*Hãy thử lại.*); never *anh/chị/em/mình* | polite **आप** (*आप, आपका, आपको*), warm; never **तुम** or **तू** |
| Administration (staff UI, staff emails) | formal **Sie** | formal **ви**, lowercase, neutral official tone | formal **vy**, lowercase | formal and impersonal: no second-person pronoun; requests with **Vui lòng** + verb (*Vui lòng thử lại.*) | formal **आप**, neutral official tone |
| Legal documents (terms, house rules, privacy, cookies, marketing consent) | formal **Sie**, mostly third person through defined terms (*der Kunde*… see glossary) | formal; capitalised **Ви / Ваш** where the text addresses the reader directly, otherwise third person through defined terms | formal **vy**, lowercase; third person through defined terms | formal; third person through defined terms; **Quý khách** where the text addresses the reader directly | formal; third person through defined terms; **आप** only where the text addresses the reader directly |

Notes:

- Czech customer copy is informal *ty* throughout (`accountAresLookupInvalidIco` "zadej", `reservationOpenSpaceDescription` "tvé rezervace", "můžeš"). Three FAQ *questions* switch to *vy* because they're written as the visitor asking the venue (`faqQuestionOffices` "Máte soukromé kanceláře?"). The visitor is addressing Deskohub there, so keep that form (e.g. German "Habt ihr…?" or "Gibt es…?", Ukrainian "У вас є…?", Slovak "Máte…?", Hindi "क्या आपके यहाँ…?").
- Czech administration copy is formal *vy* with plural imperatives ("Vyberte", "Zadejte", "Zkuste to znovu"; `shell:shellMobileNavigationDescription`, `discounts:discountsSaveFailedRetry`). Don't let customer informality leak into admin. The reverse applies to customer-facing content previewed inside the admin (email previews, product names): it comes from the customer catalog and stays informal.
- First-person consent lines in checkout (`checkoutPayConsent` "Souhlasím…", "výslovně žádám…") are the customer's own declaration. Translate them in the first person with legal care: they carry the consumer-withdrawal waiver. Use the legal glossary terms (withdrawal, consent, document titles) and have them reviewed with the legal documents.
- **Gender-neutral by default.** Czech copy addresses the reader without gendered forms. Two keys mark gender: `accountReservationBookedBy` "Rezervoval(a) {name}" (the named person) and `accountProfileScreenMemberFallback` "Člen Workspace" (generic masculine). Don't reproduce slash or bracket forms. Rephrase: a noun phrase ("Booked by"), a participle or passive, or a neutral noun. Never guess `{name}`'s gender. Locale files give the patterns.

## 3. Tone

- Warm, short and plain. The Czech voice is a friendly local coworking space: concrete benefits, no hype. Keep exclamation marks where Czech has them. Don't add new ones.
- Errors: say what happened, then what to do ("Nepodařilo se načíst… Zkus to znovu."). Don't add apologies the Czech doesn't have, and don't blame the user.
- Calls to action stay verb-first and short. Use your locale's button convention (infinitive in de-DE, uk-UA and sk-SK; the polite imperative in -ें in hi-IN; see section 9 and the locale files).
- Use the venue's own words for its products: tier names and the brand stay as written. Don't market-ify generic nouns, e.g. a "zasedačka" is just a meeting room.

## 4. Brand, product and proper names (never translate)

| Item | Rule |
|---|---|
| **Deskohub Workspace**, **Workspace** (as the brand, e.g. "ve Workspace", `accountReferralsDiscountInfo`), **Deskohub** | Keep in Latin script, exact capitalisation. Inflection rules are in each locale file. Where a locale can't inflect a name, attach the grammar to a generic noun next to it. Lowercase generic "pracovní prostor" is *not* the brand: translate it. |
| Tier names **Basic Day Pass**, **Cowork Plus**, **Profi Workstation**, and **Basic** in perk copy (`reservationTierPerkAllBasic`) | Product names. Keep verbatim, even though they mix languages. |
| **Dotypos**, **Nexi**, **Google Maps**, **ChatGPT**, **Claude**, **OpenAI**, **Anthropic**, **MCP**, **TTRPG**, **Wi-Fi** (German uses its everyday word *WLAN*; see [de-DE.md](de-DE.md) P28), **PIN** | Third-party, protocol or industry names. Keep the spelling verbatim. Czech inflects *Dotyposu*, *Deskohubu*. Whether a target may inflect is decided in its locale file. |
| Place names **Palmovka**, **Libeň**, street names | German and Slovak keep the spelling. Ukrainian writes the district names in Cyrillic in prose (*Пальмовка*, *Лібень*), with the Latin signage form once in directions (see [uk-UA.md](uk-UA.md) X10). Street names and postal addresses stay Czech and Latin in every locale. **Praha** becomes the target exonym in running prose (*Prag*, *Прага*, *Praha*) but stays *Praha 8* in postal addresses. |
| Legal entity: **Desktechub s.r.o.**, **IČO 24531596**, **Turnovská 430/10, 180 00 Praha 8 – Libeň**, **Městský soud v Praze**, **oddíl C, vložka 442830** | Never translate or reformat the values. A label in front of them may be translated ("Company ID (IČO)"). Court name: keep the Czech name; an explanatory gloss in brackets is allowed in legal documents only. |
| Statutes: **zákon č. 89/2012 Sb., občanský zákoník** | Keep the Czech citation. Add the target's rendering once, marked as Czech (German: *Gesetz Nr. 89/2012 Slg., Bürgerliches Gesetzbuch (Občanský zákoník)*, later *tschechisches Bürgerliches Gesetzbuch*; Ukrainian: *Цивільний кодекс Чеської Республіки*; Slovak: see [sk-SK.md](sk-SK.md) L20). It is Czech law, so never substitute a domestic statute, and never write a bare *BGB* or *Občiansky zákonník* that a reader would take for their own country's code. |
| URLs, email addresses, route paths, cookie names (`cc_cookie`), codes, IDs, message keys, `{placeholders}`, tag names | Never touch. |

Copy that doesn't come from these catalogs is out of scope here: email campaign content (stored per locale in the campaign editor), MCP tool and schema descriptions (English), `llms.txt` (English), staff notification emails (fixed Czech), the company-extract PDF (Czech asset), and Dotypos-sourced menu names (Boardgame Bar only). Workspace product names *are* in the customer catalog, so they're in scope.

## 5. Core domain terms (concept map; target terms are in the locale files)

| Concept | Czech | Watch out |
|---|---|---|
| Coworking product | coworking, cowork (`landingHeroPrimaryCta` "Rezervovat cowork") | Same concept. Use your locale's single loan form. |
| Meeting room | zasedací místnost (formal), zasedačka (everyday) | Product name vs everyday word. Use the target's everyday word for both unless a natural pair exists. |
| Office | (soukromá) kancelář | Private office product. |
| Day pass | *no Czech term*: the product is the tier name "Basic Day Pass" | Don't invent a translated "day pass". |
| Desk / spot / workstation | místo, vyhrazené místo (reserved desk), pracovní stanice (workstation) | `místo` is the bookable seat. Keep the reserved-desk vs workstation distinction. |
| Reservation | rezervace / rezervovat | Customer and admin: "reservation" family. Legal English says "Booking". Target legal text uses the same root as the UI, as a defined term. In admin, `rezervace stolu` = **booking** (the Dotypos table booking behind a reservation). It must be told apart from a reservation: by a different word (de *Tischbuchung*, uk *резервування столу*) or by a fixed qualified phrase that is never shortened (sk *rezervácia stola*). |
| Access | přístupový kód (access code), PIN / PIN kód, klávesnice (keypad), dveře | Access code ≠ passkey. Keypad ≠ keyboard. |
| Sign-in | přihlášení, přihlašovací odkaz (sign-in link), přihlašovací kód, přístupový klíč (passkey) | Czech never says "magic link". Passkey uses the OS vendors' localised term. |
| Discounts | sleva (discount), slevový kód (discount code), poukaz (voucher), doporučovací kód/odkaz (referral code/link) | Three distinct things in `checkoutDiscountCodeLabel`. |
| **akce** | sale (`discounts:discountsSalesTitle`, sale banners), event (`landingOfferingEvents`, legal GTC §14), actions (`administration:administrationTableActions`) | Three target words. Decide from the key name and the English twin. |
| **kampaň** | customer: TTRPG campaign (`ttrpgRoomMetadataDescription`); admin: email campaign | Two target words where your language distinguishes them. |
| **Klient** | legal: the contracting customer; admin-cli: software client | Never mix. |
| Invoice | faktura | The only tax document. There are no receipts or credit notes in the source; don't introduce "receipt". `storno` in admin is a payment-provider **void**, not an invoice cancellation. |
| Administrator | administrátor, role administrátora | Generic masculine in Czech; use neutral forms where the locale allows. |

## 6. Numbers, dates, times, money

- **Never hand-format.** Dates, times, numbers and money reach messages already formatted, or are formatted in the message with Inlang's `number` function. Server helpers do it: `formatMoney(money, locale)` (`shared/money/money.ts`), `formatCount` (`shared/utils/number.ts`), the date-time formatters (`features/reservation/reservation-date.ts`, `features/administration/formatters.ts`). Don't write digits, separators, date patterns, weekday or month names, or currency symbols around a placeholder. Write "{price} pro Tag", not "{price} Kč pro Tag".
- **Money stays CZK.** Never convert to EUR or UAH, and never mention an approximate EUR value. When prose has to name the currency without a placeholder (Czech `pricingIntro` writes "Kč"), write **CZK** in every locale, because that is what `Intl` prints for de-DE, uk-UA, sk-SK and hi-IN. Don't write "Kč" or "Kronen" in German, "крон" in Ukrainian or "Kč" in Slovak prose.
- **Time:** the venue runs on Prague time. Admin forces a 24-hour clock. Don't add "a.m./p.m." or a time-zone name the Czech doesn't have.
- **Date-input format** (`reservationDateInputFormat`) comes in as `{format}` / `{isoFormat}`. Keep both placeholders.
- **Telephone examples:** venue numbers (+420) stay exactly as written. A guest-side placeholder example (`contactPhonePlaceholder`) may use the target country's code with an obviously fake number: +49 151 00000000, +380 50 000 0000, +421 900 000 000, +91 90000 00000.
- **Example emails and names:** use an invented first name at `example.com` (*max@example.com*, *olena@example.com*, *jana@example.com*, *priya@example.com*). Never a real person or a real company domain.
- **Addresses:** the venue address stays in Czech postal form. Billing-form labels translate. Values never do.

## 7. Placeholders and rich tags

- Keep every `{placeholder}` exactly as written: same name, same braces, no translation. You may move it within the sentence. Every placeholder in the Czech must appear in the target, the same number of times. No new ones. The one deliberate exception is the German amount button ([de-DE.md](de-DE.md) R05).
- Rich tags (`<terms>…</terms>`, `<privacy>…</privacy>`, `<contact>…</contact>`, `<discount>…</discount>`, `<count>…</count>`, self-closing `<email/>` in admin) wrap the words that become a link or emphasis. Keep the tag names and their pairing. Wrap the target words that carry the same meaning. You may move a tag pair, but never split one, nest it differently, or leave it empty.
- Placeholders that hold a phrase rather than a value need the sentence built around them. Read the English twin and the caller before translating. Examples: `accountHelpBody` "Pokud potřebuješ pomoc…, {contact}." where `{contact}` is a linked clause; `{duration}`, `{durations}`, `{tier}`, `{product}`, `{title}`. If grammar forces a case on a placeholder's content, the noun is probably inside the placeholder. Rephrase so the placeholder sits in a case-neutral slot (after a colon or a label), and flag the key.

## 8. Plurals

Counts use plural messages. Never pick a noun form in code or write "1 hodina(y)". The message structure and the plural categories each locale's catalog carries are in [../catalogs.md](../catalogs.md). What to write in each category:

- **de-DE:** `one` is the singular (*1 Stunde*), `other` the plural (*2 Stunden*, *0 Stunden*, *1,5 Stunden*). Czech `few` has no German counterpart.
- **uk-UA:** `one` (1, 21, 31…, not 11) takes the nominative singular (*година*); `few` (2–4, 22–24…) the nominative plural (*години*); `many` (0, 5–20, 25–30…) the genitive plural (*годин*), which is the common plural for whole numbers; `other` (fractions such as 1,5) the genitive singular, usually the same text as `few`.
- **sk-SK:** `one` (1) the nominative singular (*hodina*); `few` (2–4) the nominative plural (*hodiny*); `many` (fractions only, such as 1,5) the genitive singular, usually the same text as `few`; `other` (0, 5+) the genitive plural (*hodín*).
- **vi-VN:** `countPlural=other` only (or `*` where Czech uses `*`); every Czech variant folds into it, written with the placeholder, never a literal 1.
- **hi-IN:** `one` (0 and 1) the singular (*1 घंटा*, *1 सीट*); `other` (2+, fractions) the plural (*2 घंटे*, *1.5 घंटे*, *5 सीटें*). Many nouns don't change (*दिन*, *बुकिंग*, *रेफ़रल*): both variants then carry the same text. Czech `few` and `many` have no Hindi counterpart.
- Czech has no `many`, so the Ukrainian and Slovak `many` text has no Czech line to follow, and a Czech-speaking reader won't notice a wrong one. Write it from the rules above: Ukrainian genitive plural (*5 годин*), Slovak fraction form (*1,5 hodiny*).
- When all Czech variants are identical (*doporučení*), the target may still need different forms (German *Empfehlung / Empfehlungen*). Translate each category on its own.
- If a Czech message isn't a plural but your language needs one (a count inside plain text), flag the key. Don't hard-code a form.

## 9. Length and layout

- German runs roughly 30 % longer than Czech, Ukrainian 15–25 % longer, Slovak about the same, Hindi 10–25 % longer and taller (Devanagari vowel signs sit above and below the line). Nothing truncates automatically, so overflow shows up as broken layout.
- **Buttons, tabs, nav items, table headers, badges:** stay within the Czech length +20 %, or about 20 characters, whichever is larger. Use the shortest idiomatic form: infinitive verb without an object when context is clear ("Speichern", "Зберегти", "Uložiť"). German: avoid long compounds on buttons ("Code kopieren", not "Empfehlungscode kopieren", when the label sits next to the code).
- **Page titles / meta titles:** the app appends " | Deskohub Workspace". Keep the translated part ≤ 40 characters. Meta descriptions ≤ 155 characters.
- **Email subjects** (customer transactional): ≤ 60 characters, key fact first.
- **Mobile app strings** (`apps/deskohub-mobile/messages`): plain strings, no plurals, small screens. Keep within the Czech length.
- Don't use line breaks, non-breaking spaces or soft hyphens to fit text, unless your locale's typography requires them (see [sk-SK.md](sk-SK.md) on one-letter prepositions).

## 10. Legal documents

- The Czech originals live in `features/legal/locales/cs-CZ/` (`documents.tsx` for headings and prose, `summaries.ts` for titles); each target locale has its own folder beside it. Translate headings, defined terms and prose. Keep section numbering and dates.
- Defined terms (Poskytovatel, Klient, Spotřebitel, Prostory, Služby, Tarif, Ceník, Přístupový PIN kód, Rezervace, Provozovatel, Uživatel, VOP) are capitalised in Czech. Each gets one fixed target term from the glossary, capitalised as a defined term where the language allows. Use it identically everywhere.
- These are Czech-law documents: keep the Czech statute citations, the controller identity and the Czech ADR body. Don't adapt them to German, Ukrainian or Slovak law.
- Each translated locale carries a translation notice: the text is a translation of the Czech original, and the Czech version prevails if they conflict. Keep that meaning when editing the notice.

## 11. Review

The review checklist for translated batches is in [../translation-workflow.md](../translation-workflow.md).
