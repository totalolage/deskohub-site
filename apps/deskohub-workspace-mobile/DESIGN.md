# Warm Ledger design direction

## North star

The selected direction is the generated **Warm Ledger** composition in [design/warm-ledger-reference.png](design/warm-ledger-reference.png). It combines the trust of a clear purchase ledger with the warmth of Deskohub hospitality. It is a direction test, not a screenshot to trace: real controls, copy, responsiveness, accessibility, and state behavior take precedence over generated details.

## Visual world

- Warm off-white is the default canvas. White or lightly tinted tonal surfaces group content without turning every section into a floating card.
- Deskohub navy anchors top app bars, primary text, selected navigation, and the persistent cart. It supplies structure and confidence.
- Sunset yellow marks quick add actions. Orange is reserved for the payment action and urgent recovery. Aquamarine and green communicate verified access and paid status.
- The repository Deskohub geometric mark is the only logo. Do not reproduce the generated wordmark or create a shop identity.
- Real Dotypos product images are the dominant catalog imagery; the bundled Deskohub placeholder occupies exactly the same frame when no image is usable.

## Type and density

- Sculpin provides branded display moments and screen titles where its glyph coverage is safe. A legible platform sans handles body, labels, prices, and controls.
- Use a compact Material type hierarchy: strong titles, readable body copy, and tabular-feeling price alignment without a monospace costume.
- The phone layout keeps the next product visible below two complete rows, preserving scan momentum without shrinking 48 dp actions. Spacing communicates grouping before borders do.

## Component character

- Android structure follows Material 3: edge-to-edge safe areas, contextual top app bars, system Back, 48 dp targets, bottom navigation on compact widths, and a rail or wide content shell for the PWA.
- Product rows mix a consistent image frame, name/unit, price, and one obvious add or quantity control. Featured layouts may be more image-led, but never become an advertising carousel.
- Category filters are compact controls, not decorative pills. Selected state is navy; unselected state remains quiet and visibly interactive.
- The cart dock is a navy high-confidence summary above navigation. It shows item count, total, and one clear route to review.
- Checkout uses a single orange filled action. Paid confirmation uses a large green verification mark and an orderly receipt summary. Pending and failed states use icon, label, and text—not color alone.
- Locked, offline, empty, loading, and error surfaces are useful inline states with a next action. Avoid unnecessary dialogs and nested cards.

## Adaptive behavior

- Compact Android and web widths use three destinations: Shop, Purchases, Account.
- Wider PWA layouts move navigation to a left rail and cap reading/content width while allowing a two-column catalog and persistent cart summary.
- Sticky actions respect safe-area and browser insets and never cover the final content row.
- The initial release deliberately follows the approved light Warm Ledger composition. A future dark theme must preserve these semantic roles rather than mechanically invert the canvas.

## Motion

Motion is restrained and functional. Quantity changes and cart totals use short Material fade-through or shared-axis transitions. Payment verification receives the one authored emphasis moment. Reduced-motion settings replace movement with an immediate state change or crossfade.

## Do not literalize

Generated product packaging, dates, IDs, seller registration data, tax wording, and copy are illustrative. Use live product images and authoritative localized data. Do not add the generated VAT claim, reservation hours, notifications bell, favorites, fees, or any stock language unless the product contract supplies them.
