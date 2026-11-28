# Changelog

## [0.2.8](https://github.com/totalolage/deskohub-site/compare/mobile-v0.2.7...mobile-v0.2.8) (2026-11-28)

### Features

* **mobile:** book Team Tables by table size and 15-minute time slot, invite guests, and view Team Table reservations
* **mobile:** offer Entry packs and Unlimited memberships at the end of Cowork booking and in Past reservations (hidden for active Unlimited members)
* **mobile:** rename Unlimited passes to Unlimited membership across the app

### Bug Fixes

* **mobile:** apply over-the-air updates on launch and show the restart banner only for updates published while the app is running
* **mobile:** keep cancellation offers on Entry pack visits and show reservation settlement details in booking history
* **mobile:** keep pass offer cards and the savings footer readable on narrow screens and the web

## [0.2.7](https://github.com/totalolage/deskohub-site/compare/mobile-v0.2.6...mobile-v0.2.7) (2026-11-22)

### Bug Fixes

* **mobile:** keep onboarding profile edits if the app restarts before you finish
* **mobile:** enlarge the Reserved Desk card artwork in coworking booking

## [0.2.6](https://github.com/totalolage/deskohub-site/compare/mobile-v0.2.5...mobile-v0.2.6) (2026-11-19)

### Features

* **mobile:** browse reservations and view the selected booking side by side on wide screens

## [0.2.5](https://github.com/totalolage/deskohub-site/compare/mobile-v0.2.4...mobile-v0.2.5) (2026-11-19)

### Bug Fixes

* **mobile:** update PostHog React Native to 4.87.0

## [0.2.4](https://github.com/totalolage/deskohub-site/compare/mobile-v0.2.3...mobile-v0.2.4) (2026-11-18)

### Bug Fixes

* **mobile:** opening a cancelled reservation shows Cancelled, even while its payment is still pending

## [0.2.3](https://github.com/totalolage/deskohub-site/compare/mobile-v0.2.2...mobile-v0.2.3) (2026-11-18)

### Features

* **mobile:** a cancelled invoice is marked Cancelled in Invoices and still downloads
* **mobile:** download a cancelled invoice's credit note from Invoices, next to the invoice itself

## [0.2.2](https://github.com/totalolage/deskohub-site/compare/mobile-v0.2.1...mobile-v0.2.2) (2026-11-17)

### Features

* **mobile:** pick your billing country from a searchable list that starts in your own country
* **mobile:** the price breakdown shows daily rates, early arrival, discount detail and sales, as on the website

### Bug Fixes

* **mobile:** a failed payment reads as Not booked in Reservations, with its booked time
* **mobile:** Back from an access PIN opened from a link goes to Reservations instead of leaving the app
* **mobile:** the field you are typing in stays above the Pay, Save and Continue buttons when the keyboard is up
* **mobile:** the app runs the Expo SDK 58 patch releases, with one copy of each Expo module

## [0.2.1](https://github.com/totalolage/deskohub-site/compare/mobile-v0.2.0...mobile-v0.2.1) (2026-11-17)

### Features

* **mobile:** links to your booking's access page and to Account pages on the website open in the app when it is installed
* **mobile:** book an overnight stay with a small Overnight switch beside the date
* **mobile:** an expired payment can be paid again in place, like a failed or cancelled one

### Bug Fixes

* **mobile:** signing in from the app works again; the website's browser check no longer rejects the sign-in page
* **mobile:** when an app store or updater such as Obtainium installed the app, it no longer offers its own download; the updater handles new versions
* **mobile:** the Download button opens the new version's file on the Deskohub website instead of the Android page

## [0.2.0](https://github.com/totalolage/deskohub-site/compare/mobile-v0.1.1...mobile-v0.2.0) (2026-11-17)

### Features

* **mobile:** a new look across the whole app: a light canvas, navy headers and burned-orange actions, matching the website
* **mobile:** three tabs, Book (the raised orange button), Reservations and Account; the app opens on Reservations when a booking is coming up
* **mobile:** choose a space from picture cards and book coworking, a meeting room or an office with a calendar and a price bar that opens into every line of the price
* **mobile:** check out in steps (your details, review with discount codes and the hold timer, then payment), and see the booking as one ticket with its status
* **mobile:** retry a failed or cancelled payment in place, or book the same space again in one tap
* **mobile:** see today's access PIN on the Reservations list and open it full screen with the address and directions
* **mobile:** look up a company by IČO when entering billing details
* **mobile:** download your invoices and your personal data, and see what each invoice was for
* **mobile:** delete your account in the app, keeping a paid upcoming booking and its PIN
* **mobile:** sign in on restyled pages that open from the app, with the analytics choice carried over

### Bug Fixes

* **mobile:** booking times follow the phone's 12- or 24-hour clock, like the rest of the app
* **mobile:** layouts hold at 200% text size: labels shrink or wrap instead of being cut off
* **mobile:** product names match the website's catalog everywhere
* **mobile:** no white flash between signing in and the first tab
* **mobile:** screen-reader labels on every icon-only button

## [0.1.1](https://github.com/totalolage/deskohub-site/compare/mobile-v0.1.0...mobile-v0.1.1) (2026-11-15)


### Features

* **mobile:** speak Vietnamese and Hindi, following the device or account language


### Bug Fixes

* **mobile:** generate the Paraglide catalogs before the release's over-the-air export, so a release publishes its update to installed apps

## 0.1.0 (2026-11-10)


### Features

* **mobile:** sign in by email link or passkey, with reauthentication and account switching
* **mobile:** book coworking, meeting rooms and offices, with checkout and payment in the browser
* **mobile:** list reservations offline and show each reservation's status and access PIN
* **mobile:** manage the profile, billing details, avatar, language, passkeys, connected assistants, referrals and account deletion
* **mobile:** ask for analytics consent and sync it with the signed-in account's analytics preference
* **mobile:** check for signed over-the-air updates and prompt for new native versions
* **mobile:** open Workspace `/app/` links in the app
* **mobile:** speak English, Czech, German, Ukrainian and Slovak, following the device or account language
