# Email

`BoardgameEmailLayer` (`shared/backend/config/email.config.ts`) builds `EmailServiceTag.Live` from `@deskohub/email`. It sends every message through the single provider the config selects, unlike Workspace's per-recipient routing.

## Provider selection

- `EMAIL_PROVIDER=resend` or `console` picks the provider. Without it, the app uses Resend when `EMAIL_API_KEY` is set and Console otherwise.
- Console is allowed outside production, in Vercel Preview, or with `EMAIL_TEST_MODE=true`. Otherwise production falls back to Resend when `EMAIL_API_KEY` is set and fails without it (`ConfiguredEmailProviderLayer` in `packages/email/backend/provider-factory.ts`).
- The sending domain must be verified in Resend.

## Addresses

- Sender: `EMAIL_FROM_ADDRESS` and `EMAIL_FROM_NAME`, defaulting to `siteConstants.contact.fromEmail` (`noreply@mail.deskohub.cz`) and the brand name.
- Business mailboxes: `siteConstants.contact.reservationEmail` for training-room requests and `siteConstants.contact.contactEmail` for the contact form.

## Verify

Submit the contact or training-room form with synthetic data. The log line `Using Console email provider` or `Using Resend email provider` shows which provider ran.
