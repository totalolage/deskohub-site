# Dotypos Reservations Integration

## Scope

This document covers the active reservation integration between DeskoHub and Dotypos.

The project currently uses direct service calls from server actions and webhook handlers. It does not expose a public `/api/dotypos/reservations` CRUD API.

## Active Components

- `features/dotypos/backend/service.ts` - domain service for reservations/customers/tables/menu
- `features/dotypos/backend/api.ts` - typed API operations against Dotypos endpoints
- `features/table-reservation/actions/table-reservation.ts` - reservation creation entry point
- `app/api/webhooks/reservation/route.ts` - status updates and email triggers

## Supported Reservation Operations

- Create reservation (`DotyposService.createReservation`)
- Read reservation details (`DotyposService.getReservation`)
- Resolve/create customer (`DotyposService.findOrCreateCustomer`)

## Configuration Model

Branch/cloud/customer behavior is environment-driven (see `env.ts` and `shared/backend/config/dotypos.config.ts`), not hardcoded to branch `1`.

## Webhook Behavior

- Endpoint: `/api/webhooks/reservation`
- Handles Dotypos reservation status transitions (`NEW`, `CONFIRMED`, `DECLINED`)
- Sends customer/business emails through the email feature
- Revalidates reservation cache tags after processing

## Limitations

- No first-class local reservation persistence layer; Dotypos remains the operational backend.
- No standalone public reservation CRUD API in `app/api/dotypos/reservations`.
