# Reservations

Business rules: `apps/deskohub-boardgame-bar/docs/reservations.md`.

## Table reservations

`app/[locale]/reservation/page.tsx` embeds the ChoiceQR booking widget. ChoiceQR owns reservations and availability; don't bring back a Boardgame Bar Dotypos reservation service or a local reservation webhook.

- `siteConstants.featureFlags.tableReservations` gates the page and `features/navigation/components/reservation-button.tsx`.
- The page's ChoiceQR locale map must stay exhaustive over the locales in `project.inlang/settings.json`.

## Training-room requests

Code lives under `features/training/reservation`: schema, server action, `TrainingReservationService`, form, and email rendering. `siteConstants.featureFlags.boardroomReservations` gates it.

- The service sends the business notification before accepting the request. If that fails, return the localized action error and don't redirect as if it succeeded.
- The customer acknowledgement is best effort after the business notification. Log a delivery failure; don't fail the action.
- UI and email copy say the request was received for telephone confirmation, never that availability is confirmed.
