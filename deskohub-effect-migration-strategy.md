# DeskohHub Effect TypeScript Migration Strategy (Backend Services)

## Executive Summary

This document outlines a focused strategy for migrating DeskohHub's backend services to Effect TypeScript. The migration will transform server-side error handling, dependency injection, and asynchronous operations while keeping the frontend React components unchanged.

### Key Migration Goals
- **Type-safe backend operations**: Replace try-catch blocks with Effect's typed error system in server actions
- **Explicit service dependencies**: Convert implicit backend dependencies to Effect's DI system
- **Improved API reliability**: Transform server-side promises into composable Effect pipelines
- **Enhanced observability**: Leverage Effect's built-in tracing for backend operations
- **Minimal frontend impact**: Keep React components and client-side code unchanged

## 1. Current Architecture Analysis

### Technology Stack
- **Runtime**: Bun with Next.js 15 App Router
- **Backend**: Server Actions with next-safe-action
- **Validation**: Zod schemas (backend validation)
- **Data Storage**: File-based temporary storage
- **Future Integrations**: External APIs planned

### Backend Architecture Patterns
- **Server Actions**: Type-safe RPC-style API calls
- **Middleware Chain**: Server-side request processing
- **Form Processing**: Server-side validation and storage
- **Error Handling**: Generic try-catch with console logging

### Current Backend Pain Points
1. **Untyped Server Errors**: Backend catch blocks receive `unknown` errors
2. **No Dependency Injection**: Services are imported directly
3. **Limited Error Recovery**: No retry mechanisms for external API calls
4. **Basic Observability**: Console.log for debugging
5. **No Transaction Support**: File operations lack atomicity

## 2. Backend Component Assessment

### Service Complexity Levels

#### Level 1: Simple Services
**Characteristics:**
- Pure server-side functions
- No external dependencies
- Basic data transformation

**Examples:**
- Date/time calculations
- Server-side constants
- Utility functions

**Migration Effort:** 2-4 hours per service

#### Level 2: Standard Services
**Characteristics:**
- File system operations
- Basic async operations
- Simple error scenarios

**Examples:**
- Booking storage service
- Contact form handler
- PDF generation

**Migration Effort:** 1-2 days per service

#### Level 3: Complex Services
**Characteristics:**
- External API integrations
- Complex business logic
- Multiple error scenarios
- Transaction requirements

**Examples:**
- Email service (planned)
- Payment processing (future)
- External API integrations

**Migration Effort:** 3-5 days per service

### Backend Service Assessment

| Service | Current State | Effect Benefits | Priority | Risk |
|---------|--------------|-----------------|----------|------|
| Booking Storage | File-based | Atomic operations | High | Low |
| Contact Handler | Console logging | Structured errors | Medium | Low |
| Server Actions | Try-catch | Typed errors | High | Medium |
| Middleware | Promise chain | Composable layers | High | Medium |
| Future: Email | Not implemented | Queue support | High | Low |
| Future: External APIs | Not implemented | Built-in retry | Medium | Low |

## 3. Backend Migration Architecture

### Core Backend Patterns

#### Backend Error Types
```typescript
// shared/backend/errors/index.ts
export class BackendError {
  readonly _tag = "BackendError"
  constructor(
    readonly code: string,
    readonly message: string,
    readonly details?: unknown
  ) {}
}

export class StorageError extends BackendError {
  readonly _tag = "StorageError"
  constructor(message: string, operation?: string) {
    super("STORAGE_ERROR", message, { operation })
  }
}

export class ValidationError extends BackendError {
  readonly _tag = "ValidationError"
  constructor(message: string, field?: string) {
    super("VALIDATION_ERROR", message, { field })
  }
}

export class ExternalAPIError extends BackendError {
  readonly _tag = "ExternalAPIError"
  constructor(service: string, message: string, statusCode?: number) {
    super("EXTERNAL_API_ERROR", message, { service, statusCode })
  }
}
```

