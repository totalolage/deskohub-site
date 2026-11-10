# Translation workflow

Translate from `cs-CZ`. Use `en-US` to settle what an ambiguous Czech source means, never to override it. Read [glossary/style-guide.md](glossary/style-guide.md) and the target locale's glossary file before writing. Catalog format is in [catalogs.md](catalogs.md).

The register for each locale and surface is in [style-guide.md §2](glossary/style-guide.md#2-register-per-locale-and-surface), and what to write in each plural category is in [§8](glossary/style-guide.md#8-plurals).

## Parity check

No test compares catalogs, so check every translated catalog against its `cs-CZ` counterpart before review:

1. Keys: the target has exactly the source's keys, with none missing or extra, in the source's order.
2. Shape: each key has the source's shape: a string, or a variant array with the same `declarations` and `selectors`.
3. Placeholders and tags: every variant keeps the source's placeholder names and rich-text tags, the same number of each. Check tag pairing and nesting, and escaped literal braces, by reading the text; counting tokens doesn't prove them. The one deliberate exception is in [style guide §7](glossary/style-guide.md#7-placeholders-and-rich-tags).
4. Plurals: match keys follow the target locale's categories ([catalogs](catalogs.md#plurals)), not the Czech ones. Slovak adds `many` beside Czech `few` and `other`. Ukrainian splits the Czech `other` into `many` (whole counts) and `other` (fractions). German and English fold every Czech non-`one` form into `other`. Keep a source `*` key.
5. Selects: the Czech select match keys are kept verbatim, and every combination of select values and plural categories is present.
6. Values: none is empty. A value identical to the source is a prompt to look again, not an error, because brand names and shared words can be correct.

Then compile and run the message tests ([catalogs](catalogs.md#message-tests)).

## Reviewer checklist

Structure and format
- [ ] The parity check passes. The JSON parses, and the declarations and selectors are intact.
- [ ] Rich-text tags are intact, paired, and correctly nested; line breaks and meaningful punctuation are kept.
- [ ] Brands, product and tier names, legal-entity details, URLs, email addresses, codes, and language names are unchanged unless the glossary says otherwise.
- [ ] Dates, numbers, and currency come from placeholders and formatters, not from hand-localized literals.

Terminology
- [ ] Glossary terms are used, its forbidden alternatives avoided, and each concept has one term across the catalog and related surfaces.
- [ ] Ambiguous Czech was resolved from en-US and the caller's UI context. Any remaining doubt is flagged with the key and the reason.

Register and tone
- [ ] The surface's register holds throughout, and the customer and administration registers don't leak into each other.
- [ ] Wording stays gender-neutral where the source is. No gender is inferred from a name or placeholder, and there are no slash or bracket gender forms.
- [ ] First-person consent and confirmation text keeps the speaker's point of view.

Grammar and typography
- [ ] Case and agreement hold in the assembled UI, including sentences composed from several keys and every placeholder value the caller can pass.
- [ ] The locale's capitalization, quotation marks, apostrophes, spacing, dashes, and ellipsis are used. German nouns are capitalized and compounds checked.
- [ ] Button, menu, and field names quoted in text match the localized labels.
- [ ] Ukrainian apostrophes are U+02BC `ʼ`: `rg -n "[а-яіїєґА-ЯІЇЄҐ]['’][а-яіїєґА-ЯІЇЄҐ]" <catalog>` prints nothing.

Length and fit
- [ ] Buttons, titles, tabs, headers, and email subjects fit their rendered space. Long or rephrased labels are checked for wrapping and truncation, and any approved exception is recorded.

Legal and meaning
- [ ] Meaning matches cs-CZ.
- [ ] Consent, withdrawal, privacy, and other legal wording keeps its scope and legal effect.
- [ ] Every unresolved or deliberately exceptional key is listed with its issue and the proposed fix.
