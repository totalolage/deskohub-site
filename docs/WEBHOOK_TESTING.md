# Reservation Webhook Testing Guide

## Endpoint

- Route: `/api/webhooks/reservation`
- Handler: `app/api/webhooks/reservation/route.ts`

## What It Does

Based on Dotypos status updates:

- `0` (`created`): sends customer pending email + business notification
- `5` (`confirmed`): sends customer confirmation email
- `10` (`declined`): sends customer declined email

It also invalidates reservation-related cache tags.

## Recommended Dev Testing Flow

1. Run the app: `bun run dev`.
2. Create a reservation through the normal UI flow.
3. Open reservation detail page: `/[locale]/reservation/[id]`.
4. Use the **Development: Webhook Testing Panel** to trigger `created`, `confirmed`, and `declined` webhook payloads.

Panel component: `features/reservation/components/webhook-test-panel.tsx`.

## Security Behavior

- In development: webhook UUID validation is skipped.
- In non-development environments: `?secret=<DOTYPOS_WEBHOOK_SECRET>` is required.

Validation logic: `shared/backend/utils/webhook.ts`.

## Troubleshooting

- If webhook calls fail, inspect server logs from the route handler.
- If emails do not send, verify provider selection and `EMAIL_API_KEY`/`EMAIL_PROVIDER` behavior.