#### Backend Service Architecture
```typescript
// features/booking/backend/booking.service.ts
import { Context, Effect, Layer } from "effect"
import { BookingStorage } from "./booking.storage"
import type { BookingData } from "../types"

interface BookingService {
  createBooking: (data: BookingData) => Effect<string, StorageError>
  getBooking: (id: string) => Effect<BookingData, StorageError>
}

export class BookingService extends Context.Tag("BookingService")<
  BookingService,
  BookingService
>() {}

export const BookingServiceLive = Layer.effect(
  BookingService,
  Effect.gen(function* () {
    const storage = yield* BookingStorage
    
    return BookingService.of({
      createBooking: (data) => 
        pipe(
          Effect.sync(() => crypto.randomUUID()),
          Effect.flatMap(id => 
            storage.save(id, { ...data, id, createdAt: new Date() })
          ),
          Effect.tap(id => Effect.log(`Booking created: ${id}`))
        ),
      
      getBooking: (id) => storage.get(id)
    })
  })
)
```

#### Effect Server Action Pattern
```typescript
// shared/backend/utils/effect-action.ts
import { Effect, pipe } from "effect"
import { Schema } from "@effect/schema"

export function createEffectAction<I, O, E, R>(
  schema: Schema.Schema<I>,
  handler: (input: I) => Effect<O, E, R>
) {
  return async (input: unknown) => {
    const program = pipe(
      Schema.decodeUnknown(schema)(input),
      Effect.mapError(errors => new ValidationError(
        Schema.formatError(errors)
      )),
      Effect.flatMap(handler),
      Effect.catchAll(error => 
        Effect.fail({
          success: false,
          error: formatBackendError(error)
        })
      )
    )
    
    return Effect.runPromise(program)
  }
}
```

### Migration Patterns for Backend

#### Pattern 1: Server Action Migration
```typescript
// Before - current implementation
export const submitBooking = actionClient
  .inputSchema(getBookingSchema())
  .action(async ({ parsedInput }) => {
    const bookingId = uuidv4();
    
    await storeBooking({
      id: bookingId,
      ...parsedInput,
      submittedAt: new Date(),
    });
    
    redirect(`/reservation/${bookingId}`);
  });

// After - with Effect
export const submitBooking = createEffectAction(
  BookingSchema,
  (input) => 
    Effect.gen(function* () {
      const service = yield* BookingService
      const bookingId = yield* service.createBooking(input)
      
      // Future: Add notification service
      // yield* NotificationService.sendConfirmation(bookingId)
      
      return {
        success: true,
        bookingId,
        redirect: `/reservation/${bookingId}`
      }
    }).pipe(
      Effect.withSpan("submitBooking"),
      Effect.provide(BookingServiceLive)
    )
)
```

#### Pattern 2: Storage Service with Effect
```typescript
// Before - file storage
export async function storeBooking(booking: BookingData): Promise<void> {
  const bookingsPath = path.join(process.cwd(), 'data', 'bookings.json');
  
  try {
    const existing = await fs.readFile(bookingsPath, 'utf-8')
      .then(data => JSON.parse(data))
      .catch(() => []);
    
    existing.push(booking);
    await fs.writeFile(bookingsPath, JSON.stringify(existing, null, 2));
  } catch (error) {
    console.error('Failed to store booking:', error);
    throw error;
  }
}

// After - Effect storage service
export const BookingStorageLive = Layer.succeed(
  BookingStorage,
  BookingStorage.of({
    save: (id, data) => 
      Effect.gen(function* () {
        const filePath = getBookingFilePath()
        
        const existing = yield* pipe(
          Effect.tryPromise({
            try: () => fs.readFile(filePath, 'utf-8'),
            catch: () => new StorageError("Failed to read bookings")
          }),
          Effect.map(content => JSON.parse(content)),
          Effect.catchTag("StorageError", () => Effect.succeed([]))
        )
        
        const updated = [...existing, { ...data, id }]
        
        yield* Effect.tryPromise({
          try: () => fs.writeFile(
            filePath, 
            JSON.stringify(updated, null, 2)
          ),
          catch: () => new StorageError("Failed to write booking")
        })
        
        return id
      }).pipe(
        Effect.withSpan("BookingStorage.save", { attributes: { id } })
      )
  })
)
```

