# Dotypos Reservations Integration

## Overview

This document describes the simplified Dotypos integration for DeskOHub, focusing exclusively on reservation management. The integration does not handle complex table assignments, customer management, or multi-branch operations.

## Architecture

### Simplified Approach

The DeskOHub-Dotypos integration follows a minimalist approach:
- **Reservations Only**: We only create, read, update, and cancel reservations
- **No Table Management**: Tables are handled by Dotypos staff manually
- **No Customer Database**: Customer info is embedded in reservation notes
- **Single Branch**: Uses default branch (ID: 1) for all operations
- **No Webhooks**: Simple polling or on-demand fetching of reservation status

### Key Components

1. **Authentication Service** (`dotypos-auth.service.ts`)
   - Effect-based OAuth2 flow implementation
   - Automatic token refresh with proper error handling
   - Configuration through Effect's Config module
   - Dependency injection via Effect Layers

2. **Reservations Service** (`dotypos-reservations.service.ts`)
   - Pure Effect-based service with Schema validation
   - Type-safe CRUD operations for reservations
   - Automatic retry with token refresh
   - ETag support for conflict resolution

3. **Dotypos Service Adapter** (`dotypos.service.ts`)
   - Bridges the Dotypos API with the booking system
   - Transforms between internal and external data formats
   - Provides backward compatibility with existing interfaces
   - Full Effect.ts integration with proper error types

## API Endpoints

### Base URL
```
https://api.dotykacka.cz/v2/clouds/{cloudId}/reservations
```

### Operations

#### Create Reservation
```typescript
POST /api/dotypos/reservations
{
  "datetime": "2024-03-20T19:00:00Z",
  "guestCount": 4,
  "customerName": "John Doe",
  "customerEmail": "john@example.com",
  "customerPhone": "+420123456789",
  "note": "Window seat preferred"
}
```

#### List Reservations
```typescript
GET /api/dotypos/reservations?limit=10&status=CONFIRMED
```

#### Update Reservation
```typescript
PATCH /api/dotypos/reservations/{id}
{
  "datetime": "2024-03-20T20:00:00Z",
  "guestCount": 6
}
```

#### Cancel Reservation
```typescript
DELETE /api/dotypos/reservations/{id}
```

## Data Model

### DotyposReservation
```typescript
interface DotyposReservation {
  id?: number;
  _branchId: number;           // Always 1 (default branch)
  _cloudId: number;            // From environment config
  startDate: number;           // Unix timestamp (milliseconds)
  endDate: number;             // Unix timestamp (milliseconds)
  seats: number;               // Number of guests
  status: "NEW" | "CONFIRMED" | "CANCELLED";
  note?: string;               // Contains customer info and preferences
  created?: number;
  versionDate?: number;
  _etag?: string;              // For conflict resolution
}
```

### Customer Information Storage

Since we don't manage customers as separate entities, all customer information is stored in the reservation's `note` field in a structured format:

```
Customer: John Doe | Email: john@example.com | Phone: +420123456789 | Special requests
```

## Configuration

### Environment Variables
```env
# Dotypos API Configuration
DOTYPOS_CLIENT_ID=your_client_id
DOTYPOS_CLIENT_SECRET=your_client_secret
DOTYPOS_REFRESH_TOKEN=your_refresh_token
DOTYPOS_CLOUD_ID=your_cloud_id
DOTYPOS_API_URL=https://api.dotykacka.cz/v2
```

## Usage Examples

### Using the Dotypos Service in a Server Action
```typescript
import { Effect } from 'effect';
import { DotyposService } from '@/features/booking/backend/dotypos.service';
import { DotyposLive } from '@/features/booking/backend/dotypos.service';

const createReservation = Effect.gen(function* () {
  const dotypos = yield* DotyposService;
  
  const reservation = yield* dotypos.createReservation({
    datetime: new Date('2024-03-20T19:00:00Z'),
    guestCount: 4,
    name: 'John Doe',
    email: 'john@example.com',
    phone: '+420123456789',
    specialRequests: 'Window seat preferred',
    duration: 2 // hours
  });
  
  return reservation;
}).pipe(
  Effect.provide(DotyposLive),
  Effect.runPromise
);
```

