# Deskohub Workspace

## Purpose

Deskohub Workspace lets a customer with any confirmed Deskohub reservation record self-service food or non-alcoholic drinks and pay from their phone. It is a focused companion for a visit: fast, honest, calm, and trustworthy enough that completing a small purchase feels easier than visiting a counter.

## Audience

- Deskohub customers on the calendar day of any confirmed reservation.
- Returning customers who want to review purchases or manage their account outside a reservation day.
- Czech- and English-speaking users on Android phones or the installable web app.

## Product truths

- The public name is **Deskohub Workspace**; **DW** is reserved for constrained spaces.
- Desktechub s.r.o. is the seller.
- Email magic links authenticate the customer. Authentication may persist, while commerce access is rechecked for the whole local reservation day.
- Dotypos supplies only explicitly tagged `self-service` catalog items and receives a post-payment stock deduction. Stock is informative and backend-visible only.
- Nexi handles hosted payment. A purchase is confirmed only after server verification, and the simple email receipt is sent only then.
- The app never instructs or enforces whether the customer takes an item before or after recording it.
- The current seller is not a VAT payer. The interface shows final CZK prices without VAT breakdown while keeping future VAT-payer support possible.
- The same adaptive Expo product ships as a directly distributed Android APK and an installable PWA. iPhone and app-store distribution are out of scope.
- Catalog browsing and cart editing work from the last validated catalog offline. Payment requires a connection and a fresh quote.
- Small compatible updates may download on any connection; native APK replacement downloads only on unmetered Wi-Fi.

## Core experience

1. Restore a session or request a magic email link.
2. Explain access clearly if today has no eligible reservation or the customer link needs support.
3. Browse or search a small, image-led catalog; add quantities with minimal effort.
4. Review the cart, merchant terms, and current final total.
5. Complete hosted payment and wait for verified confirmation.
6. See a precise receipt-style confirmation and revisit it from Purchase history.
7. Manage language, support links, session, and the shared customer account.

## Experience principles

- **A quick visit, not a marketplace.** Favor a shallow path, large targets, and an always-obvious cart.
- **Workspace App identity.** The approved Figma file is the sole visual source of truth. Reuse the Deskohub mark with Hanken Grotesk, warm neutrals, brown actions, orange navigation emphasis, and semantic status colors.
- **Confident payment states.** Pending, failed, and paid states must be unmistakable without sounding alarming.
- **No false inventory promises.** Never display “in stock,” remaining quantities, or customer-facing stock synchronization.
- **Useful when locked.** Purchase history and account management remain available when new purchases are not.
- **Accessible and localizable.** Support font scaling, screen readers, keyboard navigation on web, dark mode, safe areas, and text expansion in Czech and English.

## Scope boundaries

The first release excludes alcohol, barcode scanning, camera permission, stored cards, discounts, loyalty, delivery, table service, tips, open tabs, customer refunds, invoices, PDFs, and live stock levels. Barcode scanning remains a future expansion.

## Platform

Adaptive: Android is the primary native surface, with the same Expo application providing a responsive installable PWA.