#### Pattern 3: Middleware as Effect Layers
```typescript
// Before - middleware chain
export function createMiddlewareChain(factories: MiddlewareFactory[]) {
  // Complex promise chaining
}

// After - Effect layers
export const MiddlewareStack = Layer.mergeAll(
  LocalizationLayer,
  SecurityHeadersLayer,
  PathTrackingLayer
).pipe(
  Layer.provide(ConfigLayer)
)

const LocalizationLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    const config = yield* Config
    
    // Middleware logic as Effect
    yield* Effect.addServiceFactory({
      tag: RequestContext,
      factory: () => ({
        locale: detectLocale(request),
        // ... other context
      })
    })
  })
)
```

## 4. Implementation Roadmap (Backend Focus)

### Phase 0: Foundation (Week 1)
**Goal:** Set up Effect for backend services

1. **Install Effect core**
   ```bash
   bun add effect @effect/schema @effect/platform-node
   ```

2. **Create backend Effect utilities**
   - Backend error types
   - Effect action wrapper
   - Service base patterns
   - Logging configuration

3. **Configure TypeScript**
   - Separate tsconfig for backend
   - Effect compiler options

**Deliverables:**
- `/shared/backend/effect/` directory
- Backend migration guide
- Example migrated utility

### Phase 1: Storage Layer (Week 2)
**Goal:** Migrate file storage to Effect

**Components:**
- Booking storage service
- Atomic file operations
- Error recovery for I/O
- Structured logging

**Benefits:**
- Type-safe storage errors
- Automatic retry for I/O
- Transaction-like operations

### Phase 2: Server Actions (Week 3-4)
**Goal:** Migrate all server actions to Effect

**Actions to Migrate:**
1. `submitBooking` - Main booking flow
2. `submitContactForm` - Contact form handler
3. Future PDF generation
4. Future workspace reservation

**Pattern:**
```typescript
// Consistent pattern for all actions
export const action = createEffectAction(
  InputSchema,
  (input) => businessLogic(input).pipe(
    Effect.provide(RequiredServices)
  )
)
```

### Phase 3: Middleware Layer (Week 5)
**Goal:** Convert middleware to Effect layers

**Components:**
- Localization middleware
- Security headers
- Path tracking
- Request context

**Architecture:**
- Composable middleware layers
- Shared request context
- Effect-based request handling

### Phase 4: External Integrations Prep (Week 6)
**Goal:** Prepare for external API integrations with Effect

**Components:**
```typescript
// features/booking/backend/external-api.service.ts
export const ExternalAPIServiceLive = Layer.effect(
  ExternalAPIService,
  Effect.gen(function* () {
    const config = yield* APIConfig
    
    return ExternalAPIService.of({
      createRecord: (endpoint, data) => 
        pipe(
          httpClient.post(`${config.baseUrl}/${endpoint}`, data),
          Effect.retry(
            Schedule.exponential(1000).pipe(
              Schedule.either(Schedule.recurs(3))
            )
          ),
          Effect.catchTag("HttpError", (error) => 
            error.status === 429
              ? Effect.fail(new RateLimitError())
              : Effect.fail(new ExternalAPIError(error.message))
          )
        )
    })
  })
)
```

### Phase 5: Observability (Week 7)
**Goal:** Add backend observability

**Components:**
- Structured logging with context
- Request tracing
- Performance metrics
- Error tracking

**Example:**
```typescript
const program = pipe(
  submitBooking(data),
  Effect.withSpan("booking.submit", {
    attributes: {
      guestCount: data.guestCount,
      date: data.datetime
    }
  }),
  Metric.trackDuration("booking.duration"),
  Metric.trackError("booking.errors")
)
```

## 5. Backend-Specific Benefits

### Immediate Benefits
1. **Type-safe backend errors** with proper error codes
2. **Automatic retry** for external API calls
3. **Structured logging** for debugging
4. **Service isolation** for better architecture

### Operational Benefits
1. **Better error messages** for debugging
2. **Request tracing** across services
3. **Graceful degradation** for external services
4. **Resource cleanup** guarantees

### Development Benefits
1. **Cleaner service boundaries**
2. **Easier mocking** for local development
3. **Consistent error handling**
4. **Self-documenting service interfaces**

