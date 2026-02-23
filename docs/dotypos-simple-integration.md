# Dotypos Simple Integration

## Overview

DeskoHub creates table reservations in Dotypos through a single service boundary: `DotyposService`.

Current flow:

1. User submits table reservation form.
2. `features/table-reservation/actions/table-reservation.ts` calls `DotyposService.createReservation`.
3. Dotypos reservation ID is used for redirect and subsequent status/webhook handling.

## Main Integration Points

- Action entry point: `features/table-reservation/actions/table-reservation.ts`
- Service API: `features/dotypos/backend/service.ts`
- Dotypos API wrapper: `features/dotypos/backend/api.ts`
- Public feature export: `features/dotypos/index.ts`

## Environment Configuration

Validated in `env.ts`:

- `DOTYPOS_CLIENT_ID`
- `DOTYPOS_CLIENT_SECRET`
- `DOTYPOS_REFRESH_TOKEN`
- `DOTYPOS_API_URL`
- `DOTYPOS_BRANCH_ID`
- `DOTYPOS_CLOUD_ID`
- `DOTYPOS_EMPLOYEE_ID`
- `DOTYPOS_API_TIMEOUT`

## Notes

- Dotypos is the operational source of truth for reservation records.
- Reservation status emails are triggered from webhook processing, not directly inside the initial reservation action.
