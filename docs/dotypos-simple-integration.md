# Dotypos Simple Integration

## Overview

DeskOHub integrates with Dotypos to create reservations in their POS system. The integration is intentionally simple and focused solely on creating reservations.

## Architecture

### Single Service Design

The entire Dotypos integration is contained in a single file: `features/booking/backend/dotypos.ts`

This service:
- Reads configuration from environment variables
- Manages OAuth2 token refresh internally
- Creates reservations in Dotypos
- Returns a simple response

### Integration Point

The Dotypos service is the sole source of truth for reservations and is called directly from the booking action (`features/booking/actions/booking.ts`):

```typescript
// Create reservation in Dotypos (this is our source of truth)
const reservation = yield* createDotyposReservation(bookingData);

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

### The Single Function

```typescript
export const createDotyposReservation = (
  booking: BookingData
): Effect.Effect<ReservationResponse, ExternalAPIError | NetworkError | ValidationError>
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
2. **Resilience**: Failures don't affect core booking functionality
3. **Maintainability**: No complex layers or dependencies
4. **Performance**: Minimal overhead, direct API calls
5. **Flexibility**: Easy to modify or remove if needed

## Testing

To test the integration:

1. Set environment variables
2. Submit a booking through the form
3. Check logs for Dotypos reservation creation
4. If not configured, see mock reservation in logs

## Future Considerations

If more Dotypos features are needed, they can be added as additional functions in the same file. The current approach keeps things simple until more complexity is actually required.