# Workspace App design

## Source of truth

The approved Figma file, **Workspace App**, is the complete visual source of truth for the mobile app and PWA. It replaces the previous mobile design rather than extending it. Existing behavior, accessibility, localization, live data, and security boundaries remain authoritative where illustrative design content conflicts with the product.

## Visual system

- Hanken Grotesk is the only application typeface.
- The canvas is `#F8F9FA`; grouped surfaces are white or `#F3F4F5`.
- Primary ink is `#191C1D`; secondary text is `#584236`; subtle neutral text is `#454749`.
- Primary actions use `#9C4400`. Active bottom navigation uses `#EF6C00`.
- Borders use the warm outline `#E0C0B0`.
- Paid, pending, and failed states use their approved semantic green, amber, and red surfaces and always include text or an icon.
- The repository Deskohub geometric mark is the only logo. Product imagery comes from the live catalog, with the shared placeholder only when needed.

## Structure and density

- Phone screens use the Figma 390-pixel compositions as their compact reference.
- Top bars are 56 pixels and bottom navigation is 64 pixels, with icons optically centered in their touch targets.
- Search, filters, product rows, purchase rows, and settings are compact and aligned. Copy that is obvious from context is omitted.
- The PWA adapts the same components to wider space without introducing a separate visual theme.
- Sticky cart and payment actions respect safe-area and browser insets and never cover content.

## Product constraints

- Never display customer-facing stock state, stock synchronization, illustrative SKUs, shipping, delivery, stored cards, fees, or reorder controls.
- Cart does not show seller details or a VAT breakdown. The purchase record may show authoritative seller and tax data where required.
- Use live prices, products, purchases, customer identity, statuses, and receipt state; Figma sample content is not application data.
- Neon owns magic-link submission and its real email-confirmation state. The hosted Neon flow receives the same visual system; the app must not duplicate authentication or invent resend state.
- Empty, locked, offline, loading, and error states remain concise and actionable.
