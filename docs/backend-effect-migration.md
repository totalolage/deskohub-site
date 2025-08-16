# Backend Effect Migration Guide

## Overview

This guide documents the migration of DeskohHub's backend services to Effect TypeScript. The migration focuses on server-side components while keeping the frontend React components unchanged.

## Phase 0: Foundation Setup ✅

### Completed
1. **Installed Effect packages**:
   - `effect` - Core Effect library
   - `@effect/schema` - Schema validation and serialization
   - `@effect/platform-node` - Node.js platform utilities

2. **Created backend directory structure**:
   ```
   shared/backend/
   ├── errors/
   │   └── index.ts          # Backend error types
   └── utils/
       ├── effect-action.ts   # Generic Effect action wrapper
       └── effect-safe-action.ts # Next-safe-action integration
   ```

3. **Defined error hierarchy**:
   - `BackendError` - Base error class
   - `StorageError` - File system operations
   - `ValidationError` - Input validation
   - `ExternalAPIError` - External service failures
   - `NetworkError` - Network-related issues
   - `ParseError` - JSON/data parsing failures

## Phase 1: Storage Layer Migration (In Progress)

### Completed
1. **Booking Storage Service** (`features/booking/backend/booking.storage.ts`):
   - Migrated file-based storage to Effect
   - Type-safe error handling for I/O operations
   - Automatic cleanup of old bookings
   - Structured logging with spans

2. **Booking Service** (`features/booking/backend/booking.service.ts`):
   - Service layer with dependency injection
   - UUID generation for booking IDs
   - Composition with storage layer
   - Observability with Effect spans

3. **Effect Action Integration** (`features/booking/actions/booking-effect.ts`):
   - Created Effect-based booking action
   - Maintains compatibility with existing frontend
   - Preserves redirect behavior

### Benefits Achieved
- ✅ Type-safe storage errors
- ✅ Automatic error context (operation type)
- ✅ Structured logging
- ✅ Clean service boundaries

## Migration Patterns

### Pattern 1: Service Definition
```typescript
// Define interface
interface BookingStorage {
  save: (id: string, data: BookingData) => Effect<string, StorageError>
  get: (id: string) => Effect<BookingData | null, StorageError>
}

// Create tag
class BookingStorage extends Context.Tag("BookingStorage")<
  BookingStorage,
  BookingStorage
>() {}
```

### Pattern 2: Effect Action with next-safe-action
```typescript
export const submitBookingEffect = createEffectSafeAction(
  zodSchema,
  (input, { locale }) => Effect.gen(function* () {
    // Effect logic here
  }),
  RequiredLayers
)
```

### Pattern 3: Error Handling in Effects
```typescript
Effect.tryPromise({
  try: () => fs.readFile(file, "utf8"),
  catch: (error) => new StorageError(
    `Failed to read bookings: ${error}`,
    "read"
  )
})
```

## Next Steps

### Phase 2: Migrate Remaining Server Actions
- [ ] Contact form action
- [ ] PDF generation action

### Phase 3: Middleware as Effect Layers
- [ ] Localization middleware
- [ ] Security headers
- [ ] Path tracking

### Phase 4: External Integration Prep
- [ ] Design external API service interfaces
- [ ] Implement retry policies
- [ ] Rate limiting support

## Usage for Developers

### Running Effect-based Actions
The frontend code remains unchanged:
```tsx
// Frontend component - NO CHANGES NEEDED
const { execute, status } = useAction(submitBooking)
```

### Testing Effect Services
```typescript
// Create test layer with mock storage
const TestStorage = Layer.succeed(
  BookingStorage,
  BookingStorage.of({
    save: () => Effect.succeed("test-id"),
    get: () => Effect.succeed(null)
  })
)

// Run with test dependencies
const result = await pipe(
  program,
  Effect.provide(TestStorage),
  Effect.runPromise
)
```

## Debugging Tips

1. **Enable detailed logging**:
   ```typescript
   Effect.withLogSpan("operation-name")
   ```

2. **Inspect errors**:
   ```typescript
   Effect.catchAll(error => {
     console.error("Effect error:", error)
     return Effect.fail(error)
   })
   ```

3. **Check layer composition**:
   Use `Layer.tree` to visualize dependencies