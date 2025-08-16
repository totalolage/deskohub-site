# Dotypos Simple Integration

## Overview

DeskOHub integrates with Dotypos to create reservations in their POS system. The integration is intentionally simple and focused solely on creating reservations.

## Architecture

### Separate Feature Design

The Dotypos integration is its own feature located at: `features/dotypos/`

This separation allows the POS integration to be used by multiple features, not just bookings.

This service:
- Reads configuration from environment variables
- Manages OAuth2 token refresh internally
- Creates reservations in Dotypos
- Returns a simple response

### Integration Point

The Dotypos service is the sole source of truth for reservations. The booking feature uses an adapter (`features/booking/backend/dotypos-adapter.ts`) to connect to it:

```typescript
// In the booking action, use the adapter
const reservation = yield* createBookingReservation(bookingData);

yield* Effect.log(
  `Dotypos reservation created: ${reservation.id} (status: ${reservation.status})`
);

// Return the Dotypos reservation ID
return { bookingId: reservation.id };
```

## Key Features

### Sole Source of Truth
- Dotypos is the single source of truth for all reservations
- No local storage fallback - ensures data consistency
- Reservation IDs come directly from Dotypos

### Configuration Required
- Dotypos must be configured for bookings to work
- Returns validation error if not configured
- Ensures all bookings are properly tracked in POS system

### Simple Configuration
All configuration via environment variables:
```env
DOTYPOS_CLIENT_ID=your_client_id
DOTYPOS_CLIENT_SECRET=your_client_secret  
DOTYPOS_REFRESH_TOKEN=your_refresh_token
DOTYPOS_CLOUD_ID=your_cloud_id
```

## Implementation Details

### Core Functions

```typescript
// In features/dotypos/backend/client.ts
export const createReservation = (
  input: ReservationInput
): Effect.Effect<DotyposReservation, ExternalAPIError | NetworkError | ValidationError>

export const getReservation = (
  reservationId: string
): Effect.Effect<DotyposReservation, ExternalAPIError | NetworkError | ValidationError>
```

This function:
1. Checks if Dotypos is configured
2. Gets/refreshes access token if needed
3. Creates the reservation
4. Returns a simple response

### Token Management

Tokens are cached in-memory with automatic refresh:
- Cached until 1 minute before expiry
- Automatically refreshed on next request
- No external dependencies or complex state

### Customer Information

Customer details are embedded in the reservation note field:
```
Customer: John Doe | Email: john@example.com | Phone: +420123456789 | Special requests
```

## Benefits of This Approach

1. **Simplicity**: One file, one function, easy to understand
2. **Data Integrity**: No fallbacks - failures are explicit and visible
3. **Maintainability**: No complex layers or dependencies
4. **Performance**: Minimal overhead, direct API calls
5. **Reliability**: Single source of truth ensures consistency

## Testing

To test the integration:

1. Set environment variables (required - no fallback)
2. Submit a booking through the form
3. Check logs for Dotypos reservation creation
4. If not configured, booking will fail with clear error message

## Future Considerations

If more Dotypos features are needed, they can be added as additional functions in the same file. The current approach keeps things simple until more complexity is actually required.