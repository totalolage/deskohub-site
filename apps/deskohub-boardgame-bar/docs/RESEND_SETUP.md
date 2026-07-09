# Resend Email Service Setup

## Overview

Email delivery is selected by provider factory logic in `@deskohub/email`.

Default behavior:

- `EMAIL_PROVIDER=resend` forces Resend.
- `EMAIL_PROVIDER=console` forces console logging provider.
- If `EMAIL_PROVIDER` is omitted, the app uses Resend when `EMAIL_API_KEY` is
  present and console otherwise.
- In production, `console` is disabled unless `EMAIL_TEST_MODE=true`; with an `EMAIL_API_KEY`, production falls back to Resend.

## Required Configuration

Add to `.env.local` for the Boardgame Bar app, or to the app's deployment env:

```bash
EMAIL_API_KEY=re_...
EMAIL_PROVIDER=resend
```

`EMAIL_PROVIDER` can be omitted for local development; without `EMAIL_API_KEY`
it defaults to `console`.

## Sender Addresses

Sender/recipient defaults come from `shared/utils/constants.ts`:

- From address: `siteConstants.contact.fromEmail` (default `noreply@mail.deskohub.cz`)
- Reservation mailbox: `siteConstants.contact.reservationEmail`

These are not locale-specific sender addresses in the current implementation.

## Verification

1. Trigger reservation webhooks in development using the webhook test panel.
2. Confirm provider logs indicate Console or Resend initialization.
3. If using Resend, verify deliveries in the Resend dashboard.

## Production Notes

- Verify your sending domain in Resend.
- Set `EMAIL_PROVIDER=resend` if you want explicit provider selection in production.
