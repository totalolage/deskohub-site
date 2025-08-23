# Reservation Webhook Testing Guide

## Overview
The reservation webhook endpoint at `/api/webhooks/reservation` processes Dotypos reservation status updates and sends appropriate emails to customers and the business.

## Webhook Flow

### When Status = 0 (Created/New)
1. Sends confirmation email to customer (if email exists) - "Your reservation has been received and is pending confirmation"
2. Sends notification email to business at `reservations@deskohub.cz` - includes all reservation details and special requests

### When Status = 5 (Confirmed/Approved)
1. Sends confirmation email to customer - "Your reservation has been confirmed"

### When Status = 10 (Declined/Cancelled)
1. Sends declined email to customer - "Unfortunately your reservation could not be accommodated"

## Testing with Real Data

### Prerequisites
- Development server running: `bun run dev`
- Valid `DOTYPOS_WEBHOOK_SECRET` in `.env.local`
- Access to Dotypos API (for fetching reservation details)

### Manual Testing

1. **Test Script Available**: `scripts/test-webhook-simple.ts`
   ```bash
   # Test new reservation (sends 2 emails)
   bun scripts/test-webhook-simple.ts created
   
   # Test confirmed reservation (sends 1 email)
   bun scripts/test-webhook-simple.ts confirmed
   
   # Test declined reservation (sends 1 email)
   bun scripts/test-webhook-simple.ts declined
   ```

2. **Note**: The test script uses fake reservation IDs (99999, 99998, 99997) which don't exist in Dotypos, so you'll see a "Reservation not found" error. This is expected for testing.

## Email Templates

### Business Notification Email (New Reservations)
- **To**: reservations@deskohub.cz
- **Subject**: "Nová rezervace - [Customer Name] - [Date] [Time]"
- **Content**: 
  - Reservation ID, date, time, duration, party size
  - Customer contact details
  - Special requests (if any)
  - Action required notice
  - Customer's language preference

### Customer Emails
- **Created**: Pending confirmation notice
- **Confirmed**: Reservation confirmed with details
- **Declined**: Polite decline with contact information

## Locale Support
The webhook reads the locale from the reservation note metadata and sends emails in the appropriate language:
- `cs-CZ`: Czech
- `en-US`: English

## Security
- Webhook requires `?secret=` query parameter matching `DOTYPOS_WEBHOOK_SECRET`
- Returns 401 Unauthorized if secret is invalid or missing

## Troubleshooting

### "Reservation not found" Error
- This occurs when testing with fake reservation IDs
- In production, Dotypos sends real reservation IDs that exist in their system

### Email Not Sending
- Check email provider configuration (Console provider in development)
- Verify customer has email address in Dotypos
- Check server logs for detailed error messages

### Wrong Language in Emails
- Verify locale is properly encoded in reservation note
- Check that locale is one of: `cs-CZ` or `en-US`
- Default fallback is determined by `getLocale()` function

## Future Enhancements
- Admin interface for approving/denying reservations (Task #57)
- Direct links in notification emails to admin reservation detail page
- Automated testing with mock Dotypos responses