### Using in the Booking Service Layer
```typescript
import { Layer, Effect } from 'effect';
import { DotyposService } from './dotypos.service';

export const BookingServiceLive = Layer.effect(
  BookingService,
  Effect.gen(function* () {
    const dotypos = yield* DotyposService;
    
    return {
      createBooking: (data) =>
        Effect.gen(function* () {
          // Create reservation in Dotypos
          const reservation = yield* dotypos.createReservation(data);
          
          // Log success
          yield* Effect.log(`Reservation created: ${reservation.id}`);
          
          return reservation.id;
        })
    };
  })
);
```

### Error Handling with Effect
```typescript
const handleReservation = Effect.gen(function* () {
  const dotypos = yield* DotyposService;
  
  return yield* dotypos.createReservation(bookingData).pipe(
    Effect.catchTag("NetworkError", (error) =>
      Effect.fail(new Error(`Network issue: ${error.message}`))
    ),
    Effect.catchTag("ExternalAPIError", (error) => {
      if (error.details?.statusCode === 409) {
        return Effect.fail(new Error("No availability at this time"));
      }
      return Effect.fail(new Error(`API error: ${error.message}`));
    }),
    Effect.catchTag("ValidationError", (error) =>
      Effect.fail(new Error(`Invalid data: ${error.message}`))
    )
  );
});
```

## Error Handling

The integration uses typed errors from Effect.ts:

- **NetworkError**: Connection issues with Dotypos API
- **ExternalAPIError**: API-specific errors (401, 404, 409, 429, etc.)
- **ValidationError**: Invalid input data

Example error handling:
```typescript
Effect.runPromise(
  dotyposReservations.createReservation(data).pipe(
    Effect.catchTag("NetworkError", (error) => 
      // Handle network issues
    ),
    Effect.catchTag("ExternalAPIError", (error) => {
      if (error.status === 409) {
        // Handle conflict (no availability)
      } else if (error.status === 429) {
        // Handle rate limiting
      }
    }),
    Effect.catchTag("ValidationError", (error) =>
      // Handle validation errors
    )
  )
);
```

## Limitations

This simplified integration has the following limitations:

1. **No Table Assignment**: Tables must be assigned manually in Dotypos
2. **No Customer Management**: No customer history or loyalty tracking
3. **Single Location**: Only supports one restaurant location
4. **No Real-time Updates**: No webhook support for instant updates
5. **Basic Availability**: Simple capacity-based availability checking
6. **No Employee Assignment**: Staff assignment handled in Dotypos

## Benefits of Simplified Approach

1. **Reduced Complexity**: Fewer moving parts, easier to maintain
2. **Faster Implementation**: Can be deployed quickly
3. **Lower Error Surface**: Fewer features mean fewer potential issues
4. **Clear Separation**: DeskOHub handles bookings, Dotypos handles operations
5. **Flexibility**: Restaurant staff maintain control over table assignments

## Migration Path

If more features are needed in the future:

1. **Phase 1**: Current implementation (Reservations only)
2. **Phase 2**: Add customer search/deduplication (optional)
3. **Phase 3**: Add table availability visualization (optional)
4. **Phase 4**: Add multi-branch support (optional)

Each phase can be implemented independently without breaking existing functionality.

## Testing

### Test Reservation Creation
```bash
curl -X POST http://localhost:3000/api/dotypos/reservations \
  -H "Content-Type: application/json" \
  -d '{
    "datetime": "2024-03-20T19:00:00Z",
    "guestCount": 4,
    "customerName": "Test Customer",
    "customerEmail": "test@example.com",
    "note": "Test reservation"
  }'
```

### Test Listing Reservations
```bash
curl http://localhost:3000/api/dotypos/reservations?limit=5
```

## Conclusion

This simplified Dotypos integration provides all essential reservation functionality while maintaining a clean, maintainable codebase. By focusing solely on reservations, we avoid complexity while still delivering a complete booking solution for DeskOHub.