# Resend Email Service Setup

## Overview

The application uses Resend for sending production emails. When the `RESEND_API_KEY` is configured, the system automatically switches from console logging to actual email delivery via Resend.

## Setup Steps

### 1. Get Resend API Key

1. Sign up for a Resend account at https://resend.com
2. Navigate to the API Keys section
3. Create a new API key with appropriate permissions
4. Copy the API key

### 2. Configure Environment Variable

Add the Resend API key to your `.env.local` file:

```bash
RESEND_API_KEY=re_YOUR_API_KEY_HERE
```

### 3. Verify Domain (Production)

For production use, you'll need to verify your sending domain:

1. In Resend dashboard, go to Domains
2. Add your domain (e.g., `deskohub.cz`)
3. Add the required DNS records:
   - SPF record
   - DKIM records
   - Optional: DMARC record
4. Verify the domain

### 4. Configure From Addresses

The system automatically uses locale-specific from addresses:

- Czech (`cs-CZ`): `rezervace@deskohub.cz`
- English (`en-US`): `reservations@deskohub.cz`

Make sure these email addresses are configured in your domain.

## Email Types

The system sends the following emails:

### Customer Emails

1. **Reservation Created** - Sent when a new reservation is submitted
   - Subject: "Potvrzení přijetí rezervace" / "Reservation Received"
   - Informs the customer their reservation is pending confirmation

2. **Reservation Confirmed** - Sent when staff confirms the reservation
   - Subject: "Rezervace potvrzena" / "Reservation Confirmed"
   - Confirms the reservation details

3. **Reservation Declined** - Sent when a reservation is declined
   - Subject: "Rezervace zamítnuta" / "Reservation Declined"
   - Informs about the declined status with a reason if provided

### Business Notifications

1. **New Reservation Notification** - Sent to `reservations@deskohub.cz`
   - Subject: "Nová rezervace - [Customer Name] - [Date] [Time]"
   - Contains all reservation details for staff review

## Testing

### Development Mode

When `RESEND_API_KEY` is not set, emails are logged to the console. This is useful for development and testing.

### With Resend API Key

When the API key is configured:

1. The system will use Resend to send actual emails
2. Check the Resend dashboard for email logs and delivery status
3. Use the webhook testing panel (dev mode only) to trigger test emails

### Webhook Testing

In development mode, visit any reservation details page to access the webhook testing panel:

```
http://localhost:3000/[locale]/reservation/[id]
```

The panel allows you to trigger webhooks for different reservation statuses.

## Email Provider Architecture

The email system uses a provider pattern with Effect.js:

```typescript
// Automatic provider selection based on environment
export const StandaloneEmailServiceLive = EmailServiceLive.pipe(
  Layer.provide(EmailTemplateServiceLive),
  Layer.provide(
    env.RESEND_API_KEY 
      ? ResendEmailProviderLive   // Production with Resend
      : ConsoleEmailProviderLive   // Development with console
  ),
  Layer.provide(EmailConfigLayer)
);
```

## Troubleshooting

### Emails Not Sending

1. Verify `RESEND_API_KEY` is set correctly
2. Check Resend dashboard for API key status
3. Verify domain is configured (for production)
4. Check server logs for error messages

### Wrong Language Emails

1. Ensure locale is properly extracted from reservation metadata
2. Check the `parseNoteWithMetadata` function is working correctly
3. Verify locale is passed through the entire email chain

### Rate Limiting

Resend has rate limits based on your plan:
- Free: 100 emails/day, 10 emails/second
- Pro: Higher limits

Monitor your usage in the Resend dashboard.

## Environment Variables Reference

```bash
# Required for production email sending
RESEND_API_KEY=re_YOUR_API_KEY_HERE

# Already configured (webhook security)
DOTYPOS_WEBHOOK_SECRET=YOUR_UUID_HERE
```

## Migration from Console to Resend

The system automatically detects the presence of `RESEND_API_KEY`:

- **No API key**: Uses ConsoleEmailProvider (logs to console)
- **API key present**: Uses ResendEmailProvider (sends real emails)

No code changes required - just add the environment variable!