## 6. Migration Examples by Service Type

### File Storage Services
```typescript
// Migrate from fs.promises to Effect
const readJson = <T>(path: string): Effect<T, StorageError> =>
  pipe(
    Effect.tryPromise({
      try: () => fs.readFile(path, 'utf-8'),
      catch: (e) => new StorageError(`Cannot read ${path}: ${e}`)
    }),
    Effect.flatMap(content =>
      Effect.try({
        try: () => JSON.parse(content) as T,
        catch: (e) => new StorageError(`Invalid JSON in ${path}: ${e}`)
      })
    )
  )
```

### External API Services
```typescript
// Generic external API integration
const fetchRecords = (endpoint: string): Effect<ApiRecord[], ExternalAPIError> =>
  pipe(
    Effect.tryPromise({
      try: () => fetch(`${API_BASE}/${endpoint}`, {
        headers: { Authorization: `Bearer ${API_KEY}` }
      }),
      catch: (e) => new NetworkError(`API request failed: ${e}`)
    }),
    Effect.filterOrFail(
      (res) => res.ok,
      (res) => new ExternalAPIError(`API error: ${res.status}`)
    ),
    Effect.flatMap(res => 
      Effect.tryPromise({
        try: () => res.json(),
        catch: () => new ParseError("Invalid API response")
      })
    ),
    Effect.retry(retryPolicy),
    Effect.withSpan("api.fetchRecords", { attributes: { endpoint } })
  )
```

### Business Logic Services
```typescript
// Booking validation with business rules
const validateBookingTime = (
  datetime: Date,
  duration: number
): Effect<void, BookingValidationError> =>
  Effect.gen(function* () {
    const config = yield* RestaurantConfig
    
    // Check if within business hours
    if (!isWithinBusinessHours(datetime, config)) {
      return yield* Effect.fail(
        new BookingValidationError("Outside business hours")
      )
    }
    
    // Check if slot available (future: check against external booking system)
    const isAvailable = yield* checkAvailability(datetime, duration)
    if (!isAvailable) {
      return yield* Effect.fail(
        new BookingValidationError("Time slot not available")
      )
    }
  })
```

## 7. Frontend Integration (Minimal Changes)

The frontend remains largely unchanged. Server actions are called the same way:

```typescript
// Frontend component - NO CHANGES NEEDED
function BookingForm() {
  const { execute, status } = useAction(submitBooking)
  
  return (
    <form action={execute}>
      {/* Form fields remain the same */}
    </form>
  )
}

// The action signature stays compatible
export const submitBooking = async (formData: FormData) => {
  // Effect handles everything internally
  // Returns the same response shape
}
```

## 8. Risk Mitigation

### Technical Risks

1. **Backend Complexity**
   - **Mitigation**: Start with simple services
   - **Validation**: Extensive logging
   - **Rollback**: Feature flags for services

2. **Performance Impact**
   - **Mitigation**: Benchmark critical paths
   - **Monitoring**: Track response times
   - **Optimization**: Use Effect's lazy evaluation

### Operational Risks

1. **Service Interruption**
   - **Mitigation**: Parallel run during migration
   - **Strategy**: One service at a time
   - **Recovery**: Quick rollback procedures

## 9. Success Metrics

### Backend Performance
- **API Response Time**: ≤ current baseline
- **Error Rate**: 50% reduction
- **Failed API Calls**: 70% reduction (with retry)

### Operational Metrics
- **Debug Time**: 40% faster with structured errors
- **Incident Resolution**: 50% faster
- **External API Reliability**: 90% → 99%

### Code Quality
- **Backend Type Coverage**: 100%
- **Error Handling**: 100% typed
- **Service Boundaries**: Clearly defined

## 10. Conclusion

This backend-focused migration strategy provides a practical approach to improving DeskohHub's server-side reliability and maintainability. By keeping the frontend unchanged and focusing on backend services, we minimize risk while gaining significant benefits in error handling, observability, and service composition.

The phased approach ensures each backend service is properly migrated and validated before moving to the next, maintaining system stability throughout the process.