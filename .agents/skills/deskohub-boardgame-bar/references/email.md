# Email

`BoardgameEmailLayer` (`shared/backend/config/email.config.ts`) composes a transactional chain of one provider, Resend (`@deskohub/email-resend`) or Console, for `@deskohub/email`'s `EmailServiceTag.Default`. It has no marketing stream and no per-recipient routing; Boardgame Bar mail never goes to PostHog. Packages and chains: the `deskohub-email` skill.

## Provider selection

- `EMAIL_PROVIDER=resend` or `console` picks the provider. Without it, the app uses Resend when `EMAIL_API_KEY` is set and Console otherwise.
- Console is allowed outside production, in Vercel Preview, or with `EMAIL_TEST_MODE=true`. Otherwise production falls back to Resend when `EMAIL_API_KEY` is set and fails without it (`BoardgameEmailLayer`).
- The sending domain must be verified in Resend.

## Addresses

- Sender: `EMAIL_FROM_ADDRESS` and `EMAIL_FROM_NAME`, defaulting to `siteConstants.contact.fromEmail` (`noreply@mail.deskohub.cz`) and the brand name.
- Business mailboxes: `siteConstants.contact.reservationEmail` for training-room requests and `siteConstants.contact.contactEmail` for the contact form.

## Verify

Submit the contact or training-room form with synthetic data. The log line `Using Console email provider` or `Using Resend email provider` shows which provider ran.
