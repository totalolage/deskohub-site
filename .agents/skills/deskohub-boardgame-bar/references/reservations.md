# Reservation implementation

## Table reservations

The localized table-reservation page embeds the ChoiceQR booking experience. Keep ChoiceQR as the reservation and availability boundary; do not reintroduce the removed Boardgame Bar Dotypos reservation service or a local reservation webhook workflow.

The page is gated by `siteConstants.featureFlags.tableReservations`. Its locale mapping is explicit for every supported locale and must remain exhaustive.

Inspect:

- `app/[locale]/reservation/page.tsx` for the embed, locale mapping, metadata, and page gate;
- `shared/utils/constants.ts` for the static gate;
- `features/navigation/components/reservation-button.tsx` for the primary entry point; and
- `project.inlang/settings.json` plus `features/i18n/messages/*.json` for supported locales and customer copy.

## Training-room requests

Training-room submissions use the feature-local schema, server action, and `TrainingReservationService`. The service sends the business notification before accepting the request. Map a business-delivery failure to the localized action error and do not redirect as if the request succeeded.

The customer acknowledgement is best effort after the business notification succeeds. Log a delivery failure without turning the already-received business request into an action failure.

Keep the request business meaning clear in UI and email copy: it is received for telephone confirmation, not confirmed availability.

The feature is gated by `siteConstants.featureFlags.boardroomReservations`. Keep family-specific form, rendering, and email code under `features/training/reservation`.
