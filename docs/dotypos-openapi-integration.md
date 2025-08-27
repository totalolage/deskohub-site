# Dotypos OpenAPI Integration

## Overview

DeskoHub integrates with Dotypos POS system using a clean, layered architecture:

1. **OpenAPI Schema** - Defines the Dotypos API contract
2. **Generated Client** - Type-safe HTTP client generated from OpenAPI
3. **Effect Service** - Business logic layer with proper error handling
4. **Feature Adapters** - Connect features (like booking) to Dotypos

## Architecture

```
features/dotypos/
├── openapi/
│   ├── dotypos-api.yaml       # OpenAPI 3.0 schema
│   └── openapi-ts.config.ts   # Code generation config
├── generated/                  # Auto-generated client code
│   ├── client.gen.ts
│   ├── sdk.gen.ts             # SDK functions
│   └── types.gen.ts           # TypeScript types
├── backend/
│   └── service.ts             # Effect service layer
├── types/
│   └── index.ts               # Domain types
└── index.ts                   # Public API
```

## Key Design Decisions

### 1. OpenAPI-First Approach

The API contract is defined in `openapi/dotypos-api.yaml`. This provides:
- Single source of truth for API structure
- Type-safe client generation
- API documentation
- Contract validation

### 2. Generated Client Layer

Using `@hey-api/openapi-ts` to generate:
- Type-safe HTTP client
- Request/response types
- SDK functions for each endpoint
- Automatic serialization/deserialization

### 3. Effect Service Layer

The `backend/service.ts` wraps the generated client with:
- Effect-based error handling
- Token management and caching
- Retry logic
- Business logic transformations
- Dependency injection via Context

### 4. Clean Separation

- **Generated code** is never manually edited
- **Service layer** handles all business logic
- **Authentication** is managed centrally
- **Features** use adapters to connect

## Usage

### Regenerating the Client

When the Dotypos API changes, update the OpenAPI schema and regenerate:

```bash
bun run dotypos:generate
```

### Using in Features

Features should create adapters that use the Dotypos service:

```typescript
// features/booking/backend/dotypos-adapter.ts
import { createReservation, DotyposServiceLive } from "@/features/dotypos";

export const createBookingReservation = (booking: BookingData) =>
  createReservation(toReservationInput(booking)).pipe(
    Effect.provide(DotyposServiceLive)
  );
```

### Service Functions

The service provides Effect-based functions:

```typescript
// Create a reservation
const reservation = yield* createReservation({
  datetime: new Date(),
  duration: 2,
  guestCount: 4,
  customerName: "John Doe",
  customerEmail: "john@example.com",
  customerPhone: "+420123456789",
});

// Get a reservation
const existing = yield* getReservation("123");
```

## Configuration

Required environment variables:

```env
DOTYPOS_CLIENT_ID=your_client_id
DOTYPOS_CLIENT_SECRET=your_client_secret  
DOTYPOS_REFRESH_TOKEN=your_refresh_token
DOTYPOS_CLOUD_ID=your_cloud_id
DOTYPOS_API_URL=https://api.dotykacka.cz/v2  # Optional
```

## Error Handling

The service uses typed errors:
- `NetworkError` - Connection failures
- `ExternalAPIError` - API errors (4xx, 5xx)
- `ValidationError` - Data validation errors

All errors are properly typed and can be handled with Effect's error handling:

```typescript
const result = yield* createReservation(input).pipe(
  Effect.catchTag("NetworkError", (error) => 
    Effect.log(`Network error: ${error.message}`)
  ),
  Effect.catchTag("ExternalAPIError", (error) =>
    Effect.log(`API error: ${error.statusCode}`)
  )
);
```

## Token Management

- Tokens are cached in-memory with automatic refresh
- Token refresh happens 1 minute before expiry
- Failed requests trigger token refresh and retry

## Benefits

1. **Type Safety** - Full end-to-end type safety from API to UI
2. **Maintainability** - Clear separation of concerns
3. **Reliability** - Proper error handling and retries
4. **Documentation** - OpenAPI serves as living documentation
5. **Testability** - Each layer can be tested independently
6. **Flexibility** - Easy to add new endpoints or change providers

## Future Enhancements

- Add request/response logging
- Implement circuit breaker for API failures
- Add metrics and monitoring
- Support for webhook endpoints
- Batch operations support
